/**
 * S3-compatible sync backend implementation.
 * Supports AWS S3, Cloudflare R2, Alibaba OSS, Tencent COS, MinIO, etc.
 */

import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { HttpResponse } from "@smithy/protocol-http";
import { buildQueryString } from "@smithy/querystring-builder";
import { getPlatformService } from "../services/platform";
import type { ISyncBackend, RemoteFile, S3Config } from "./sync-backend";

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
export class S3Backend implements ISyncBackend {
  readonly type = "s3" as const;
  private client: S3Client;
  private config: S3Config;

  constructor(config: S3Config, secretAccessKey: string) {
    this.config = config;
    let requestHandler: PlatformFetchHttpHandler | undefined;
    try {
      const platform = getPlatformService();
      if (platform.isDesktop) {
        requestHandler = new PlatformFetchHttpHandler();
      }
    } catch {
      // Platform service may not be initialized in tests that never touch S3.
    }

    const clientConfig = {
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: config.pathStyle ?? false,
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
        }),
      );
      return true;
    } catch (error) {
      console.error("[S3Backend] testConnection failed:", error);
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
          Prefix: "readany/",
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
    const prefix = this.normalizePath(path);
    const files: RemoteFile[] = [];
    let continuationToken: string | undefined;

    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.config.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );

      for (const object of response.Contents ?? []) {
        if (!object.Key) continue;
        // Skip the directory itself
        if (object.Key === prefix || object.Key === prefix + "/") continue;

        const name = object.Key.split("/").pop() || object.Key;
        files.push({
          name,
          path: object.Key,
          size: object.Size ?? 0,
          lastModified: object.LastModified?.getTime() ?? 0,
          isDirectory: object.Key.endsWith("/"),
        });
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    return files;
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

  async getDisplayName(): Promise<string> {
    const url = new URL(this.config.endpoint);
    return `S3 (${this.config.bucket} @ ${url.host})`;
  }

  /**
   * Normalize path for S3 key.
   * Removes leading slash and ensures consistent format.
   */
  private normalizePath(path: string): string {
    // Remove leading slash and "readany" prefix if present
    let normalized = path.replace(/^\//, "");
    if (!normalized.startsWith("readany/")) {
      normalized = `readany/${normalized}`;
    }
    return normalized;
  }
}

/**
 * Create an S3 backend from configuration.
 */
export function createS3Backend(config: S3Config, secretAccessKey: string): S3Backend {
  return new S3Backend(config, secretAccessKey);
}
