import { describe, expect, it } from "vitest";
import * as importedBookMeta from "./imported-book-meta";

const { buildImportedBookMeta, fromDocumentMetadata } = importedBookMeta;

describe("desktop imported book metadata", () => {
  it("preserves restored fields while filling blanks from rich extracted metadata", () => {
    const reviews = [{ id: "review-1", content: "Keep this", createdAt: 1, updatedAt: 2 }];

    expect(
      buildImportedBookMeta({
        existing: {
          title: "Edited title",
          author: "",
          publisher: "Saved press",
          rating: 4,
          reviews,
          totalPages: 320,
        },
        opds: { author: "Catalog author", language: "fr" },
        embedded: {
          title: "Embedded title",
          author: "Embedded author",
          publisher: "Embedded press",
          isbn: "978 1 4028 9462 6",
          subjects: ["History"],
          coverUrl: "covers/1.jpg",
        },
        fallbackTitle: "filename",
      }),
    ).toMatchObject({
      title: "Edited title",
      author: "Catalog author",
      publisher: "Saved press",
      language: "fr",
      isbn: "9781402894626",
      subjects: ["History"],
      coverUrl: "covers/1.jpg",
      rating: 4,
      reviews,
      totalPages: 320,
    });
  });

  it("normalizes Foliate object metadata without turning subjects into tags", () => {
    expect(
      fromDocumentMetadata({
        title: { en: "Object title" },
        author: { name: "Object author" },
        publisher: "Press",
        language: "en-US",
        isbn: "978 1 4028 9462 6",
        published: "2020-4-3",
        description: "Summary",
        subject: [{ name: "History" }, "Science"],
      }),
    ).toEqual({
      title: "Object title",
      author: "Object author",
      publisher: "Press",
      language: "en-US",
      isbn: "9781402894626",
      publishDate: "2020-4-3",
      description: "Summary",
      subjects: ["History", "Science"],
    });
  });

  it("keeps a single Foliate subject as a subject", () => {
    expect(fromDocumentMetadata({ subject: "Fiction" }).subjects).toEqual(["Fiction"]);
  });

  it("handles the exact MOBI metadata arrays emitted by foliate-js", () => {
    expect(
      fromDocumentMetadata({
        identifier: "123456",
        title: "MOBI title",
        author: ["First author", "Second author"],
        publisher: "MOBI Press",
        language: "en",
        published: "2024-08-06",
        description: "MOBI description",
        subject: ["History", "Science"],
        contributor: ["Editor Name"],
      }),
    ).toEqual({
      title: "MOBI title",
      author: "First author, Second author",
      publisher: "MOBI Press",
      language: "en",
      isbn: undefined,
      publishDate: "2024-08-06",
      description: "MOBI description",
      subjects: ["History", "Science"],
    });
  });

  it("handles the exact contributor, language-map, and identifier shapes emitted by EPUB", () => {
    expect(
      fromDocumentMetadata({
        identifier: "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
        altIdentifier: [
          "urn:uuid:550e8400-e29b-41d4-a716-446655440000",
          "urn:isbn:978-1-4028-9462-6",
        ],
        title: { en: "EPUB title", fr: "Titre EPUB" },
        author: [
          { name: { en: "First author" }, role: ["aut"] },
          { name: "Second author", role: ["aut"] },
        ],
        publisher: [{ name: { en: "EPUB Press" }, role: ["pbl"] }],
        language: ["en-US", "fr"],
        published: "2024-08-06",
        description: "EPUB description",
        subject: [{ name: { en: "History" } }, { name: "Science" }],
      }),
    ).toEqual({
      title: "EPUB title",
      author: "First author, Second author",
      publisher: "EPUB Press",
      language: "en-US",
      isbn: "9781402894626",
      publishDate: "2024-08-06",
      description: "EPUB description",
      subjects: ["History", "Science"],
    });
  });

  it("never treats Foliate UIDs or UUIDs as ISBNs", () => {
    expect(fromDocumentMetadata({ identifier: "123456" }).isbn).toBeUndefined();
    expect(fromDocumentMetadata({ identifier: "9781402894626" }).isbn).toBeUndefined();
    expect(
      fromDocumentMetadata({ identifier: "urn:uuid:550e8400-e29b-41d4-a716-446655440000" }).isbn,
    ).toBeUndefined();
    expect(fromDocumentMetadata({ identifier: "urn:isbn:978-1-4028-9462-6" }).isbn).toBe(
      "9781402894626",
    );
  });

  it("preserves rich PDF info and XMP metadata even when no cover is available", () => {
    const fromPdfMetadata = (
      importedBookMeta as typeof importedBookMeta & {
        fromPdfMetadata?: (
          info: Record<string, unknown> | undefined,
          metadata: { get(name: string): unknown } | undefined,
        ) => Record<string, unknown>;
      }
    ).fromPdfMetadata;
    expect(fromPdfMetadata).toBeTypeOf("function");
    if (!fromPdfMetadata) return;

    const xmp = new Map<string, unknown>([
      ["dc:title", "XMP title"],
      ["dc:creator", ["XMP author", "Second author"]],
      ["dc:description", "XMP description"],
      ["dc:language", ["en-US"]],
      ["dc:publisher", [{ name: "XMP Press" }]],
      ["dc:identifier", "urn:isbn:978-1-4028-9462-6"],
      ["prism:publicationdate", ["2024-08-06"]],
      ["dc:subject", ["History", "Science"]],
    ]);
    const embedded = fromPdfMetadata(
      {
        Title: "Info title",
        Author: "Info author",
        Subject: "Info description",
        Keywords: "Fallback, Keywords",
        CreationDate: "D:20230805000000Z",
      },
      { get: (name) => xmp.get(name) },
    );

    expect(buildImportedBookMeta({ embedded, fallbackTitle: "filename" })).toMatchObject({
      title: "XMP title",
      author: "XMP author, Second author",
      publisher: "XMP Press",
      language: "en",
      isbn: "9781402894626",
      publishDate: "2024-08-06",
      description: "XMP description",
      subjects: ["History", "Science"],
    });
  });

  it("does not fabricate a publication date from generic PDF timestamps", () => {
    const xmp = new Map<string, unknown>([["dc:date", "2024-08-06"]]);

    expect(
      importedBookMeta.fromPdfMetadata(
        {
          CreationDate: "D:20230805000000Z",
          ModDate: "D:20250102000000Z",
        },
        { get: (name) => xmp.get(name) },
      ).publishDate,
    ).toBeUndefined();
  });

  it("reads explicitly publication-scoped PDF metadata exposed by pdfjs", () => {
    expect(
      importedBookMeta.fromPdfMetadata(undefined, {
        get: (name) => (name === "dcterms:issued" ? "2020-05" : undefined),
      }).publishDate,
    ).toBe("2020-05");

    expect(
      importedBookMeta.fromPdfMetadata({ Custom: { PublicationDate: "2019" } }, undefined)
        .publishDate,
    ).toBe("2019");
  });

  it("restores saved publication values byte-for-byte while catalog metadata fills blanks", () => {
    expect(
      buildImportedBookMeta({
        existing: {
          title: "  Saved Desktop Title  ",
          author: "",
          publisher: " Saved Desktop Press ",
          language: "en-US",
          isbn: " ISBN 978-1-4028-9462-6 ",
          publishDate: " 2020-4-3 ",
          description: "  Saved desktop description  ",
          subjects: [" History ", "History"],
        },
        opds: { author: " Catalog author ", language: "fr-FR" },
        embedded: { author: "Embedded author" },
        fallbackTitle: "filename",
      }),
    ).toMatchObject({
      title: "  Saved Desktop Title  ",
      author: "Catalog author",
      publisher: " Saved Desktop Press ",
      language: "en-US",
      isbn: " ISBN 978-1-4028-9462-6 ",
      publishDate: " 2020-4-3 ",
      description: "  Saved desktop description  ",
      subjects: [" History ", "History"],
    });
  });

  it("carries a desktop import context into the ordered metadata merge", () => {
    const buildDesktopImportedBookMeta = (
      importedBookMeta as typeof importedBookMeta & {
        buildDesktopImportedBookMeta?: (input: {
          file: string | { path: string; metadata?: Record<string, unknown> };
          existing?: Record<string, unknown>;
          embedded?: Record<string, unknown>;
          fallbackTitle: string;
        }) => Record<string, unknown>;
      }
    ).buildDesktopImportedBookMeta;

    expect(buildDesktopImportedBookMeta).toBeTypeOf("function");
    if (!buildDesktopImportedBookMeta) return;

    expect(
      buildDesktopImportedBookMeta({
        file: {
          path: "C:/imports/catalog.epub",
          metadata: { title: "Catalog title", author: "Catalog author" },
        },
        embedded: { title: "Embedded title", author: "Embedded author", language: "fr" },
        fallbackTitle: "filename",
      }),
    ).toMatchObject({ title: "Catalog title", author: "Catalog author", language: "fr" });

    expect(
      buildDesktopImportedBookMeta({
        file: "C:/imports/legacy.epub",
        embedded: { title: "Embedded title" },
        fallbackTitle: "filename",
      }),
    ).toMatchObject({ title: "Embedded title" });
  });

  it("skips embedded cover persistence when saved or import metadata owns the cover", () => {
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
