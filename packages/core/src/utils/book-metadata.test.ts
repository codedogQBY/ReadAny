import { describe, expect, it } from "vitest";
import type { Book } from "../types";
import {
  applyBookMetadataFormUpdate,
  buildBookMetadataUpdate,
  hasMissingBookMetadataAutoFillTargets,
  mergeBookMetadataSources,
  mergeMissingBookMetadataValues,
} from "./book-metadata";

describe("mergeBookMetadataSources", () => {
  it("fills in priority order and normalizes extracted values", () => {
    expect(
      mergeBookMetadataSources(
        { title: "My title", author: "", language: "" },
        {
          title: "Catalog title",
          author: "Catalog author",
          language: "zh_hans",
          subjects: [" Fiction ", "Fiction"],
        },
        { author: "Embedded author", publisher: " Embedded Press " },
        { title: "filename" },
      ),
    ).toEqual({
      title: "My title",
      author: "Catalog author",
      language: "zh-CN",
      subjects: ["Fiction"],
      publisher: "Embedded Press",
    });
  });

  it("ignores empty and invalid candidates", () => {
    expect(
      mergeBookMetadataSources({ title: "" }, { title: "Book", publishDate: "not-a-date" }),
    ).toEqual({ title: "Book" });
  });

  it("preserves every populated saved value verbatim while filling saved blanks", () => {
    const reviews = [{ id: "review-1", content: "Keep exactly", createdAt: 1, updatedAt: 2 }];

    expect(
      mergeBookMetadataSources(
        {
          title: "  Saved Title  ",
          author: "",
          publisher: " Saved Press ",
          language: "en-US",
          isbn: " ISBN 978-1-4028-9462-6 ",
          publishDate: " 2020-4-3 ",
          description: "  Saved description  ",
          coverUrl: " covers/saved.webp ",
          subjects: [" History ", "History"],
          rating: 4,
          reviews,
          totalPages: 321,
          totalChapters: 17,
        },
        {
          title: "Catalog title",
          author: " Catalog author ",
          publisher: "Catalog Press",
          language: "fr-FR",
          isbn: "9781402894626",
          publishDate: "2024-8-6",
          description: "Catalog description",
          coverUrl: "covers/catalog.jpg",
          subjects: ["Catalog"],
        },
      ),
    ).toEqual({
      title: "  Saved Title  ",
      author: "Catalog author",
      publisher: " Saved Press ",
      language: "en-US",
      isbn: " ISBN 978-1-4028-9462-6 ",
      publishDate: " 2020-4-3 ",
      description: "  Saved description  ",
      coverUrl: " covers/saved.webp ",
      subjects: [" History ", "History"],
      rating: 4,
      reviews,
      totalPages: 321,
      totalChapters: 17,
    });
  });

  it("accepts valid ISBNs but rejects generic UIDs and UUIDs from imported sources", () => {
    expect(mergeBookMetadataSources(undefined, { isbn: "123456" })).toEqual({});
    expect(mergeBookMetadataSources(undefined, { isbn: "97814028946260" })).toEqual({});
    expect(
      mergeBookMetadataSources(undefined, {
        isbn: "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
      }),
    ).toEqual({});
    expect(mergeBookMetadataSources(undefined, { isbn: "urn:isbn:978-1-4028-9462-6" })).toEqual({
      isbn: "9781402894626",
    });
  });

  it("accepts only complete publication date formats and valid calendar dates", () => {
    expect(mergeBookMetadataSources(undefined, { publishDate: "2024" })).toEqual({
      publishDate: "2024",
    });
    expect(mergeBookMetadataSources(undefined, { publishDate: "2024-02" })).toEqual({
      publishDate: "2024-02",
    });
    expect(mergeBookMetadataSources(undefined, { publishDate: "2024-02-29" })).toEqual({
      publishDate: "2024-02-29",
    });
    expect(mergeBookMetadataSources(undefined, { publishDate: "2000-02-29" })).toEqual({
      publishDate: "2000-02-29",
    });
    expect(mergeBookMetadataSources(undefined, { publishDate: "2020-4-3" })).toEqual({
      publishDate: "2020-04-03",
    });
    expect(mergeBookMetadataSources(undefined, { publishDate: "2020/4/3" })).toEqual({
      publishDate: "2020-04-03",
    });
    expect(mergeBookMetadataSources(undefined, { publishDate: "2020.4" })).toEqual({
      publishDate: "2020-04",
    });
  });

  it("rejects impossible, incomplete, and trailing-junk publication dates", () => {
    for (const publishDate of [
      "2024-00",
      "2024-13",
      "2023-02-29",
      "1900-02-29",
      "2024-02-30",
      "2024-04-31",
      "2024/02-29",
      "2024-02-29T12:00:00Z",
      "2024-02-29junk",
      "2024/02/29junk",
    ]) {
      expect(mergeBookMetadataSources(undefined, { publishDate })).toEqual({});
    }
  });

  it("falls through an invalid higher-priority publication date", () => {
    expect(
      mergeBookMetadataSources(
        undefined,
        { publishDate: "2023-02-29" },
        { publishDate: "2024-02-29" },
      ),
    ).toEqual({ publishDate: "2024-02-29" });
  });
});

