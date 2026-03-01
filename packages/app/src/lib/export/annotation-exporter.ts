/**
 * Annotation Exporter — export highlights and notes in multiple formats
 * Supports: Markdown, JSON, Obsidian (with frontmatter), Notion (clipboard-friendly)
 */
import type { Book, Highlight, Note } from "@/types";

export type ExportFormat = "markdown" | "json" | "obsidian" | "notion";

export interface ExportOptions {
  format: ExportFormat;
  includeNotes: boolean;
  includeHighlights: boolean;
  groupByChapter: boolean;
}

const DEFAULT_OPTIONS: ExportOptions = {
  format: "markdown",
  includeNotes: true,
  includeHighlights: true,
  groupByChapter: true,
};

export class AnnotationExporter {
  /** Export highlights and notes to a string in the specified format */
  export(
    highlights: Highlight[],
    notes: Note[],
    book: Book,
    options: Partial<ExportOptions> = {},
  ): string {
    const opts = { ...DEFAULT_OPTIONS, ...options };

    const filteredHighlights = opts.includeHighlights ? highlights : [];
    const filteredNotes = opts.includeNotes ? notes : [];

    switch (opts.format) {
      case "markdown":
        return this.toMarkdown(filteredHighlights, filteredNotes, book, opts);
      case "json":
        return this.toJSON(filteredHighlights, filteredNotes, book);
      case "obsidian":
        return this.toObsidian(filteredHighlights, filteredNotes, book, opts);
      case "notion":
        return this.toNotion(filteredHighlights, filteredNotes, book);
      default:
        throw new Error(`Unsupported export format: ${opts.format}`);
    }
  }

