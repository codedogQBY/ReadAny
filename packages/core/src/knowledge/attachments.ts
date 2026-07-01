import type { KnowledgeAttachmentKind } from "../types";
import type { JSONValue } from "../types";

export const READANY_ATTACHMENT_URI_PREFIX = "readany-attachment://";

const IMAGE_EXTENSIONS = new Set(["avif", "bmp", "gif", "jpeg", "jpg", "png", "svg", "webp"]);
const AUDIO_EXTENSIONS = new Set(["aac", "flac", "m4a", "mp3", "ogg", "wav", "weba"]);
const VIDEO_EXTENSIONS = new Set(["avi", "m4v", "mov", "mp4", "mpeg", "webm"]);

const MIME_BY_EXTENSION: Record<string, string> = {
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  svg: "image/svg+xml",
  webp: "image/webp",
  aac: "audio/aac",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  wav: "audio/wav",
  weba: "audio/webm",
  avi: "video/x-msvideo",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  webm: "video/webm",
  pdf: "application/pdf",
};

export function createKnowledgeAttachmentUri(attachmentId: string): string {
  return `${READANY_ATTACHMENT_URI_PREFIX}${encodeURIComponent(attachmentId)}`;
}

export function parseKnowledgeAttachmentUri(value: string): string | undefined {
  if (!value.startsWith(READANY_ATTACHMENT_URI_PREFIX)) return undefined;
  const encoded = value.slice(READANY_ATTACHMENT_URI_PREFIX.length);
  if (!encoded) return undefined;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return encoded;
  }
}

export function basenameFromPath(path: string, fallback = "attachment"): string {
  const normalized = path.replace(/\\/g, "/").replace(/[?#].*$/, "");
  const name = normalized.split("/").filter(Boolean).pop()?.trim();
  return name || fallback;
}

export function sanitizeKnowledgeAttachmentFileName(fileName: string, fallback = "attachment") {
  const trimmed = fileName.trim();
  const cleaned = Array.from(trimmed)
    .map((char) => (char.charCodeAt(0) < 32 || /[\\/:*?"<>|#^[\]]/.test(char) ? " " : char))
    .join("")
    .replace(/\s+/g, " ");
  return (cleaned.trim() || fallback).slice(0, 120);
}

export function extensionFromFileName(fileName: string): string {
  const name = fileName.toLowerCase();
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === name.length - 1) return "";
  return name.slice(dotIndex + 1);
}

export function inferKnowledgeAttachmentKind(
  fileName: string,
  mimeType?: string,
): KnowledgeAttachmentKind {
  const normalizedMime = mimeType?.toLowerCase() ?? "";
  if (normalizedMime.startsWith("image/")) return "image";
  if (normalizedMime.startsWith("audio/")) return "audio";
  if (normalizedMime.startsWith("video/")) return "video";
  if (normalizedMime === "application/pdf") return "pdf";

  const extension = extensionFromFileName(fileName);
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (extension === "pdf") return "pdf";
  return "file";
}

export function inferKnowledgeAttachmentMimeType(fileName: string): string | undefined {
  return MIME_BY_EXTENSION[extensionFromFileName(fileName)];
}

export function createKnowledgeAttachmentHash(data: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of data) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function resolveKnowledgeAttachmentImageSources(
  contentJson: JSONValue,
  resolveSrc: (attachmentId: string) => string | undefined,
): JSONValue {
  return resolveKnowledgeAttachmentImageSourcesNode(contentJson, resolveSrc) as JSONValue;
}

export function canonicalizeKnowledgeAttachmentImageSources(contentJson: JSONValue): JSONValue {
  return resolveKnowledgeAttachmentImageSources(contentJson, createKnowledgeAttachmentUri);
}

function resolveKnowledgeAttachmentImageSourcesNode(
  value: JSONValue,
  resolveSrc: (attachmentId: string) => string | undefined,
): JSONValue {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const resolved = resolveKnowledgeAttachmentImageSourcesNode(item, resolveSrc);
      changed ||= resolved !== item;
      return resolved;
    });
    return changed ? next : value;
  }

  if (!value || typeof value !== "object") return value;

  let changed = false;
  const next: Record<string, JSONValue> = {};
  for (const [key, item] of Object.entries(value)) {
    const resolved = resolveKnowledgeAttachmentImageSourcesNode(item, resolveSrc);
    changed ||= resolved !== item;
    next[key] = resolved;
  }

  if (value.type === "image" && value.attrs && typeof value.attrs === "object") {
    const attrs = value.attrs as Record<string, JSONValue>;
    const src = typeof attrs.src === "string" ? attrs.src.trim() : "";
    const explicitAttachmentId =
      typeof attrs.attachmentId === "string" ? attrs.attachmentId.trim() : "";
    const attachmentId = explicitAttachmentId || parseKnowledgeAttachmentUri(src) || "";
    const resolvedSrc = attachmentId ? resolveSrc(attachmentId) : undefined;
    if (resolvedSrc && (attrs.src !== resolvedSrc || attrs.attachmentId !== attachmentId)) {
      next.attrs = {
        ...attrs,
        attachmentId,
        src: resolvedSrc,
      };
      changed = true;
    }
  }

  return changed ? next : value;
}
