/**
 * Library Tools — listBooks, searchAllHighlights, searchAllNotes, readingStats, classifyBooks, tagBooks, manageBookTags
 */
import {
  getAllHighlights,
  getAllNotes,
  getBook,
  getBooks,
  getChunks,
  getReadingSessionsByDateRange,
  updateBook,
} from "../../db/database";
import { emitLibraryChanged } from "../../events/library-events";
import { debouncedSave, loadFromFS } from "../../stores/persist";
import type { ToolDefinition } from "./tool-types";

/** List all books in the user's library */
export function createListBooksTool(): ToolDefinition {
  return {
    name: "listBooks",
    description:
      "List all books in the user's library, including titles, authors, reading progress, and basic metadata. Use this when the user asks about their books, reading list, or library.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are calling this tool",
        required: true,
      },
      search: {
        type: "string",
        description: "Search keyword to filter by title or author",
      },
      status: {
        type: "string",
        description:
          "Filter by reading status: 'unread' (0%), 'reading' (1-99%), or 'completed' (100%)",
      },
      limit: {
        type: "number",
        description: "Maximum number of books to return (default: 20)",
      },
    },
    execute: async (args) => {
      const limit = (args.limit as number) || 20;
      const searchTerm = (args.search as string)?.toLowerCase();
      const status = args.status as string | undefined;
      let books = await getBooks();

      // Filter by search keyword
      if (searchTerm) {
        books = books.filter(
          (b) =>
            b.meta.title?.toLowerCase().includes(searchTerm) ||
            b.meta.author?.toLowerCase().includes(searchTerm),
        );
      }

      // Filter by reading status
      if (status === "unread") {
        books = books.filter((b) => !b.progress || b.progress === 0);
      } else if (status === "reading") {
        books = books.filter((b) => b.progress > 0 && b.progress < 1);
      } else if (status === "completed") {
        books = books.filter((b) => b.progress >= 1);
      }

      const result = books.slice(0, limit).map((b) => ({
        id: b.id,
        title: b.meta.title,
        author: b.meta.author,
        format: b.format,
        progress: Math.round((b.progress || 0) * 100) + "%",
        isVectorized: b.isVectorized,
        addedAt: b.addedAt,
        lastOpenedAt: b.lastOpenedAt,
      }));
      return { total: books.length, showing: result.length, books: result };
    },
  };
}

/** Search highlights across all books */
export function createSearchAllHighlightsTool(): ToolDefinition {
  return {
    name: "searchAllHighlights",
    description:
      "Get the user's recent highlights and annotations across ALL books. Use this when the user asks about their highlights, marked passages, or important notes without specifying a particular book.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are calling this tool",
        required: true,
      },
      days: {
        type: "number",
        description:
          "Only return highlights from the last N days (e.g. 7=last week, 30=last month)",
      },
      limit: {
        type: "number",
        description: "Maximum number of highlights to return (default: 20)",
      },
    },
    execute: async (args) => {
      const limit = (args.limit as number) || 20;
      const days = args.days as number | undefined;
      let highlights = await getAllHighlights(limit * 2); // fetch extra for filtering
      const books = await getBooks();
      const bookMap = new Map(books.map((b) => [b.id, b.meta.title]));

      // Filter by time range
      if (days) {
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        highlights = highlights.filter((h) => h.createdAt >= cutoff);
      }

      highlights = highlights.slice(0, limit);

      return {
        total: highlights.length,
        highlights: highlights.map((h) => ({
          text: h.text,
          note: h.note,
          bookTitle: bookMap.get(h.bookId) || "Unknown",
          chapterTitle: h.chapterTitle,
          color: h.color,
          createdAt: h.createdAt,
        })),
      };
    },
  };
}