it("does not copy subjects into user tags during details repair", () => {
  const values = {
    title: "",
    author: "",
    coverUrl: "",
    publisher: "",
    language: "",
    isbn: "",
    publishDate: "",
    rating: null,
    description: "",
    reviews: [],
    subjectsText: "",
    tagsText: "",
    groupId: "",
  };
  const next = mergeMissingBookMetadataValues(values, { subjects: ["History"] });
  expect(next?.subjectsText).toBe("History");
  expect(next?.tagsText).toBe("");
});

it("does not request autofill when publication metadata is complete and tags are empty", () => {
  expect(
    hasMissingBookMetadataAutoFillTargets({
      title: "Book",
      author: "Author",
      coverUrl: "covers/book.jpg",
      publisher: "Publisher",
      language: "en",
      isbn: "9781234567890",
      publishDate: "2024",
      rating: null,
      description: "Description",
      reviews: [],
      subjectsText: "History",
      tagsText: "",
      groupId: "",
    }),
  ).toBe(false);
});

it("requests autofill for a missing cover and never replaces an existing cover", () => {
  const values = {
    title: "Book",
    author: "Author",
    coverUrl: "",
    publisher: "Publisher",
    language: "en",
    isbn: "9781234567890",
    publishDate: "2024",
    rating: null,
    description: "Description",
    reviews: [],
    subjectsText: "History",
    tagsText: "",
    groupId: "",
  };

  expect(hasMissingBookMetadataAutoFillTargets(values)).toBe(true);
  expect(
    mergeMissingBookMetadataValues(values, { coverUrl: "covers/extracted.jpg" })?.coverUrl,
  ).toBe("covers/extracted.jpg");
  expect(
    mergeMissingBookMetadataValues(
      { ...values, coverUrl: "covers/user.jpg" },
      { coverUrl: "covers/extracted.jpg" },
    ),
  ).toBeNull();
});

it("atomically exposes a just-entered edit to an in-flight metadata merge", () => {
  const book = {
    id: "book-1",
    format: "epub",
    filePath: "books/book-1.epub",
    meta: { title: "Book", author: "Author" },
    progress: 0,
    addedAt: 1,
  } as Book;
  const ref = {
    current: {
      title: "Book",
      author: "Author",
      coverUrl: "covers/book.jpg",
      publisher: "",
      language: "",
      isbn: "",
      publishDate: "",
      rating: null,
      description: "",
      reviews: [],
      subjectsText: "",
      tagsText: "",
      groupId: "",
    },
  };
  let rendered = ref.current;

  applyBookMetadataFormUpdate(
    ref,
    (next) => {
      rendered = next;
    },
    (current) => ({ ...current, publisher: "User press" }),
  );
  const repaired = mergeMissingBookMetadataValues(ref.current, {
    publisher: "Extracted press",
    language: "fr",
  });
  const finalValues = repaired ?? ref.current;
  const persisted = buildBookMetadataUpdate(book, finalValues);

  expect(rendered.publisher).toBe("User press");
  expect(persisted.meta.publisher).toBe("User press");
  expect(persisted.meta.language).toBe("fr");
});
