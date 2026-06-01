import { DEFAULT_S3_REMOTE_ROOT } from "./sync-backend";

function stripControlChars(value: string): string {
  return Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 0x20 && code !== 0x7f;
    })
    .join("");
}

export function sanitizeS3RemoteRoot(remoteRoot: string): string {
  return stripControlChars(remoteRoot)
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/\/{2,}/g, "/")
    .toLowerCase();
}

export function normalizeS3Key(remoteRoot: string, path: string): string {
  const root = sanitizeS3RemoteRoot(remoteRoot) || DEFAULT_S3_REMOTE_ROOT;
  let normalized = stripControlChars(path).trim().replace(/^\/+/, "");
  if (normalized === root || normalized.startsWith(`${root}/`)) {
    return normalized;
  }
  normalized = normalized.replace(/^readany(?=\/|$)/, root);
  if (normalized === root || normalized.startsWith(`${root}/`)) {
    return normalized;
  }
  return `${root}/${normalized}`;
}

export function s3KeyToLogicalPath(remoteRoot: string, key: string): string {
  const root = sanitizeS3RemoteRoot(remoteRoot) || DEFAULT_S3_REMOTE_ROOT;
  const normalizedKey = key.replace(/\/+$/, "");
  if (normalizedKey === root) return "/readany";
  if (normalizedKey.startsWith(`${root}/`)) {
    return `/readany/${normalizedKey.slice(root.length + 1)}`;
  }
  return `/${normalizedKey}`;
}