/** Search notes across all books */
export function createSearchAllNotesTool(): ToolDefinition {
  return {
    name: "searchAllNotes",
    description:
      "Get the user's notes across ALL books. Use this when the user asks about their notes, thoughts, or writings without specifying a particular book.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are calling this tool",
        required: true,
      },
      days: {
        type: "number",
        description: "Only return notes from the last N days (e.g. 7=last week, 30=last month)",
      },
      bookTitle: {
        type: "string",
        description: "Filter notes by book title (fuzzy match)",
      },
      limit: {
        type: "number",
        description: "Maximum number of notes to return (default: 20)",
      },
    },
    execute: async (args) => {
      const limit = (args.limit as number) || 20;
      const days = args.days as number | undefined;
      const bookTitleSearch = (args.bookTitle as string)?.toLowerCase();

      const notes = await getAllNotes(limit * 2);
      const highlightsWithNotes = await getAllHighlights(limit * 2);
      const highlightNotes = highlightsWithNotes.filter((h) => h.note);

      const books = await getBooks();
      const bookMap = new Map(books.map((b) => [b.id, b.meta.title]));

      let allNotes = [
        ...notes.map((n) => ({
          type: "note" as const,
          title: n.title,
          content: n.content,
          bookId: n.bookId,
          chapterTitle: n.chapterTitle,
          tags: n.tags,
          createdAt: n.createdAt,
        })),
        ...highlightNotes.map((h) => ({
          type: "highlight_note" as const,
          title: h.text.slice(0, 50) + (h.text.length > 50 ? "..." : ""),
          content: h.note || "",
          bookId: h.bookId,
          chapterTitle: h.chapterTitle,
          highlightedText: h.text,
          createdAt: h.createdAt,
        })),
      ];

      if (days) {
        const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
        allNotes = allNotes.filter((n) => n.createdAt >= cutoff);
      }

      if (bookTitleSearch) {
        allNotes = allNotes.filter((n) => {
          const title = bookMap.get(n.bookId)?.toLowerCase() || "";
          return title?.includes(bookTitleSearch);
        });
      }

      allNotes.sort((a, b) => b.createdAt - a.createdAt);
      allNotes = allNotes.slice(0, limit);

      return {
        total: allNotes.length,
        notes: allNotes.map((n) => ({
          type: n.type,
          title: n.title,
          content: n.content,
          bookTitle: bookMap.get(n.bookId) || "Unknown",
          chapterTitle: n.chapterTitle,
          highlightedText: n.type === "highlight_note" ? (n as any).highlightedText : undefined,
          tags: n.type === "note" ? (n as any).tags : undefined,
          createdAt: n.createdAt,
        })),
      };
    },
  };
}

/** Get reading statistics across all books */
export function createReadingStatsTool(): ToolDefinition {
  return {
    name: "getReadingStats",
    description:
      "Get the user's reading statistics, including total books, reading time, and recent activity. Use this when the user asks about their reading habits, statistics, or activity summary.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are calling this tool",
        required: true,
      },
      days: {
        type: "number",
        description: "Number of recent days to include for activity stats (default: 30)",
      },
    },
    execute: async (args) => {
      const days = (args.days as number) || 30;
      const books = await getBooks();
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      const sessions = await getReadingSessionsByDateRange(startDate, endDate);

      const totalReadingTimeMs = sessions.reduce((sum, s) => sum + s.totalActiveTime, 0);
      const totalPagesRead = sessions.reduce((sum, s) => sum + s.pagesRead, 0);
      const booksInProgress = books.filter((b) => b.progress > 0 && b.progress < 1);
      const booksCompleted = books.filter((b) => b.progress >= 1);

      return {
        library: {
          totalBooks: books.length,
          inProgress: booksInProgress.length,
          completed: booksCompleted.length,
        },
        recentActivity: {
          periodDays: days,
          totalSessions: sessions.length,
          totalReadingMinutes: Math.round(totalReadingTimeMs / 60000),
          totalPagesRead,
        },
        recentBooks: books.slice(0, 5).map((b) => ({
          title: b.meta.title,
          author: b.meta.author,
          progress: Math.round((b.progress || 0) * 100),
        })),
      };
    },
  };
}

