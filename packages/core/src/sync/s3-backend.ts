/**
 * S3-compatible sync backend implementation.
 * Supports AWS S3, Cloudflare R2, Alibaba OSS, Tencent COS, MinIO, etc.
 */

import {
  CopyObjectCommand,
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { HttpResponse } from "@smithy/protocol-http";
import { buildQueryString } from "@smithy/querystring-builder";
import { getPlatformService } from "../services/platform";
import { normalizeS3Key, s3KeyToLogicalPath, sanitizeS3RemoteRoot } from "./s3-paths";
import {
  DEFAULT_S3_REMOTE_ROOT,
  type ISyncBackend,
  type RemoteFile,
  type S3Config,
} from "./sync-backend";

type SmithyHttpRequest = {
  protocol: string;
  hostname: string;
  port?: number;
  method: string;
  path: string;
  query?: Record<string, string | string[] | null>;
  fragment?: string;
  username?: string;
  password?: string;
  headers: Record<string, string>;
  body?: BodyInit | null;
};

function toTimestampMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

function toContentSize(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

type S3ListResponse = {
  CommonPrefixes?: Array<{ Prefix?: string }>;
  Contents?: Array<{ Key?: string; Size?: unknown; LastModified?: unknown }>;
  IsTruncated?: boolean;
  NextContinuationToken?: string;
  NextMarker?: string;
};

/**
 * Desktop-only request handler that routes AWS SDK traffic through the platform
 * fetch implementation. In Tauri this uses plugin-http, which avoids webview
 * CORS restrictions for S3-compatible providers like UpYun.
 */
class PlatformFetchHttpHandler {
  readonly metadata = { handlerProtocol: "h1" } as const;

  async handle(request: SmithyHttpRequest): Promise<{ response: HttpResponse }> {
    const platform = getPlatformService();
    let path = request.path;
    const queryString = buildQueryString(request.query ?? {});
    if (queryString) {
      path += `?${queryString}`;
    }
    if (request.fragment) {
      path += `#${request.fragment}`;
    }

    let auth = "";
    if (request.username != null || request.password != null) {
      const username = request.username ?? "";
      const password = request.password ?? "";
      auth = `${username}:${password}@`;
    }

    const url = `${request.protocol}//${auth}${request.hostname}${request.port ? `:${request.port}` : ""}${path}`;
    const response = await platform.fetch(url, {
      method: request.method,
      headers: request.headers,
      body:
        request.method === "GET" || request.method === "HEAD"
          ? undefined
          : (request.body ?? undefined),
    });

    const transformedHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      transformedHeaders[key] = value;
    });

    let responseBody: BodyInit | ReadableStream<Uint8Array> | undefined;
    if (response.body) {
      responseBody = response.body as ReadableStream<Uint8Array>;
    } else {
      responseBody = await response.blob();
    }

    return {
      response: new HttpResponse({
        headers: transformedHeaders,
        reason: response.statusText,
        statusCode: response.status,
        body: responseBody,
      }),
    };
  }

  destroy(): void {
    // No-op: platform fetch does not keep persistent sockets we need to tear down.
  }
}

/**
 * S3 backend implementation.
 * Works with any S3-compatible storage service.
 */

/**
 * Decide whether path-style addressing should be the default for a given
 * endpoint. Self-hosted S3 servers (rclone serve s3, MinIO, IP/localhost
 * endpoints) need path-style because the bucket can't ride as a subdomain
 * on a raw IP or a non-DNS host. AWS S3 supports both, so we leave it on
 * the SDK default (virtual-hosted) for amazonaws.com.
 */
export function shouldDefaultToPathStyle(endpoint?: string): boolean {
  if (!endpoint) return false; // SDK default endpoints (real AWS S3)
  try {
    const url = new URL(endpoint);
    const host = url.hostname.toLowerCase();
    if (host.endsWith("amazonaws.com")) return false;
    return true;
  } catch {
    // Endpoint string that doesn't parse as a URL → assume self-hosted.
    return true;
  }
}

export class S3Backend implements ISyncBackend {
  readonly type = "s3" as const;
  private client: S3Client;
  private config: S3Config;
  private remoteRoot: string;

  constructor(config: S3Config, secretAccessKey: string) {
    this.remoteRoot =
      sanitizeS3RemoteRoot(config.remoteRoot ?? DEFAULT_S3_REMOTE_ROOT) || DEFAULT_S3_REMOTE_ROOT;
    this.config = {
      ...config,
      remoteRoot: this.remoteRoot,
    };
    let requestHandler: PlatformFetchHttpHandler | undefined;
    try {
      const platform = getPlatformService();
      if (platform.isDesktop) {
        requestHandler = new PlatformFetchHttpHandler();
      }
    } catch {
      // Platform service may not be initialized in tests that never touch S3.
    }

    // Auto-detect path-style for non-AWS endpoints. Self-hosted S3-compatible
    // servers (rclone serve s3, MinIO, IP/localhost endpoints) overwhelmingly
    // require path-style addressing because their hostname can't carry the
    // bucket as a subdomain. AWS S3 supports both styles, so leave that alone.
    // Users can still override via the UI toggle.
    const pathStyle = config.pathStyle ?? shouldDefaultToPathStyle(config.endpoint);

    const clientConfig = {
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: pathStyle,
      ...(requestHandler ? { requestHandler } : {}),
    };

    this.client = new S3Client(clientConfig);
  }

