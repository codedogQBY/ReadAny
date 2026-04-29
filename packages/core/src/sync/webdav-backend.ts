/**
 * WebDAV sync backend implementation.
 * Wraps WebDavClient to implement ISyncBackend interface.
 */

import {
  DEFAULT_WEBDAV_REMOTE_ROOT,
  type ISyncBackend,
  type RemoteFile,
  type WebDavConfig,
} from "./sync-backend";
import { REMOTE_COVERS, REMOTE_DATA, REMOTE_FILES } from "./sync-types";
import { WebDavClient, sanitizeWebDavRemoteRoot } from "./webdav-client";

/**
 * WebDAV backend implementation.
 * Uses the existing WebDavClient for all operations.
 */
export class WebDavBackend implements ISyncBackend {
  readonly type = "webdav" as const;
  private client: WebDavClient;
  private config: WebDavConfig;

  constructor(config: WebDavConfig, password: string) {
    this.config = config;
    this.client = new WebDavClient(config.url, config.username, password, config.allowInsecure);
  }

  private getRemoteRoot(): string {
    return (
      sanitizeWebDavRemoteRoot(this.config.remoteRoot ?? DEFAULT_WEBDAV_REMOTE_ROOT) ||
      DEFAULT_WEBDAV_REMOTE_ROOT
    );
  }

  private baseUrlAlreadyIncludesRemoteRoot(): boolean {
    try {
      const remoteRoot = this.getRemoteRoot();
      const basePath = new URL(this.config.url).pathname.replace(/^\/+|\/+$/g, "");
      return basePath === remoteRoot || basePath.endsWith(`/${remoteRoot}`);
    } catch {
      return false;
    }
  }

  private resolvePath(path: string): string {
    const remoteRoot = this.getRemoteRoot();
    const resolved = path.replace(/^\/readany(?=\/|$)/, `/${remoteRoot}`);
    if (
      this.baseUrlAlreadyIncludesRemoteRoot() &&
      (resolved === `/${remoteRoot}` || resolved.startsWith(`/${remoteRoot}/`))
    ) {
      const deduped = resolved.slice(remoteRoot.length + 1);
      return deduped ? (deduped.startsWith("/") ? deduped : `/${deduped}`) : "/";
    }
    return resolved;
  }

  async testConnection(): Promise<boolean> {
    await this.client.testConnection();
    await this.ensureDirectories();
    return true;
  }

  async ensureDirectories(): Promise<void> {
    // Create directories for the new simple sync (JSON-based)
    await this.client.ensureDirectory(this.resolvePath("/readany/sync"));
    // Legacy directories for file sync (if needed)
    await this.client.ensureDirectory(this.resolvePath(REMOTE_DATA));
    await this.client.mkcol(this.resolvePath(REMOTE_FILES));
    await this.client.mkcol(this.resolvePath(REMOTE_COVERS));
  }

  async put(path: string, data: Uint8Array): Promise<void> {
    await this.client.put(this.resolvePath(path), data);
  }

  async get(path: string): Promise<Uint8Array> {
    return this.client.get(this.resolvePath(path));
  }

  async getJSON<T>(path: string): Promise<T | null> {
    return this.client.getJSON<T>(this.resolvePath(path));
  }

  async putJSON<T>(path: string, data: T): Promise<void> {
    await this.client.putJSON(this.resolvePath(path), data);
  }

  async listDir(path: string): Promise<RemoteFile[]> {
    const resources = await this.client.safeReadDir(this.resolvePath(path));
    return resources.map((r) => ({
      name: r.name,
      path: r.href,
      size: r.contentLength ?? 0,
      lastModified: r.lastModified ? new Date(r.lastModified).getTime() : 0,
      isDirectory: r.isCollection,
    }));
  }

  async delete(path: string): Promise<void> {
    await this.client.delete(this.resolvePath(path));
  }

  async exists(path: string): Promise<boolean> {
    return this.client.exists(this.resolvePath(path));
  }

  async getDisplayName(): Promise<string> {
    const url = new URL(this.config.url);
    return `WebDAV (${url.host})`;
  }
}

/**
 * Create a WebDAV backend from configuration.
 */
export function createWebDavBackend(config: WebDavConfig, password: string): WebDavBackend {
  return new WebDavBackend(config, password);
}
