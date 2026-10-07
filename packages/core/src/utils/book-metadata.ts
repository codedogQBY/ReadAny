import type { Book, BookMeta, BookReview } from "../types";
import { generateId } from "./generate-id";

export interface BookMetadataFormValues {
  title: string;
  author: string;
  coverUrl: string;
  publisher: string;
  language: string;
  isbn: string;
  publishDate: string;
  rating: number | null;
  description: string;
  reviews: BookReview[];
  subjectsText: string;
  tagsText: string;
  groupId: string;
}

export interface ExtractedBookMetadata {
  title?: string;
  author?: string;
  coverUrl?: string;
  publisher?: string;
  language?: string;
  isbn?: string;
  publishDate?: string;
  description?: string;
  subjects?: string[];
}

export function mergeBookMetadataSources(
  ...sources: Array<Partial<BookMeta> | ExtractedBookMetadata | null | undefined>
): Partial<BookMeta> {
  const [saved, ...fillSources] = sources;
  const result: Partial<BookMeta> = saved ? { ...saved } : {};
  const publicationKeys: Array<keyof ExtractedBookMetadata> = [
    "title",
    "author",
    "coverUrl",
    "publisher",
    "language",
    "isbn",
    "publishDate",
    "description",
    "subjects",
  ];

  for (const key of publicationKeys) {
    const value = result[key];
    const populated = Array.isArray(value)
      ? value.some((item) => typeof item === "string" && item.trim())
      : typeof value === "string" && Boolean(value.trim());
    if (!populated) delete result[key];
  }

  const text = (key: keyof BookMeta, value: unknown) => {
    if (result[key] != null || typeof value !== "string") return;
    const trimmed = value.trim();
    if (trimmed) Object.assign(result, { [key]: trimmed });
  };

  for (const source of fillSources) {
    if (!source) continue;
    text("title", source.title);
    text("author", source.author);
    text("publisher", source.publisher);
    if (result.language == null) text("language", normalizeBookLanguage(source.language));
    if (result.isbn == null) text("isbn", normalizeIsbn(source.isbn));
    if (result.publishDate == null) text("publishDate", normalizePublishDate(source.publishDate));
    text("description", source.description);
    text("coverUrl", "coverUrl" in source ? source.coverUrl : undefined);
    if (result.subjects == null) {
      const subjects = normalizeSubjects(source.subjects);
      if (subjects.length) result.subjects = subjects;
    }
  }
  return result;
}

export function createBookMetadataFormValues(book: Book): BookMetadataFormValues {
  return {
    title: book.meta.title || "",
    author: book.meta.author || "",
    coverUrl: book.meta.coverUrl || "",
    publisher: book.meta.publisher || "",
    language: book.meta.language || "",
    isbn: book.meta.isbn || "",
    publishDate: book.meta.publishDate || "",
    rating: normalizeRating(book.meta.rating) ?? null,
    description: book.meta.description || "",
    reviews: normalizeReviews(book.meta.reviews),
    subjectsText: joinEditableList(book.meta.subjects),
    tagsText: joinEditableList(book.tags),
    groupId: book.groupId || "",
  };
}

export function hasMissingBookMetadataAutoFillTargets(values: BookMetadataFormValues): boolean {
  return (
    !values.coverUrl.trim() ||
    !values.publisher.trim() ||
    !values.language.trim() ||
    !values.isbn.trim() ||
    !values.publishDate.trim() ||
    !values.description.trim() ||
    !values.subjectsText.trim()
  );
}

export function mergeMissingBookMetadataValues(
  values: BookMetadataFormValues,
  extracted: ExtractedBookMetadata,
): BookMetadataFormValues | null {
  type TextMetadataField = {
    [K in keyof BookMetadataFormValues]: BookMetadataFormValues[K] extends string ? K : never;
  }[keyof BookMetadataFormValues];
  let changed = false;
  const next: BookMetadataFormValues = { ...values };
  const fillText = (field: TextMetadataField, value: unknown) => {
    if (next[field].trim()) return;
    if (typeof value !== "string") return;
    const trimmed = value.trim();
    if (!trimmed) return;
    next[field] = trimmed;
    changed = true;
  };

  fillText("title", extracted.title);
  fillText("author", extracted.author);
  fillText("coverUrl", extracted.coverUrl);
  fillText("publisher", extracted.publisher);
  fillText("language", normalizeBookLanguage(extracted.language));
  fillText("isbn", normalizeIsbn(extracted.isbn));
  fillText("publishDate", normalizePublishDate(extracted.publishDate));
  fillText("description", extracted.description);

  const subjects = normalizeSubjects(extracted.subjects);
  if (subjects.length > 0) {
    const subjectsText = joinEditableList(subjects);
    if (!next.subjectsText.trim()) {
      next.subjectsText = subjectsText;
      changed = true;
    }
  }

  return changed ? next : null;
}

export function applyBookMetadataFormUpdate(
  valuesRef: { current: BookMetadataFormValues | null },
  setValues: (values: BookMetadataFormValues) => void,
  update: BookMetadataFormValues | ((current: BookMetadataFormValues) => BookMetadataFormValues),
): BookMetadataFormValues | null {
  const current = valuesRef.current;
  if (!current && typeof update === "function") return null;
  const next = typeof update === "function" ? update(current as BookMetadataFormValues) : update;
  valuesRef.current = next;
  setValues(next);
  return next;
}

export function splitEditableList(value: string): string[] {
  const seen = new Set<string>();
  const items: string[] = [];

  for (const raw of value.split(/[,，、\n]/)) {
    const item = raw.trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    items.push(item);
  }

  return items;
}