  async testConnection(): Promise<boolean> {
    try {
      await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          MaxKeys: 1,
          Prefix: `${this.remoteRoot}/`,
        }),
      );
      return true;
    } catch (error) {
      // The SDK's Error subclasses don't serialize their useful fields via
      // default console.error formatting, so the feedback log capture ends
      // up with just "Error: ..." and the user can't tell what went wrong.
      // Pull out the fields users actually need to debug.
      const e = error as {
        name?: string;
        message?: string;
        Code?: string;
        code?: string;
        $metadata?: { httpStatusCode?: number; requestId?: string };
      };
      console.error("[S3Backend] testConnection failed:", {
        name: e?.name,
        message: e?.message,
        code: e?.Code ?? e?.code,
        httpStatus: e?.$metadata?.httpStatusCode,
        requestId: e?.$metadata?.requestId,
      });
      return false;
    }
  }

  async ensureDirectories(): Promise<void> {
    // S3 doesn't have directories, but we create placeholder objects
    // to ensure the bucket is accessible
    try {
      await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          MaxKeys: 1,
          Prefix: `${this.remoteRoot}/`,
        }),
      );
    } catch (e) {
      const error = e as { name?: string };
      // If bucket doesn't exist, try to create it
      if (error.name === "NoSuchBucket") {
        await this.client.send(
          new CreateBucketCommand({
            Bucket: this.config.bucket,
          }),
        );
      } else {
        throw e;
      }
    }
  }

  async put(path: string, data: Uint8Array): Promise<void> {
    const key = this.normalizePath(path);
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: data,
      }),
    );
  }

  async get(path: string): Promise<Uint8Array> {
    const key = this.normalizePath(path);
    const response = await this.client.send(
      new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }),
    );
    const body = await response.Body?.transformToByteArray();
    if (!body) {
      throw new Error(`Empty response body for ${path}`);
    }
    return body;
  }

  async getJSON<T>(path: string): Promise<T | null> {
    try {
      const data = await this.get(path);
      const text = new TextDecoder().decode(data);
      return JSON.parse(text) as T;
    } catch (e) {
      const error = e as { name?: string };
      if (error.name === "NoSuchKey" || error.name === "NotFound") {
        return null;
      }
      throw e;
    }
  }

  async putJSON<T>(path: string, data: T): Promise<void> {
    const json = JSON.stringify(data);
    await this.put(path, new TextEncoder().encode(json));
  }

  async listDir(path: string): Promise<RemoteFile[]> {
    let prefix = this.normalizePath(path);
    if (!prefix.endsWith("/")) prefix = `${prefix}/`;
    console.log(`[S3Backend] LIST ${path} -> prefix "${prefix}"`);

    for (const mode of ["v2-delimiter", "v2-flat", "v1-delimiter", "v1-flat"] as const) {
      const files = await this.tryListObjectsAtPrefix(path, prefix, {
        label: mode,
        version: mode.startsWith("v1") ? "v1" : "v2",
        delimiter: mode.endsWith("delimiter") ? "/" : undefined,
      });
      if (files.length > 0) {
        console.log(`[S3Backend] LIST ${path} ${mode} found ${files.length} item(s)`);
        return files;
      }
    }

    const parentPrefix = this.getParentPrefix(prefix);
    if (parentPrefix && parentPrefix !== prefix) {
      for (const version of ["v2", "v1"] as const) {
        const parentFiles = await this.tryListObjectsAtPrefix(path, parentPrefix, {
          label: `${version} parent-prefix fallback`,
          version,
          childPrefix: prefix,
        });
        if (parentFiles.length > 0) {
          console.log(
            `[S3Backend] LIST ${path} ${version} parent-prefix fallback found ${parentFiles.length} item(s)`,
          );
          return parentFiles;
        }
      }
    }

    console.log(`[S3Backend] LIST ${path} found 0 item(s)`);
    return [];
  }

  private async tryListObjectsAtPrefix(
    path: string,
    prefix: string,
    options: {
      label: string;
      version: "v1" | "v2";
      delimiter?: string;
      childPrefix?: string;
    },
  ): Promise<RemoteFile[]> {
    const { label, ...listOptions } = options;
    try {
      return await this.listObjectsAtPrefix(prefix, listOptions);
    } catch (error) {
      console.warn(
        `[S3Backend] LIST ${path} ${label} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private async listObjectsAtPrefix(
    prefix: string,
    options: {
      version: "v1" | "v2";
      delimiter?: string;
      childPrefix?: string;
    },
  ): Promise<RemoteFile[]> {
    const files: RemoteFile[] = [];
    let continuationToken: string | undefined;
    let marker: string | undefined;
    let isTruncated = false;
    const targetPrefix = options.childPrefix ?? prefix;
    const targetLogicalPrefix = this.toLogicalPath(targetPrefix);

    do {
      const response =
        options.version === "v2"
          ? ((await this.client.send(
              new ListObjectsV2Command({
                Bucket: this.config.bucket,
                Prefix: prefix,
                Delimiter: options.delimiter,
                ContinuationToken: continuationToken,
              }),
            )) as S3ListResponse)
          : ((await this.client.send(
              new ListObjectsCommand({
                Bucket: this.config.bucket,
                Prefix: prefix,
                Delimiter: options.delimiter,
                Marker: marker,
              }),
            )) as S3ListResponse);

      const contentCount = response.Contents?.length ?? 0;
      const prefixCount = response.CommonPrefixes?.length ?? 0;
      console.log(
        `[S3Backend] LIST ${options.version} prefix "${prefix}" delimiter "${options.delimiter ?? ""}" returned ${contentCount} object(s), ${prefixCount} prefix(es)`,
      );

      // Subdirectories at this level (S3 has no true folders; CommonPrefixes simulates them).
      for (const cp of response.CommonPrefixes ?? []) {
        if (!cp.Prefix) continue;
        if (options.childPrefix && !cp.Prefix.startsWith(options.childPrefix)) continue;
        const name = cp.Prefix.replace(/\/$/, "").split("/").pop() || cp.Prefix;
        files.push({
          name,
          path: this.toLogicalPath(cp.Prefix),
          size: 0,
          lastModified: 0,
          isDirectory: true,
        });
      }

      for (const object of response.Contents ?? []) {
        if (!object.Key) continue;
        if (!object.Key.startsWith(targetPrefix)) continue;
        if (object.Key === targetPrefix) continue; // placeholder marker for the dir itself
        const name = object.Key.substring(targetPrefix.length);
        if (!name || name.includes("/")) continue; // safety against deeper entries
        files.push({
          name,
          path: `${targetLogicalPrefix.replace(/\/$/, "")}/${name}`,
          size: toContentSize(object.Size),
          lastModified: toTimestampMs(object.LastModified),
          isDirectory: false,
        });
      }

      continuationToken = response.NextContinuationToken;
      isTruncated = response.IsTruncated ?? false;
      const contents = response.Contents ?? [];
      marker = response.NextMarker ?? contents[contents.length - 1]?.Key;
    } while (
      options.version === "v2" ? Boolean(continuationToken) : Boolean(isTruncated && marker)
    );

    return files;
  }

  private getParentPrefix(prefix: string): string | null {
    const trimmed = prefix.replace(/\/+$/, "");
    const slashIndex = trimmed.lastIndexOf("/");
    if (slashIndex <= 0) return null;
    return `${trimmed.slice(0, slashIndex + 1)}`;
  }

  async delete(path: string): Promise<void> {
    const key = this.normalizePath(path);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }),
    );
  }

  async exists(path: string): Promise<boolean> {
    const key = this.normalizePath(path);
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async move(fromPath: string, toPath: string): Promise<void> {
    const fromKey = this.normalizePath(fromPath);
    const toKey = this.normalizePath(toPath);
    // CopySource: bucket and key, URL-encoded per AWS docs (segments encoded, slashes preserved).
    const encodedSource = `${this.config.bucket}/${fromKey}`
      .split("/")
      .map((seg) => encodeURIComponent(seg))
      .join("/");
    await this.client.send(
      new CopyObjectCommand({
        Bucket: this.config.bucket,
        CopySource: encodedSource,
        Key: toKey,
      }),
    );
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.config.bucket,
        Key: fromKey,
      }),
    );
  }

  async getDisplayName(): Promise<string> {
    const url = new URL(this.config.endpoint);
    return `S3 (${this.config.bucket} @ ${url.host})`;
  }

  /**
   * Normalize path for S3 key.
   * Maps ReadAny logical paths (/readany/...) into the configured S3 prefix.
   */
  private normalizePath(path: string): string {
    return normalizeS3Key(this.remoteRoot, path);
  }

  private toLogicalPath(key: string): string {
    return s3KeyToLogicalPath(this.remoteRoot, key);
  }
}

/**
 * Create an S3 backend from configuration.
 */
export function createS3Backend(config: S3Config, secretAccessKey: string): S3Backend {
  return new S3Backend(config, secretAccessKey);
}
