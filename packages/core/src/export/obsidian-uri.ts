export type ObsidianPaneType = "tab" | "split" | "window";

export interface ObsidianOpenUriOptions {
  vault?: string;
  file?: string;
  path?: string;
  paneType?: ObsidianPaneType;
}

export interface ObsidianNewUriOptions {
  vault?: string;
  name?: string;
  file?: string;
  path?: string;
  content?: string;
  paneType?: ObsidianPaneType;
  append?: boolean;
  overwrite?: boolean;
  silent?: boolean;
}

export interface ObsidianSearchUriOptions {
  vault: string;
  query?: string;
}

export interface ObsidianVaultFileUriOptions {
  rootPath: string;
  relativePath: string;
  paneType?: ObsidianPaneType;
}

type ObsidianUriParamValue = string | boolean | undefined | null;

function createObsidianUri(action: string, params: Record<string, ObsidianUriParamValue>): string {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");

  return query ? `obsidian://${action}?${query}` : `obsidian://${action}`;
}

function isAbsoluteFilePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

export function inferObsidianVaultNameFromPath(path: string): string {
  return path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .filter(Boolean)
    .pop() ?? path;
}

export function joinObsidianVaultFilePath(rootPath: string, relativePath: string): string {
  const trimmedRelativePath = relativePath.trim();
  if (!trimmedRelativePath) return rootPath;
  if (isAbsoluteFilePath(trimmedRelativePath)) return trimmedRelativePath;

  const separator = rootPath.includes("\\") && !rootPath.includes("/") ? "\\" : "/";
  return `${rootPath.replace(/[\\/]+$/, "")}${separator}${trimmedRelativePath.replace(/^[\\/]+/, "")}`;
}

export function createObsidianOpenUri(options: ObsidianOpenUriOptions): string {
  return createObsidianUri("open", {
    ...(options.path
      ? { path: options.path }
      : {
          vault: options.vault,
          file: options.file,
        }),
    paneType: options.paneType,
  });
}

export function createObsidianNewUri(options: ObsidianNewUriOptions): string {
  return createObsidianUri("new", {
    ...(options.path
      ? { path: options.path }
      : {
          vault: options.vault,
          file: options.file,
          name: options.name,
        }),
    content: options.content,
    paneType: options.paneType,
    append: options.append,
    overwrite: options.overwrite,
    silent: options.silent,
  });
}

export function createObsidianSearchUri(options: ObsidianSearchUriOptions): string {
  return createObsidianUri("search", {
    vault: options.vault,
    query: options.query,
  });
}

export function createObsidianVaultFileOpenUri(options: ObsidianVaultFileUriOptions): string {
  return createObsidianOpenUri({
    path: joinObsidianVaultFilePath(options.rootPath, options.relativePath),
    paneType: options.paneType,
  });
}

