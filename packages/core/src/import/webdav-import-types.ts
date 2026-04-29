export type WebDavImportSourceKind = "saved" | "temporary";

export interface WebDavImportSource {
  kind: WebDavImportSourceKind;
  url: string;
  username: string;
  password: string;
  remoteRoot?: string;
  allowInsecure?: boolean;
}

export interface WebDavImportEntry {
  name: string;
  relativePath: string;
  isDirectory: boolean;
  size: number;
  lastModified: number;
  extension?: string;
  importable: boolean;
}

export interface WebDavImportListing {
  currentPath: string;
  parentPath: string | null;
  entries: WebDavImportEntry[];
  importableCount: number;
}

export const WEBDAV_IMPORT_SUPPORTED_EXTENSIONS = [
  "epub",
  "pdf",
  "mobi",
  "azw",
  "azw3",
  "cbz",
  "cbr",
  "fb2",
  "fbz",
  "txt",
] as const;

export const DEFAULT_WEBDAV_IMPORT_REMOTE_ROOT = "";

export function normalizeWebDavImportPath(path?: string): string {
  if (!path) return "/";
  const normalized = path.trim().replace(/\/{2,}/g, "/");
  if (!normalized || normalized === "/") return "/";
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return withLeadingSlash.replace(/\/+$/, "") || "/";
}

export function normalizeWebDavImportRoot(path?: string): string | undefined {
  if (!path) return undefined;
  const normalized = path.trim().replace(/\/{2,}/g, "/");
  if (!normalized || normalized === "/") return undefined;
  const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
  const trimmed = withLeadingSlash.replace(/\/+$/, "") || "/";
  return trimmed === "/" ? undefined : trimmed;
}

export function getWebDavImportExtension(name: string): string | undefined {
  const lastDot = name.lastIndexOf(".");
  if (lastDot < 0 || lastDot === name.length - 1) return undefined;
  return name.slice(lastDot + 1).toLowerCase();
}

export function isImportableWebDavBookName(name: string): boolean {
  const ext = getWebDavImportExtension(name);
  return (
    !!ext &&
    WEBDAV_IMPORT_SUPPORTED_EXTENSIONS.includes(
      ext as (typeof WEBDAV_IMPORT_SUPPORTED_EXTENSIONS)[number],
    )
  );
}
