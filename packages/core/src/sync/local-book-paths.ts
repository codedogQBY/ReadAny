const DEFAULT_BOOK_EXTENSION = "epub";
const DEFAULT_COVER_EXTENSION = "jpg";

function normalizeExtension(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim().toLowerCase().replace(/^\./, "");
  return /^[a-z0-9]+$/.test(trimmed) ? trimmed : "";
}

export function getPathExtension(path: unknown): string {
  if (typeof path !== "string") return "";
  const cleanPath = path.split(/[?#]/, 1)[0].replace(/\\/g, "/");
  const leaf = cleanPath.slice(cleanPath.lastIndexOf("/") + 1);
  const dot = leaf.lastIndexOf(".");
  return dot >= 0 ? normalizeExtension(leaf.slice(dot + 1)) : "";
}

export function canonicalBookFilePath(
  bookId: unknown,
  filePath: unknown,
  format?: unknown,
): string {
  const id = String(bookId || "").trim();
  const ext = getPathExtension(filePath) || normalizeExtension(format) || DEFAULT_BOOK_EXTENSION;
  return id ? `books/${id}.${ext}` : "";
}

export function canonicalBookCoverPath(bookId: unknown, coverUrl: unknown): string | null {
  if (coverUrl == null || coverUrl === "") return null;
  if (typeof coverUrl === "string" && /^https?:\/\//i.test(coverUrl)) {
    return coverUrl;
  }

  const id = String(bookId || "").trim();
  if (!id) return typeof coverUrl === "string" ? coverUrl : null;

  const ext = getPathExtension(coverUrl) || DEFAULT_COVER_EXTENSION;
  return `covers/${id}.${ext}`;
}