  /** Trigger a file download with the exported content */
  downloadAsFile(content: string, filename: string, format: ExportFormat): void {
    const mimeType = format === "json" ? "application/json" : "text/markdown";
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();

    // Cleanup
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  /** Copy export content to clipboard */
  async copyToClipboard(content: string): Promise<void> {
    await navigator.clipboard.writeText(content);
  }

  // --- Format implementations ---

  private toMarkdown(
    highlights: Highlight[],
    notes: Note[],
    book: Book,
    options: ExportOptions,
  ): string {
    const lines: string[] = [
      `# ${book.meta.title}`,
      "",
      `**Author:** ${book.meta.author}`,
      `**Exported:** ${new Date().toLocaleDateString()}`,
      `**Highlights:** ${highlights.length} | **Notes:** ${notes.length}`,
      "",
      "---",
      "",
    ];

    if (options.groupByChapter) {
      const grouped = this.groupByChapter(highlights);
      for (const [chapter, chapterHighlights] of grouped) {
        lines.push(`## ${chapter}`, "");
        for (const h of chapterHighlights) {
          lines.push(`> ${h.text}`, "");
          if (h.note) {
            lines.push(`**Note:** ${h.note}`, "");
          }
        }
      }
    } else {
      for (const h of highlights) {
        lines.push(`> ${h.text}`);
        if (h.chapterTitle) {
          lines.push(`> -- *${h.chapterTitle}*`);
        }
        if (h.note) {
          lines.push("", `**Note:** ${h.note}`);
        }
        lines.push("", "---", "");
      }
    }

    // Append standalone notes
    const standaloneNotes = notes.filter((n) => !n.highlightId);
    if (standaloneNotes.length > 0) {
      lines.push("## Notes", "");
      for (const note of standaloneNotes) {
        lines.push(`### ${note.title}`, "");
        if (note.chapterTitle) {
          lines.push(`*${note.chapterTitle}*`, "");
        }
        lines.push(note.content, "", "---", "");
      }
    }

    return lines.join("\n");
  }

  private toJSON(highlights: Highlight[], notes: Note[], book: Book): string {
    return JSON.stringify(
      {
        book: {
          id: book.id,
          title: book.meta.title,
          author: book.meta.author,
          language: book.meta.language,
        },
        exportedAt: new Date().toISOString(),
        highlights: highlights.map((h) => ({
          id: h.id,
          text: h.text,
          color: h.color,
          note: h.note,
          chapter: h.chapterTitle,
          createdAt: new Date(h.createdAt).toISOString(),
        })),
        notes: notes.map((n) => ({
          id: n.id,
          title: n.title,
          content: n.content,
          chapter: n.chapterTitle,
          tags: n.tags,
          createdAt: new Date(n.createdAt).toISOString(),
        })),
      },
      null,
      2,
    );
  }

  private toObsidian(
    highlights: Highlight[],
    notes: Note[],
    book: Book,
    options: ExportOptions,
  ): string {
    const lines: string[] = [
      "---",
      `title: "${book.meta.title}"`,
      `author: "${book.meta.author}"`,
      "type: book-notes",
      `created: ${new Date().toISOString()}`,
      `progress: ${Math.round(book.progress * 100)}%`,
      "tags:",
      "  - book",
      "  - reading-notes",
      ...(book.tags.length > 0 ? book.tags.map((t) => `  - ${t}`) : []),
      "---",
      "",
      `# ${book.meta.title}`,
      "",
      "## Metadata",
      `- **Author:** [[${book.meta.author}]]`,
      `- **Progress:** ${Math.round(book.progress * 100)}%`,
      `- **Exported:** ${new Date().toLocaleDateString()}`,
      "",
      "---",
      "",
      "## Highlights & Notes",
      "",
    ];

    const grouped = options.groupByChapter
      ? this.groupByChapter(highlights)
      : new Map([["All", highlights]]);

    for (const [chapter, chapterHighlights] of grouped) {
      if (options.groupByChapter) {
        lines.push(`### ${chapter}`, "");
      }
      for (const h of chapterHighlights) {
        lines.push("> [!quote] Highlight");
        lines.push(`> ${h.text}`, "");
        if (h.note) {
          lines.push(`**Note:** ${h.note}`, "");
        }
      }
    }

    // Standalone notes
    const standaloneNotes = notes.filter((n) => !n.highlightId);
    if (standaloneNotes.length > 0) {
      lines.push("## Standalone Notes", "");
      for (const note of standaloneNotes) {
        lines.push(`### ${note.title}`, "");
        lines.push(note.content, "");
        if (note.tags.length > 0) {
          lines.push(`Tags: ${note.tags.map((t) => `#${t}`).join(" ")}`, "");
        }
      }
    }

    return lines.join("\n");
  }

  private toNotion(highlights: Highlight[], notes: Note[], book: Book): string {
    const lines: string[] = [
      `# ${book.meta.title}`,
      "",
      `> **Author:** ${book.meta.author}`,
      `> **Highlights:** ${highlights.length}`,
      "",
    ];

    for (const h of highlights) {
      lines.push(`**${h.chapterTitle || "Unknown Chapter"}**`);
      lines.push(`> ${h.text}`, "");
      if (h.note) {
        lines.push(`*${h.note}*`, "");
      }
      lines.push("---", "");
    }

    const standaloneNotes = notes.filter((n) => !n.highlightId);
    if (standaloneNotes.length > 0) {
      lines.push("# Notes", "");
      for (const note of standaloneNotes) {
        lines.push(`## ${note.title}`, "", note.content, "", "---", "");
      }
    }

    return lines.join("\n");
  }

  // --- Helpers ---

  private groupByChapter(highlights: Highlight[]): Map<string, Highlight[]> {
    const grouped = new Map<string, Highlight[]>();
    for (const h of highlights) {
      const chapter = h.chapterTitle || "Unknown Chapter";
      if (!grouped.has(chapter)) {
        grouped.set(chapter, []);
      }
      grouped.get(chapter)!.push(h);
    }
    return grouped;
  }

  /** Export multiple books into a single merged output */
  exportMultipleBooks(
    booksData: Array<{ book: Book; highlights: Highlight[]; notes: Note[] }>,
    options: Partial<ExportOptions> = {},
  ): string {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const nonEmpty = booksData.filter(
      (d) => d.highlights.length > 0 || d.notes.length > 0,
    );

    if (opts.format === "json") {
      return JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          totalBooks: nonEmpty.length,
          books: nonEmpty.map((d) => ({
            book: {
              id: d.book.id,
              title: d.book.meta.title,
              author: d.book.meta.author,
              language: d.book.meta.language,
            },
            highlights: d.highlights.map((h) => ({
              id: h.id,
              text: h.text,
              color: h.color,
              note: h.note,
              chapter: h.chapterTitle,
              createdAt: new Date(h.createdAt).toISOString(),
            })),
            notes: d.notes.map((n) => ({
              id: n.id,
              title: n.title,
              content: n.content,
              chapter: n.chapterTitle,
              createdAt: new Date(n.createdAt).toISOString(),
            })),
          })),
        },
        null,
        2,
      );
    }

    return nonEmpty
      .map((d) => this.export(d.highlights, d.notes, d.book, options))
      .join("\n\n---\n\n");
  }
}

/** Singleton exporter instance */
export const annotationExporter = new AnnotationExporter();
