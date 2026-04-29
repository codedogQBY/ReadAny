import { WebDavClient, sanitizeWebDavUrl } from "../sync/webdav-client";
import {
  type WebDavImportEntry,
  type WebDavImportListing,
  type WebDavImportSource,
  getWebDavImportExtension,
  isImportableWebDavBookName,
  normalizeWebDavImportPath,
  normalizeWebDavImportRoot,
} from "./webdav-import-types";

function splitPathSegments(path: string): string[] {
  return path.split("/").filter(Boolean);
}

function safeDecodeWebDavPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function endsWithSegments(pathSegments: string[], suffixSegments: string[]): boolean {
  if (suffixSegments.length === 0) return true;
  if (pathSegments.length < suffixSegments.length) return false;

  const offset = pathSegments.length - suffixSegments.length;
  for (let index = 0; index < suffixSegments.length; index += 1) {
    if (pathSegments[offset + index] !== suffixSegments[index]) return false;
  }
  return true;
}

export function getWebDavImportRootPrefix(source: WebDavImportSource): string {
  const sanitizedUrl = sanitizeWebDavUrl(source.url);
  const remoteRoot = normalizeWebDavImportRoot(source.remoteRoot);
  const basePathname = new URL(sanitizedUrl).pathname.replace(/\/+$/, "");
  const baseSegments = splitPathSegments(basePathname);
  const remoteSegments = splitPathSegments(remoteRoot ?? "");

  if (remoteSegments.length === 0) {
    return baseSegments.length > 0 ? `/${baseSegments.join("/")}` : "/";
  }

  if (endsWithSegments(baseSegments, remoteSegments)) {
    return baseSegments.length > 0 ? `/${baseSegments.join("/")}` : "/";
  }

  const merged = [...baseSegments, ...remoteSegments];
  return merged.length > 0 ? `/${merged.join("/")}` : "/";
}

export function resolveWebDavImportServerPath(
  source: WebDavImportSource,
  relativePath: string,
): string {
  const rootPrefix = getWebDavImportRootPrefix(source);
  const normalizedRelativePath = normalizeWebDavImportPath(relativePath);
  if (rootPrefix === "/") return normalizedRelativePath;
  if (normalizedRelativePath === "/") return rootPrefix;
  return `${rootPrefix}${normalizedRelativePath}`.replace(/\/{2,}/g, "/");
}

export function toWebDavImportRelativePath(source: WebDavImportSource, href: string): string {
  const rootPrefix = getWebDavImportRootPrefix(source).replace(/\/+$/, "") || "/";
  const sanitizedUrl = sanitizeWebDavUrl(source.url);

  let pathname = href;
  try {
    pathname = new URL(href, sanitizedUrl).pathname;
  } catch {
    pathname = href;
  }

  pathname = safeDecodeWebDavPath(pathname);

  const normalizedPathname = pathname.replace(/\/+$/, "") || "/";
  if (rootPrefix === "/") {
    return normalizeWebDavImportPath(normalizedPathname);
  }
  if (normalizedPathname === rootPrefix) return "/";
  if (normalizedPathname.startsWith(`${rootPrefix}/`)) {
    return normalizeWebDavImportPath(normalizedPathname.slice(rootPrefix.length));
  }
  return normalizeWebDavImportPath(normalizedPathname);
}

function toImportEntry(
  source: WebDavImportSource,
  resource: {
    name: string;
    path: string;
    size: number;
    lastModified: number;
    isDirectory: boolean;
  },
): WebDavImportEntry {
  return {
    name: resource.name,
    relativePath: toWebDavImportRelativePath(source, resource.path),
    isDirectory: resource.isDirectory,
    size: resource.size,
    lastModified: resource.lastModified,
    extension: resource.isDirectory ? undefined : getWebDavImportExtension(resource.name),
    importable: resource.isDirectory ? false : isImportableWebDavBookName(resource.name),
  };
}

function sortEntries(entries: WebDavImportEntry[]): WebDavImportEntry[] {
  return [...entries].sort((left, right) => {
    if (left.isDirectory !== right.isDirectory) {
      return left.isDirectory ? -1 : 1;
    }
    if (left.importable !== right.importable) {
      return left.importable ? -1 : 1;
    }
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base", numeric: true });
  });
}

export class WebDavImportService {
  private readonly client: WebDavClient;
  private readonly source: WebDavImportSource;

  constructor(source: WebDavImportSource) {
    this.source = {
      ...source,
      url: sanitizeWebDavUrl(source.url),
      username: source.username.trim(),
      remoteRoot: normalizeWebDavImportRoot(source.remoteRoot),
    };
    this.client = new WebDavClient(
      this.source.url,
      this.source.username,
      this.source.password,
      this.source.allowInsecure,
    );
  }

  async testConnection(): Promise<boolean> {
    await this.client.ping();
    await this.client.propfind(resolveWebDavImportServerPath(this.source, "/"));
    return true;
  }

  async list(relativePath = "/"): Promise<WebDavImportListing> {
    const normalizedPath = normalizeWebDavImportPath(relativePath);
    const resources = await this.client.propfind(
      resolveWebDavImportServerPath(this.source, normalizedPath),
    );
    const entries = sortEntries(
      resources.map((resource) =>
        toImportEntry(this.source, {
          name: resource.name,
          path: resource.href,
          size: resource.contentLength ?? 0,
          lastModified: resource.lastModified ? new Date(resource.lastModified).getTime() : 0,
          isDirectory: resource.isCollection,
        }),
      ),
    );

    const parentPath =
      normalizedPath === "/"
        ? null
        : normalizeWebDavImportPath(normalizedPath.split("/").slice(0, -1).join("/") || "/");

    return {
      currentPath: normalizedPath,
      parentPath,
      entries,
      importableCount: entries.filter((entry) => entry.importable).length,
    };
  }

  async collectImportableFiles(relativePath = "/"): Promise<WebDavImportEntry[]> {
    const listing = await this.list(relativePath);
    const collected = listing.entries.filter((entry) => entry.importable);

    for (const directory of listing.entries.filter((entry) => entry.isDirectory)) {
      const nested = await this.collectImportableFiles(directory.relativePath);
      collected.push(...nested);
    }

    return collected;
  }

  async downloadFile(relativePath: string): Promise<Uint8Array> {
    return this.client.get(resolveWebDavImportServerPath(this.source, relativePath));
  }
}