/** Get books info and existing tags for AI classification */
export function createClassifyBooksTool(): ToolDefinition {
  return {
    name: "classifyBooks",
    description:
      "Get book metadata, table of contents, and content samples for classification. MUST be called BEFORE tagBooks to get book IDs and enough context. Without bookId: returns all uncategorized books with their TOC and content samples. With bookId: returns that specific book's full info. Use when the user asks to classify/categorize/tag books. IMPORTANT: Each book should have at most 2 tags — pick the most representative ones.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are calling this tool",
        required: true,
      },
      bookId: {
        type: "string",
        description:
          "Optional. If provided, return info for this specific book instead of all uncategorized books.",
      },
    },
    execute: async (args) => {
      const books = await getBooks();
      const allTags = [...new Set(books.flatMap((b) => b.tags))];
      const targetBookId = args.bookId as string | undefined;

      /** Extract TOC and content samples from chunks for a given book */
      const getBookContentInfo = async (bookId: string) => {
        try {
          const chunks = await getChunks(bookId);
          if (chunks.length === 0) return { toc: [], contentSample: "" };

          // Extract TOC
          const chapters = new Map<number, string>();
          for (const chunk of chunks) {
            if (!chapters.has(chunk.chapterIndex)) {
              chapters.set(chunk.chapterIndex, chunk.chapterTitle);
            }
          }
          const toc = Array.from(chapters.entries())
            .sort((a, b) => a[0] - b[0])
            .map(([, title]) => title);

          // Sample first few chunks as content preview (up to ~1500 chars)
          let contentSample = "";
          for (const chunk of chunks.slice(0, 5)) {
            contentSample += chunk.content + "\n";
            if (contentSample.length > 1500) break;
          }
          contentSample = contentSample.slice(0, 1500);

          return { toc, contentSample };
        } catch {
          return { toc: [], contentSample: "" };
        }
      };

      if (targetBookId) {
        const book = await getBook(targetBookId);
        if (!book) {
          return { success: false, error: "Book not found" };
        }
        const contentInfo = await getBookContentInfo(book.id);
        return {
          existingTags: allTags,
          book: {
            id: book.id,
            title: book.meta.title,
            author: book.meta.author,
            description: book.meta.description,
            subjects: book.meta.subjects,
            language: book.meta.language,
            currentTags: book.tags,
            toc: contentInfo.toc,
            contentSample: contentInfo.contentSample,
          },
          totalBooks: books.length,
        };
      }

      const uncategorized = books.filter((b) => b.tags.length === 0);
      const uncategorizedWithContent = await Promise.all(
        uncategorized.map(async (b) => {
          const contentInfo = await getBookContentInfo(b.id);
          return {
            id: b.id,
            title: b.meta.title,
            author: b.meta.author,
            description: b.meta.description,
            subjects: b.meta.subjects,
            language: b.meta.language,
            toc: contentInfo.toc,
            contentSample: contentInfo.contentSample,
          };
        }),
      );
      return {
        existingTags: allTags,
        uncategorizedBooks: uncategorizedWithContent,
        totalBooks: books.length,
        uncategorizedCount: uncategorized.length,
      };
    },
  };
}

/** Batch-apply tags to books */
export function createTagBooksTool(): ToolDefinition {
  return {
    name: "tagBooks",
    description:
      "Apply tags to books. Can tag multiple books at once. IMPORTANT: You MUST call classifyBooks first to get book IDs and metadata — never guess tags based on title alone. Use the description, subjects, and language from classifyBooks results to suggest accurate tags. RULE: Each book should have at most 2 tags — pick the 1-2 most representative categories. Prefer reusing existing tags over creating new ones.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are calling this tool",
        required: true,
      },
      assignments: {
        type: "string",
        description:
          'JSON array of {bookId, tags: string[]}. Example: [{"bookId":"abc","tags":["科幻","小说"]}]',
        required: true,
      },
    },
    execute: async (args) => {
      const assignments: { bookId: string; tags: string[] }[] = JSON.parse(
        args.assignments as string,
      );
      const results: {
        bookId: string;
        title?: string;
        tags?: string[];
        success: boolean;
        error?: string;
      }[] = [];
      for (const { bookId, tags } of assignments) {
        const book = await getBook(bookId);
        if (!book) {
          results.push({ bookId, success: false, error: "Book not found" });
          continue;
        }
        const merged = [...new Set([...book.tags, ...tags])];
        await updateBook(bookId, { tags: merged });
        results.push({
          bookId,
          title: book.meta.title,
          tags: merged,
          success: true,
        });
      }
      const result = {
        results,
        taggedCount: results.filter((r) => r.success).length,
      };
      emitLibraryChanged();
      return result;
    },
  };
}

