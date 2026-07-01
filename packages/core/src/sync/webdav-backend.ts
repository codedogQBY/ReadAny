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
import {
  REMOTE_BOOKS_ROOT,
  REMOTE_COVERS,
  REMOTE_DATA,
  REMOTE_FILES,
  REMOTE_KNOWLEDGE_ATTACHMENTS,
  REMOTE_KNOWLEDGE_ROOT,
} from "./sync-types";
import { WebDavClient, sanitizeWebDavRemoteRoot } from "./webdav-client";

/**
 * WebDAV backend implementation.
 * Uses the existing WebDavClient for all operations.
 */
export class WebDavBackend implements ISyncBackend {
  readonly type = "webdav" as const;
  private client: WebDavClient;
  private config: WebDavConfig;
  private directoriesEnsured = false;

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

  private joinLogicalPath(parentPath: string, name: string): string {
    const parent = parentPath.replace(/\/+$/, "") || "/";
    const encodedName = name.replace(/^\/+|\/+$/g, "");
    return parent === "/" ? `/${encodedName}` : `${parent}/${encodedName}`;
  }

  async testConnection(): Promise<boolean> {
    await this.client.testConnection();
    await this.ensureDirectories();
    return true;
  }

  async ensureDirectories(): Promise<void> {
    if (this.directoriesEnsured) return;

    // Create directories for the new simple sync (JSON-based)
    await this.client.ensureDirectory(this.resolvePath("/readany/sync"));
    await this.client.ensureDirectory(this.resolvePath(REMOTE_DATA));
    // New per-book layout root
    await this.client.ensureDirectory(this.resolvePath(REMOTE_BOOKS_ROOT));
    await this.client.ensureDirectory(this.resolvePath(REMOTE_KNOWLEDGE_ROOT));
    await this.client.ensureDirectory(this.resolvePath(REMOTE_KNOWLEDGE_ATTACHMENTS));
    // Legacy directories kept ensured during the transition window (cheap & safe)
    await this.client.mkcol(this.resolvePath(REMOTE_FILES));
    await this.client.mkcol(this.resolvePath(REMOTE_COVERS));
    this.directoriesEnsured = true;
  }

  async put(path: string, data: Uint8Array): Promise<void> {
    const resolved = this.resolvePath(path);
    try {
      await this.client.put(resolved, data);
    } catch (e) {
      // Some WebDAV servers (Synology, QNAP, 飞牛, etc.) return 403/404/409 when
      // PUT-ing into a directory that doesn't exist yet. Ensure the parent and
      // retry once — most uploads land on an existing dir, so this catch path
      // only fires for first-time uploads into a brand-new per-book folder.
      const message = e instanceof Error ? e.message : String(e);
      if (!/\b(403|404|409)\b/.test(message)) throw e;
      const parent = resolved.substring(0, resolved.lastIndexOf("/"));
      if (!parent || parent === "/") throw e;
      await this.client.ensureDirectory(parent);
      await this.client.put(resolved, data);
    }
  }

  async putFile(
    path: string,
    localFilePath: string,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    const resolved = this.resolvePath(path);
    try {
      await this.client.putFile(resolved, localFilePath, onProgress);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (!/\b(403|404|409)\b/.test(message)) throw e;
      const parent = resolved.substring(0, resolved.lastIndexOf("/"));
      if (!parent || parent === "/") throw e;
      await this.client.ensureDirectory(parent);
      await this.client.putFile(resolved, localFilePath, onProgress);
    }
  }

  async get(path: string): Promise<Uint8Array> {
    return this.client.get(this.resolvePath(path));
  }

  async getWithProgress(
    path: string,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<Uint8Array> {
    return this.client.getWithProgress(this.resolvePath(path), onProgress);
  }

  async getFileToPath(
    path: string,
    localFilePath: string,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<void> {
    return this.client.getFileToPath(this.resolvePath(path), localFilePath, onProgress);
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
      path: this.joinLogicalPath(path, r.name),
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

  async move(fromPath: string, toPath: string): Promise<void> {
    // Ensure the parent of the destination exists so MOVE can succeed.
    const destParent = toPath.substring(0, toPath.lastIndexOf("/"));
    if (destParent && destParent !== "/") {
      await this.client.ensureDirectory(this.resolvePath(destParent));
    }
    await this.client.move(this.resolvePath(fromPath), this.resolvePath(toPath));
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
