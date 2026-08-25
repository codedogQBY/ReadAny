import { describe, expect, it } from "vitest";
import * as importedBookMeta from "./imported-book-meta";

const { buildImportedBookMeta } = importedBookMeta;

describe("buildImportedBookMeta", () => {
  it("persists rich extracted metadata", () => {
    expect(
      buildImportedBookMeta({
        existing: undefined,
        opds: undefined,
        embedded: {
          title: "Book",
          author: "Author",
          publisher: "Press",
          language: "en-US",
          isbn: "978 1 4028 9462 6",
          publishDate: "2020-4-3",
          description: "Summary",
          subjects: ["History"],
          coverUrl: "covers/1.jpg",
        },
        fallbackTitle: "file",
      }),
    ).toMatchObject({
      title: "Book",
      author: "Author",
      publisher: "Press",
      language: "en",
      isbn: "9781402894626",
      publishDate: "2020-04-03",
      description: "Summary",
      subjects: ["History"],
      coverUrl: "covers/1.jpg",
    });
  });

  it("preserves restored values and lets OPDS fill blanks before embedded metadata", () => {
    expect(
      buildImportedBookMeta({
        existing: { title: "Edited", author: "", publisher: "Saved" },
        opds: { title: "Catalog", author: "Catalog Author", publisher: "Catalog Press" },
        embedded: { author: "Embedded Author", language: "fr" },
        fallbackTitle: "file",
      }),
    ).toMatchObject({
      title: "Edited",
      author: "Catalog Author",
      publisher: "Saved",
      language: "fr",
    });
  });

  it("retains saved rating, reviews, and counts when filling import metadata", () => {
    const reviews = [
      {
        id: "review-1",
        content: "Keep this review",
        createdAt: 1,
        updatedAt: 2,
      },
    ];

    expect(
      buildImportedBookMeta({
        existing: {
          title: "",
          author: "",
          rating: 4,
          reviews,
          totalPages: 320,
          totalChapters: 12,
        },
        opds: { rating: undefined, reviews: undefined, totalPages: undefined },
        embedded: { title: "Imported", author: "Author" },
        fallbackTitle: "file",
      }),
    ).toMatchObject({
      title: "Imported",
      author: "Author",
      rating: 4,
      reviews,
      totalPages: 320,
      totalChapters: 12,
    });
  });

  it("restores saved publication values byte-for-byte while catalog metadata fills blanks", () => {
    expect(
      buildImportedBookMeta({
        existing: {
          title: "  Saved Mobile Title  ",
          author: "",
          publisher: " Saved Mobile Press ",
          language: "en-US",
          isbn: " ISBN 978-1-4028-9462-6 ",
          publishDate: " 2020-4-3 ",
          description: "  Saved mobile description  ",
          subjects: [" History ", "History"],
        },
        opds: { author: " Catalog author ", language: "fr-FR" },
        embedded: { author: "Embedded author" },
        fallbackTitle: "filename",
      }),
    ).toMatchObject({
      title: "  Saved Mobile Title  ",
      author: "Catalog author",
      publisher: " Saved Mobile Press ",
      language: "en-US",
      isbn: " ISBN 978-1-4028-9462-6 ",
      publishDate: " 2020-4-3 ",
      description: "  Saved mobile description  ",
      subjects: [" History ", "History"],
    });
  });

  it("skips embedded cover persistence when saved or OPDS metadata owns the cover", () => {
    const shouldPersistEmbeddedCover = (
      importedBookMeta as typeof importedBookMeta & {
        shouldPersistEmbeddedCover?: (
          existing?: { coverUrl?: string },
          imported?: { coverUrl?: string },
        ) => boolean;
      }
    ).shouldPersistEmbeddedCover;
    expect(shouldPersistEmbeddedCover).toBeTypeOf("function");
    if (!shouldPersistEmbeddedCover) return;

    expect(shouldPersistEmbeddedCover({ coverUrl: "covers/saved.jpg" }, undefined)).toBe(false);
    expect(shouldPersistEmbeddedCover(undefined, { coverUrl: "https://catalog/cover.jpg" })).toBe(
      false,
    );
    expect(shouldPersistEmbeddedCover({ coverUrl: "  " }, { coverUrl: "" })).toBe(true);
  });
});
