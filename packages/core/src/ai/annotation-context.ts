import { getHighlights, getNotes } from "../db/database";
import type { Highlight, Note } from "../types";

const DEFAULT_MAX_HIGHLIGHTS = 5;
const DEFAULT_MAX_NOTES = 5;
const DEFAULT_MAX_CHARS = 2200;

export interface AnnotationPromptContextOptions {
  bookId?: string | null;
  query?: string;
  maxHighlights?: number;
  maxNotes?: number;
  maxChars?: number;
}

export interface AnnotationPromptContextInput {
  highlights: Highlight[];
  notes: Note[];
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeQuery(value?: string): string {
  return compactText(value ?? "").toLowerCase();
}

function truncateText(value: string, maxLength: number): string {
  const compacted = compactText(value);
  if (compacted.length <= maxLength) return compacted;
  if (maxLength <= 3) return ".".repeat(Math.max(0, maxLength));
  return `${compacted.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function queryScore(haystacks: string[], normalizedQuery: string): number {
  if (!normalizedQuery) return 0;

  const lowered = haystacks.map((value) => value.toLowerCase());
  if (lowered.some((value) => value.includes(normalizedQuery))) return 200;

  return normalizedQuery
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 8)
    .reduce(
      (score, token) => score + (lowered.some((value) => value.includes(token)) ? 24 : 0),
      0,
    );
}

function sortHighlights(highlights: Highlight[], normalizedQuery: string): Highlight[] {
  return [...highlights].sort(
    (left, right) =>
      queryScore(
        [right.text, right.note ?? "", right.chapterTitle ?? "", right.color],
        normalizedQuery,
      ) -
        queryScore(
          [left.text, left.note ?? "", left.chapterTitle ?? "", left.color],
          normalizedQuery,
        ) ||
      Number(!!right.note) - Number(!!left.note) ||
      right.updatedAt - left.updatedAt ||
      right.createdAt - left.createdAt,
  );
}

function sortNotes(notes: Note[], normalizedQuery: string): Note[] {
  return [...notes].sort(
    (left, right) =>
      queryScore(
        [right.title, right.content, right.chapterTitle ?? "", right.tags.join(" ")],
        normalizedQuery,
      ) -
        queryScore(
          [left.title, left.content, left.chapterTitle ?? "", left.tags.join(" ")],
          normalizedQuery,
        ) ||
      right.updatedAt - left.updatedAt ||
      right.createdAt - left.createdAt,
  );
}

function formatHighlightForPrompt(highlight: Highlight): string {
  const chapter = highlight.chapterTitle?.trim()
    ? `\n  chapter: ${highlight.chapterTitle.trim()}`
    : "";
  const cfi = highlight.cfi.trim() ? `\n  cfi: ${highlight.cfi.trim()}` : "";
  const note = highlight.note?.trim()
    ? `\n  note: ${truncateText(highlight.note, 180)}`
    : "";

  return `- [highlight] ${truncateText(highlight.text, 260)}\n  id: ${highlight.id}${chapter}${cfi}\n  color: ${highlight.color}${note}`;
}

function formatNoteForPrompt(note: Note): string {
  const title = note.title.trim() || "Untitled note";
  const chapter = note.chapterTitle?.trim() ? `\n  chapter: ${note.chapterTitle.trim()}` : "";
  const cfi = note.cfi?.trim() ? `\n  cfi: ${note.cfi.trim()}` : "";
  const tags = note.tags.length > 0 ? `\n  tags: ${note.tags.join(", ")}` : "";

  return `- [note] ${title}\n  id: ${note.id}${chapter}${cfi}${tags}\n  content: ${truncateText(note.content, 300)}`;
}

export function buildAnnotationPromptContext(
  input: AnnotationPromptContextInput,
  options: Omit<AnnotationPromptContextOptions, "bookId"> = {},
): string | undefined {
  const maxHighlights = Math.max(
    0,
    Math.floor(options.maxHighlights ?? DEFAULT_MAX_HIGHLIGHTS),
  );
  const maxNotes = Math.max(0, Math.floor(options.maxNotes ?? DEFAULT_MAX_NOTES));
  const maxChars = Math.max(600, Math.floor(options.maxChars ?? DEFAULT_MAX_CHARS));
  const normalizedQuery = normalizeQuery(options.query);
  const highlights = sortHighlights(input.highlights, normalizedQuery).slice(0, maxHighlights);
  const notes = sortNotes(input.notes, normalizedQuery).slice(0, maxNotes);

  if (highlights.length === 0 && notes.length === 0) return undefined;

  const intro =
    "Bounded snapshot of the user's highlights and notes for the current book. It is prioritized by the current question when available, then by annotated highlights and recent notes. This is not the full annotation set. Use getAnnotations for complete annotation reads; use retrieval/citation tools before making precise book-content claims.";
  const lines = [intro];

  if (highlights.length > 0) {
    lines.push("Highlights:");
    for (const highlight of highlights) lines.push(formatHighlightForPrompt(highlight));
  }

  if (notes.length > 0) {
    lines.push("Notes:");
    for (const note of notes) lines.push(formatNoteForPrompt(note));
  }

  const boundedLines: string[] = [];
  for (const line of lines) {
    const nextText = [...boundedLines, line].join("\n");
    if (nextText.length > maxChars) {
      if (boundedLines.length === 0) boundedLines.push(truncateText(line, maxChars));
      break;
    }
    boundedLines.push(line);
  }

  return boundedLines.length > 1 ? boundedLines.join("\n") : undefined;
}

export async function loadAnnotationPromptContext(
  options: AnnotationPromptContextOptions,
): Promise<string | undefined> {
  const bookId = options.bookId?.trim();
  if (!bookId) return undefined;

  try {
    const [highlights, notes] = await Promise.all([getHighlights(bookId), getNotes(bookId)]);
    return buildAnnotationPromptContext({ highlights, notes }, options);
  } catch (error) {
    console.warn("[annotation-context] Failed to load annotation prompt context:", error);
    return undefined;
  }
}
