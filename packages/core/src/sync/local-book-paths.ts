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
  if (typeof coverUrl !== "string") return null;

  const raw = coverUrl.trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  const normalized = raw.replace(/\\/g, "/");
  if (
    !normalized.startsWith("/") &&
    !/^[A-Za-z]:\//.test(normalized) &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(normalized)
  ) {
    const leaf = normalized.slice(normalized.lastIndexOf("/") + 1);
    if (!leaf) return null;
    return normalized.startsWith("covers/") ? normalized : `covers/${leaf}`;
  }

  const id = String(bookId || "").trim();
  if (!id) return normalized;

  const ext = getPathExtension(normalized) || DEFAULT_COVER_EXTENSION;
  return `covers/${id}.${ext}`;
}