export function joinEditableList(values?: string[]): string {
  return (values || []).filter(Boolean).join(", ");
}

function normalizeBookLanguage(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim().replace("_", "-");
  if (!normalized) return "";
  const lower = normalized.toLowerCase();
  if (lower === "zh" || lower === "zh-cn" || lower.startsWith("zh-hans")) return "zh-CN";
  if (lower === "zh-tw" || lower === "zh-hk" || lower.startsWith("zh-hant")) return "zh-TW";
  if (lower.startsWith("en")) return "en";
  if (lower.startsWith("ja") || lower.startsWith("jp")) return "ja";
  if (lower.startsWith("ko")) return "ko";
  if (lower.startsWith("fr")) return "fr";
  if (lower.startsWith("es")) return "es";
  if (lower.startsWith("de")) return "de";
  if (lower.startsWith("it")) return "it";
  if (lower.startsWith("pt")) return "pt";
  if (lower.startsWith("ru")) return "ru";
  return normalized;
}

export function normalizeIsbn(value: unknown): string {
  if (typeof value !== "string") return "";
  const candidates = value.matchAll(
    /(?:^|[^\dXx])((?:97[89](?:[-\s]*\d){10}|(?:\d[-\s]*){9}[\dXx]))(?![\dXx])/g,
  );
  for (const match of candidates) {
    const candidate = match[1];
    const compact = candidate.replace(/[-\s]/g, "").toUpperCase();
    if (isValidIsbn10(compact) || isValidIsbn13(compact)) return compact;
  }
  return "";
}

function isValidIsbn10(value: string): boolean {
  if (!/^\d{9}[\dX]$/.test(value)) return false;
  const sum = Array.from(value).reduce((total, char, index) => {
    const digit = char === "X" ? 10 : Number(char);
    return total + digit * (10 - index);
  }, 0);
  return sum % 11 === 0;
}

function isValidIsbn13(value: string): boolean {
  if (!/^97[89]\d{10}$/.test(value)) return false;
  const sum = Array.from(value).reduce(
    (total, char, index) => total + Number(char) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return sum % 10 === 0;
}

function normalizePublishDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})(?:([-/.])(\d{1,2})(?:\2(\d{1,2}))?)?$/);
  if (!match) return "";
  const year = match[1];
  if (!match[3]) return year;

  const month = Number(match[3]);
  if (month < 1 || month > 12) return "";
  const normalizedMonth = match[3].padStart(2, "0");
  if (!match[4]) return `${year}-${normalizedMonth}`;

  const numericYear = Number(year);
  const isLeapYear = numericYear % 4 === 0 && (numericYear % 100 !== 0 || numericYear % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const day = Number(match[4]);
  if (day < 1 || day > daysInMonth[month - 1]) return "";

  return `${year}-${normalizedMonth}-${match[4].padStart(2, "0")}`;
}

function normalizeSubjects(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const subjects: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const subject = value.trim();
    if (!subject || seen.has(subject)) continue;
    seen.add(subject);
    subjects.push(subject);
  }
  return subjects;
}

export function createEmptyBookReview(): BookReview {
  const now = Date.now();
  return {
    id: generateId(),
    content: "",
    createdAt: now,
    updatedAt: now,
  };
}

export function normalizeRating(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value);
  if (rounded < 1 || rounded > 5) return undefined;
  return rounded;
}

export function normalizeReviews(value: unknown): BookReview[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((review) => {
      if (!review || typeof review !== "object") return null;
      const raw = review as Partial<BookReview>;
      const content = typeof raw.content === "string" ? raw.content.trim() : "";
      if (!content) return null;
      const createdAt =
        typeof raw.createdAt === "number" && Number.isFinite(raw.createdAt)
          ? raw.createdAt
          : Date.now();
      const updatedAt =
        typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)
          ? raw.updatedAt
          : createdAt;
      return {
        id: raw.id || generateId(),
        content,
        createdAt,
        updatedAt,
      };
    })
    .filter((review): review is BookReview => Boolean(review));
}

export function buildBookMetadataUpdate(
  book: Book,
  values: BookMetadataFormValues,
): { meta: BookMeta; tags: string[]; groupId?: string } {
  const title = values.title.trim() || book.meta.title || "Untitled";
  const author = values.author.trim();
  const publisher = values.publisher.trim();
  const language = values.language.trim();
  const isbn = values.isbn.trim();
  const publishDate = values.publishDate.trim();
  const description = values.description.trim();
  const subjects = splitEditableList(values.subjectsText);
  const rating = normalizeRating(values.rating);
  const originalReviews = new Map((book.meta.reviews || []).map((review) => [review.id, review]));
  const reviews = values.reviews
    .map((review) => {
      const content = review.content.trim();
      if (!content) return null;
      const original = originalReviews.get(review.id);
      const createdAt = review.createdAt || original?.createdAt || Date.now();
      const updatedAt =
        original && original.content.trim() === content ? original.updatedAt : Date.now();
      return {
        id: review.id || generateId(),
        content,
        createdAt,
        updatedAt,
      };
    })
    .filter((review): review is BookReview => Boolean(review));

  return {
    meta: {
      ...book.meta,
      title,
      author,
      coverUrl: values.coverUrl.trim(),
      publisher: publisher || undefined,
      language: language || undefined,
      isbn: isbn || undefined,
      publishDate: publishDate || undefined,
      rating,
      description: description || undefined,
      reviews: reviews.length > 0 ? reviews : undefined,
      subjects: subjects.length > 0 ? subjects : undefined,
    },
    tags: splitEditableList(values.tagsText),
    groupId: values.groupId || undefined,
  };
}