/** Manage book tags: create, rename, delete, remove from book, set book tags */
export function createManageBookTagsTool(): ToolDefinition {
  return {
    name: "manageBookTags",
    description:
      "Manage book tags: create new tags (without assigning to books), rename a tag across all books, delete one or more tags from all books, remove specific tags from a book, or replace all tags of a book. Use when the user asks to create, modify, rename, or delete tags. For delete action, you can delete multiple tags at once by passing a JSON array.",
    parameters: {
      reasoning: {
        type: "string",
        description: "Brief explanation of why you are calling this tool",
        required: true,
      },
      action: {
        type: "string",
        description: '"create" | "rename" | "delete" | "removeFromBook" | "setBookTags"',
        required: true,
      },
      tag: {
        type: "string",
        description:
          "The tag to rename (for rename action). For delete action, use 'tags' parameter instead to support batch deletion.",
      },
      newTag: {
        type: "string",
        description: "New tag name (for rename action)",
      },
      bookId: {
        type: "string",
        description: "Book ID (for removeFromBook/setBookTags)",
      },
      tags: {
        type: "string",
        description:
          'JSON array of tags. For create action: tags to create. For delete action: tags to delete. For removeFromBook/setBookTags: tags to remove/set. Example: ["科幻","小说"]',
      },
    },
    execute: async (args) => {
      const action = args.action as string;

      if (action === "create") {
        let tagsToCreate: string[] = [];
        if (args.tags) {
          tagsToCreate = JSON.parse(args.tags as string);
        } else if (args.tag) {
          tagsToCreate = [args.tag as string];
        }
        if (tagsToCreate.length === 0) {
          return { success: false, error: "tag or tags is required for create" };
        }
        // Load existing tags
        const existingTags = (await loadFromFS<string[]>("library-tags")) || [];
        const existingSet = new Set(existingTags);
        const newTags: string[] = [];
        for (const tag of tagsToCreate) {
          if (!existingSet.has(tag)) {
            newTags.push(tag);
            existingSet.add(tag);
          }
        }
        if (newTags.length === 0) {
          return {
            success: true,
            action: "create",
            createdTags: [],
            message: "All tags already exist",
          };
        }
        const allTags = [...existingSet].sort();
        debouncedSave("library-tags", allTags);
        emitLibraryChanged();
        return { success: true, action: "create", createdTags: newTags, totalTags: allTags.length };
      }

      if (action === "rename") {
        const oldTag = args.tag as string;
        const newTag = args.newTag as string;
        if (!oldTag || !newTag) {
          return { success: false, error: "Both tag and newTag are required for rename" };
        }
        const books = await getBooks();
        let affectedCount = 0;
        for (const book of books) {
          if (book.tags?.includes(oldTag)) {
            const updated = book.tags.map((t) => (t === oldTag ? newTag : t));
            const deduped = [...new Set(updated)];
            await updateBook(book.id, { tags: deduped });
            affectedCount++;
          }
        }
        emitLibraryChanged();
        return { success: true, action: "rename", oldTag, newTag, affectedBooks: affectedCount };
      }

      if (action === "delete") {
        // Support both single tag (via 'tag' param) and multiple tags (via 'tags' param)
        let tagsToDelete: string[] = [];
        if (args.tags) {
          tagsToDelete = JSON.parse(args.tags as string);
        } else if (args.tag) {
          tagsToDelete = [args.tag as string];
        }
        if (tagsToDelete.length === 0) {
          return { success: false, error: "tag or tags is required for delete" };
        }
        const books = await getBooks();
        let affectedCount = 0;
        for (const book of books) {
          const hasAnyTag = tagsToDelete.some((tag) => book.tags?.includes(tag));
          if (hasAnyTag) {
            const updated = book.tags?.filter((t) => !tagsToDelete.includes(t)) || [];
            await updateBook(book.id, { tags: updated });
            affectedCount++;
          }
        }
        emitLibraryChanged(tagsToDelete);
        return {
          success: true,
          action: "delete",
          deletedTags: tagsToDelete,
          affectedBooks: affectedCount,
        };
      }

      if (action === "removeFromBook") {
        const bookId = args.bookId as string;
        const tagsToRemove: string[] = JSON.parse(args.tags as string);
        if (!bookId || !tagsToRemove) {
          return { success: false, error: "bookId and tags are required for removeFromBook" };
        }
        const book = await getBook(bookId);
        if (!book) {
          return { success: false, error: "Book not found" };
        }
        const updated = book.tags?.filter((t) => !tagsToRemove.includes(t)) || [];
        await updateBook(bookId, { tags: updated });
        emitLibraryChanged();
        return {
          success: true,
          action: "removeFromBook",
          bookId,
          title: book.meta.title,
          removedTags: tagsToRemove,
          remainingTags: updated,
        };
      }

      if (action === "setBookTags") {
        const bookId = args.bookId as string;
        const newTags: string[] = JSON.parse(args.tags as string);
        if (!bookId || !newTags) {
          return { success: false, error: "bookId and tags are required for setBookTags" };
        }
        const book = await getBook(bookId);
        if (!book) {
          return { success: false, error: "Book not found" };
        }
        const deduped = [...new Set(newTags)];
        await updateBook(bookId, { tags: deduped });
        emitLibraryChanged();
        return {
          success: true,
          action: "setBookTags",
          bookId,
          title: book.meta.title,
          tags: deduped,
        };
      }

      return { success: false, error: `Unknown action: ${action}` };
    },
  };
}
