import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { listSupportedAcquisitions } from "./opds-acquisition";
import { parseOpdsDocument } from "./opds-parser";

const ATOM = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom"
      xmlns:opds="http://opds-spec.org/2010/catalog"
      xmlns:dc="http://purl.org/dc/terms/">
  <title>Catalog</title>
  <subtitle>Books for everyone</subtitle>
  <link rel="next" href="page-2.xml" type="application/atom+xml;profile=opds-catalog" />
  <link rel="previous" href="../page-0.xml" type="application/atom+xml;profile=opds-catalog" />
  <link rel="search" href="search.xml" type="application/opensearchdescription+xml" title="Search books" />
  <link rel="http://opds-spec.org/facet" href="facets/fiction.xml" title="Fiction"
        type="application/atom+xml;profile=opds-catalog" opds:facetGroup="Genre" />
  <entry>
    <id>urn:isbn:9780000000001</id>
    <title>Book</title>
    <author><name>Author</name></author>
    <dc:publisher>Press</dc:publisher>
    <dc:language>en</dc:language>
    <dc:identifier>9780000000001</dc:identifier>
    <dc:issued>2026-08-16</dc:issued>
    <category label="Fiction" term="fiction" />
    <content type="html">&lt;p onclick="steal()"&gt;A &lt;em&gt;safe&lt;/em&gt; description.&lt;/p&gt;&lt;script&gt;steal()&lt;/script&gt;</content>
    <link rel="http://opds-spec.org/image" href="covers/book.jpg" type="image/jpeg" />
    <link rel="http://opds-spec.org/acquisition" href="files/book.epub" type="application/epub+zip" />
    <link rel="http://opds-spec.org/acquisition" href="files/book.weird" type="application/x-made-up" />
  </entry>
</feed>`;

const OPDS2 = JSON.stringify({
  metadata: {
    title: { fr: "Catalogue OPDS 2", en: "OPDS 2 Catalog" },
    subtitle: { fr: "Nouveaux livres", en: "New books" },
  },
  links: [
    { rel: "self", href: "feed.json", type: "application/opds+json" },
    { rel: "next", href: "pages/2.json", type: "application/opds+json" },
    { rel: ["previous"], href: "../previous.json", type: "application/opds+json" },
    {
      rel: "search",
      href: "search{?query}",
      type: "application/opds+json",
      title: "Search catalog",
      templated: true,
    },
  ],
  navigation: [{ title: "Popular", href: "popular.json", type: "application/opds+json" }],
  publications: [
    {
      metadata: {
        identifier: "urn:isbn:9780000000002",
        title: { ja: "第二の本", en: "Second Book" },
        author: [{ name: { fr: "Premier auteur", en: "First Author" } }, "Second Author"],
        publisher: [{ name: { fr: "Autre presse", en: "Other Press" } }, "Fallback Press"],
        language: "fr",
        published: "2025-01-02",
        description:
          '<p>Read <strong>this</strong>. <a href="chapters/1">Chapter</a> <a href="/about">About</a> <a href="#details">Details</a> <a href="javascript:steal()">Bad</a><iframe src="https://evil.test"></iframe></p>',
        subject: [{ name: "Mystery" }, "Adventure"],
      },
      images: [{ rel: "cover", href: "images/cover.png", type: "image/png" }],
      links: [
        {
          rel: ["http://opds-spec.org/acquisition", "alternate"],
          href: "downloads/book.pdf",
          type: "application/pdf",
        },
      ],
    },
  ],
  groups: [
    {
      metadata: { title: { ja: "特集", fr: "En vedette" } },
      navigation: [{ title: "Editors' picks", href: "groups/editors.json" }],
    },
  ],
  facets: [
    {
      metadata: { title: { zh: "语言", fr: "Langue" } },
      links: [{ rel: "self", href: "facets/fr.json", title: "French" }],
    },
  ],
});

describe("parseOpdsDocument", () => {
  it.each([
    ["OPDS 2 acquisition", "json", "acquisition", "direct", true],
    ["OPDS 2 download", "json", "download", "direct", true],
    ["OPDS 2 borrow", "json", "borrow", "borrow", false],
    ["OPDS 2 buy", "json", "buy", "buy", false],
    ["OPDS 2 preview", "json", "preview", "preview", false],
    ["OPDS 2 subscribe", "json", "subscribe", "subscribe", false],
    ["OPDS 1 acquisition", "xml", "http://opds-spec.org/acquisition", "direct", true],
    ["OPDS 1 open access", "xml", "http://opds-spec.org/acquisition/open-access", "direct", true],
    ["OPDS 1 borrow", "xml", "http://opds-spec.org/acquisition/borrow", "borrow", false],
    ["OPDS 1 buy", "xml", "http://opds-spec.org/acquisition/buy", "buy", false],
    ["OPDS 1 sample", "xml", "http://opds-spec.org/acquisition/sample", "sample", false],
    ["OPDS 1 subscribe", "xml", "http://opds-spec.org/acquisition/subscribe", "subscribe", false],
  ] as const)(
    "preserves %s relation semantics through acquisition selection",
    (_name, version, rel, kind, downloadable) => {
      const body =
        version === "json"
          ? JSON.stringify({
              metadata: { title: "Catalog" },
              links: [{ rel: "self", href: "feed.json", type: "application/opds+json" }],
              publications: [
                {
                  metadata: { title: "Book" },
                  links: [{ rel, href: "book.epub", type: "application/epub+zip" }],
                },
              ],
            })
          : `<feed xmlns="http://www.w3.org/2005/Atom"><title>Catalog</title><entry><title>Book</title><link rel="${rel}" href="book.epub" type="application/epub+zip" /></entry></feed>`;
      const feed = parseOpdsDocument(
        body,
        version === "json" ? "application/opds+json" : "application/atom+xml;profile=opds-catalog",
        `https://catalog.test/feed.${version}`,
      );

      expect(feed.publications[0]?.acquisitions[0]).toMatchObject({
        relation: { kind, downloadable },
      });
      expect(listSupportedAcquisitions(feed.publications[0] ?? ({} as never))).toHaveLength(
        downloadable ? 1 : 0,
      );
    },
  );

  it("normalizes an OPDS 1 Atom acquisition feed", () => {
    const feed = parseOpdsDocument(
      ATOM,
      "application/atom+xml;profile=opds-catalog",
      "https://catalog.test/root/feed.xml",
    );

    expect(feed).toMatchObject({
      title: "Catalog",
      subtitle: "Books for everyone",
      nextUrl: "https://catalog.test/root/page-2.xml",
      previousUrl: "https://catalog.test/page-0.xml",
      search: {
        kind: "openSearch",
        descriptorUrl: "https://catalog.test/root/search.xml",
        title: "Search books",
      },
    });
    expect(feed.facets).toEqual([
      {
        title: "Genre",
        links: [
          {
            rel: ["http://opds-spec.org/facet"],
            url: "https://catalog.test/root/facets/fiction.xml",
            title: "Fiction",
            type: "application/atom+xml;profile=opds-catalog",
          },
        ],
      },
    ]);
    expect(feed.publications[0]).toMatchObject({
      id: "urn:isbn:9780000000001",
      title: "Book",
      authors: ["Author"],
      publisher: "Press",
      language: "en",
      identifier: "9780000000001",
      published: "2026-08-16",
      subjects: ["Fiction"],
      description: "<p>A <em>safe</em> description.</p>",
      images: [{ url: "https://catalog.test/root/covers/book.jpg" }],
    });
    expect(feed.publications[0]?.acquisitions).toEqual([
      expect.objectContaining({
        url: "https://catalog.test/root/files/book.epub",
        format: "epub",
      }),
      expect.objectContaining({
        url: "https://catalog.test/root/files/book.weird",
        format: null,
      }),
    ]);
  });

  it("validates and normalizes an OPDS 2 feed including nested collections", () => {
    const feed = parseOpdsDocument(
      OPDS2,
      "application/opds+json; charset=utf-8",
      "https://catalog.test/root/feed.json",
    );

    expect(feed).toMatchObject({
      title: "OPDS 2 Catalog",
      subtitle: "New books",
      navigation: [{ title: "Popular", url: "https://catalog.test/root/popular.json" }],
      nextUrl: "https://catalog.test/root/pages/2.json",
      previousUrl: "https://catalog.test/previous.json",
      search: {
        kind: "template",
        urlTemplate: "https://catalog.test/root/search{?query}",
        title: "Search catalog",
      },
    });
    expect(feed.publications[0]).toMatchObject({
      id: "urn:isbn:9780000000002",
      title: "Second Book",
      authors: ["First Author", "Second Author"],
      publisher: "Other Press",
      language: "fr",
      identifier: "urn:isbn:9780000000002",
      published: "2025-01-02",
      subjects: ["Mystery", "Adventure"],
      description:
        '<p>Read <strong>this</strong>. <a href="https://catalog.test/root/chapters/1" target="_blank" rel="noopener noreferrer">Chapter</a> <a href="https://catalog.test/about" target="_blank" rel="noopener noreferrer">About</a> <a href="https://catalog.test/root/feed.json#details" target="_blank" rel="noopener noreferrer">Details</a> <a>Bad</a></p>',
      images: [expect.objectContaining({ url: "https://catalog.test/root/images/cover.png" })],
      acquisitions: [
        expect.objectContaining({
          url: "https://catalog.test/root/downloads/book.pdf",
          format: "pdf",
        }),
      ],
    });
    expect(feed.groups[0]).toMatchObject({
      title: "En vedette",
      navigation: [
        { title: "Editors' picks", url: "https://catalog.test/root/groups/editors.json" },
      ],
    });
    expect(feed.facets[0]).toEqual({
      title: "Langue",
      links: [
        {
          rel: ["self"],
          url: "https://catalog.test/root/facets/fr.json",
          title: "French",
        },
      ],
    });
  });

  it("maps supported acquisition extensions and retains unknown formats", () => {
    const body = JSON.stringify({
      metadata: { title: "Formats" },
      links: [{ rel: "self", href: "feed.json", type: "application/opds+json" }],
      publications: [
        {
          metadata: { title: "Format Book" },
          links: [
            { rel: "http://opds-spec.org/acquisition", href: "book.azw3" },
            {
              rel: "http://opds-spec.org/acquisition",
              href: "book-with-mime.azw3",
              type: "application/vnd.amazon.ebook",
            },
            {
              rel: "http://opds-spec.org/acquisition",
              href: "generic.zip",
              type: "application/zip",
            },
            { rel: "http://opds-spec.org/acquisition", href: "book.unknown" },
          ],
        },
      ],
    });

    expect(
      parseOpdsDocument(
        body,
        "application/opds+json",
        "https://catalog.test/feed.json",
      ).publications[0]?.acquisitions.map((item) => item.format),
    ).toEqual(["azw3", "azw3", null, null]);
  });

  it.each(["acquisition", "borrow", "buy", "download", "preview", "subscribe"])(
    "recognizes the OPDS 2 %s acquisition relation",
    (rel) => {
      const body = JSON.stringify({
        metadata: { title: "Relations" },
        links: [{ rel: "self", href: "feed.json" }],
        publications: [
          {
            metadata: { title: `${rel} Book` },
            links: [{ rel, href: `books/${rel}.epub`, type: "application/epub+zip" }],
          },
        ],
      });

      expect(
        parseOpdsDocument(body, "application/opds+json", "https://catalog.test/root/feed.json")
          .publications[0]?.acquisitions,
      ).toEqual([
        expect.objectContaining({
          url: `https://catalog.test/root/books/${rel}.epub`,
          format: "epub",
        }),
      ]);
    },
  );

  it.each([
    "http://opds-spec.org/acquisition",
    "http://opds-spec.org/acquisition/borrow",
    "http://opds-spec.org/acquisition/open-access",
  ])("recognizes the OPDS 1 acquisition relation %s in OPDS 2", (rel) => {
    const body = JSON.stringify({
      metadata: { title: "Legacy Relations" },
      links: [{ rel: "self", href: "feed.json" }],
      publications: [
        {
          metadata: { title: "Legacy Book" },
          links: [{ rel, href: "books/legacy.pdf", type: "application/pdf" }],
        },
      ],
    });

    expect(
      parseOpdsDocument(body, "application/opds+json", "https://catalog.test/root/feed.json")
        .publications[0]?.acquisitions,
    ).toEqual([
      expect.objectContaining({
        url: "https://catalog.test/root/books/legacy.pdf",
        format: "pdf",
      }),
    ]);
  });

  it("rejects a title-only OPDS 2 publication", () => {
    const body = JSON.stringify({
      metadata: { title: "Catalog" },
      links: [{ rel: "self", href: "feed.json" }],
      publications: [{ metadata: { title: "No way to read me" } }],
    });

    expect(() =>
      parseOpdsDocument(body, "application/opds+json", "https://catalog.test/feed.json"),
    ).toThrow("Invalid OPDS 2 catalog");
  });

  it("accepts and maps a publication with a valid reading order", () => {
    const body = JSON.stringify({
      metadata: { title: "Web Publications" },
      links: [{ rel: "self", href: "feed.json" }],
      publications: [
        {
          metadata: { title: "Web Book" },
          readingOrder: [{ href: "chapters/1.html", type: "text/html", title: "Chapter One" }],
        },
      ],
    });

    expect(
      parseOpdsDocument(body, "application/opds+json", "https://catalog.test/root/feed.json")
        .publications[0]?.readingOrder,
    ).toEqual([
      {
        rel: [],
        url: "https://catalog.test/root/chapters/1.html",
        type: "text/html",
        title: "Chapter One",
      },
    ]);
  });

  it.each([
    ["a non-array reading order", { href: "chapter.html" }],
    ["an empty reading order", []],
    ["a reading-order item without an href", [{ type: "text/html" }]],
    ["a reading-order item with a non-string href", [{ href: 7, type: "text/html" }]],
    ["a reading-order item with a non-string type", [{ href: "chapter.html", type: 7 }]],
  ])("rejects a publication with %s", (_name, readingOrder) => {
    const body = JSON.stringify({
      metadata: { title: "Web Publications" },
      links: [{ rel: "self", href: "feed.json" }],
      publications: [{ metadata: { title: "Broken Web Book" }, readingOrder }],
    });

    expect(() =>
      parseOpdsDocument(body, "application/opds+json", "https://catalog.test/feed.json"),
    ).toThrow("Invalid OPDS 2 catalog");
  });

  it.each([
    ["application/opds+json", "{", "Invalid OPDS JSON document"],
    ["application/opds+json", JSON.stringify({ metadata: {} }), "Invalid OPDS 2 catalog"],
    ["application/opds+json", JSON.stringify([]), "Invalid OPDS 2 catalog"],
    ["application/xml", "<feed><title>Broken</feed>", "Invalid OPDS XML document"],
  ])("rejects invalid documents with stable errors", (contentType, body, message) => {
    expect(() => parseOpdsDocument(body, contentType, "https://catalog.test/feed")).toThrow(
      message,
    );
  });

  it.each([
    [
      "missing self link",
      {
        metadata: { title: "Catalog" },
        navigation: [{ title: "Books", href: "books" }],
      },
    ],
    [
      "missing catalog collection",
      {
        metadata: { title: "Catalog" },
        links: [{ rel: "self", href: "feed.json" }],
      },
    ],
    [
      "blank catalog collection",
      {
        metadata: { title: "Catalog" },
        links: [{ rel: "self", href: "feed.json" }],
        publications: [],
      },
    ],
    [
      "group with both collection roles",
      {
        metadata: { title: "Catalog" },
        links: [{ rel: "self", href: "feed.json" }],
        groups: [
          {
            metadata: { title: "Mixed" },
            navigation: [{ title: "Books", href: "books" }],
            publications: [{ metadata: { title: "Book" } }],
          },
        ],
      },
    ],
    [
      "group without a collection role",
      {
        metadata: { title: "Catalog" },
        links: [{ rel: "self", href: "feed.json" }],
        groups: [{ metadata: { title: "Empty" } }],
      },
    ],
    [
      "group without a title",
      {
        metadata: { title: "Catalog" },
        links: [{ rel: "self", href: "feed.json" }],
        groups: [{ metadata: {}, navigation: [{ title: "Books", href: "books" }] }],
      },
    ],
    [
      "group with an invalid navigation link",
      {
        metadata: { title: "Catalog" },
        links: [{ rel: "self", href: "feed.json" }],
        groups: [{ metadata: { title: "Broken" }, navigation: [{ title: "Books" }] }],
      },
    ],
    [
      "facet without a title",
      {
        metadata: { title: "Catalog" },
        links: [{ rel: "self", href: "feed.json" }],
        navigation: [{ title: "Books", href: "books" }],
        facets: [{ metadata: {}, links: [{ href: "fiction" }] }],
      },
    ],
    [
      "facet without links",
      {
        metadata: { title: "Catalog" },
        links: [{ rel: "self", href: "feed.json" }],
        navigation: [{ title: "Books", href: "books" }],
        facets: [{ metadata: { title: "Genre" } }],
      },
    ],
    [
      "facet with an invalid link",
      {
        metadata: { title: "Catalog" },
        links: [{ rel: "self", href: "feed.json" }],
        navigation: [{ title: "Books", href: "books" }],
        facets: [{ metadata: { title: "Genre" }, links: [{ title: "Fiction" }] }],
      },
    ],
  ])("rejects an OPDS 2 feed with %s", (_name, value) => {
    expect(() =>
      parseOpdsDocument(
        JSON.stringify(value),
        "application/opds+json",
        "https://catalog.test/feed.json",
      ),
    ).toThrow("Invalid OPDS 2 catalog");
  });

  it("rejects a feed in an unrelated XML namespace", () => {
    expect(() =>
      parseOpdsDocument(
        '<feed xmlns="urn:not-atom"><title>Not Atom</title></feed>',
        "application/atom+xml",
        "https://catalog.test/feed.xml",
      ),
    ).toThrow("Invalid OPDS XML document");
  });

  it.each([
    ["empty Atom feed", '<feed xmlns="http://www.w3.org/2005/Atom"><title>News</title></feed>'],
    [
      "generic Atom feed",
      '<feed xmlns="http://www.w3.org/2005/Atom"><title>News</title><entry><title>Story</title><link href="story.html" type="text/html" /></entry></feed>',
    ],
  ])("rejects a non-OPDS %s", (_name, body) => {
    expect(() =>
      parseOpdsDocument(body, "application/atom+xml", "https://catalog.test/feed.xml"),
    ).toThrow("Invalid OPDS XML document");
  });

  it("keeps compatibility with namespace-less Atom feeds", () => {
    const feed = parseOpdsDocument(
      '<feed><title>Legacy Catalog</title><entry><title>Books</title><link href="books.xml" type="application/atom+xml;profile=opds-catalog" /></entry></feed>',
      "application/atom+xml",
      "https://catalog.test/feed.xml",
    );

    expect(feed).toMatchObject({
      title: "Legacy Catalog",
      navigation: [{ title: "Books", url: "https://catalog.test/books.xml" }],
    });
  });

  it("rejects Atom-shaped children in an unrelated namespace", () => {
    const body = `<feed><title>Catalog</title><entry><wrong:title xmlns:wrong="urn:not-atom">Not Atom</wrong:title><link href="books.xml" type="application/atom+xml;profile=opds-catalog" /></entry></feed>`;

    expect(() =>
      parseOpdsDocument(body, "application/atom+xml", "https://catalog.test/feed.xml"),
    ).toThrow("Invalid OPDS XML document");
  });

  it.each([
    [
      "an unrelated namespace descendant",
      `<feed xmlns="http://www.w3.org/2005/Atom"><title>News</title><entry><title>Story</title><link href="more.xml" type="application/atom+xml" /><content><link xmlns="urn:not-atom" rel="http://opds-spec.org/acquisition" href="book.epub" type="application/epub+zip" /></content></entry></feed>`,
    ],
    [
      "a nested Atom link",
      `<feed xmlns="http://www.w3.org/2005/Atom"><title>News</title><entry><title>Story</title><link href="more.xml" type="application/atom+xml" /><content><link rel="http://opds-spec.org/acquisition" href="book.epub" type="application/epub+zip" /></content></entry></feed>`,
    ],
  ])("rejects OPDS evidence from %s", (_name, body) => {
    expect(() =>
      parseOpdsDocument(body, "application/atom+xml", "https://catalog.test/feed.xml"),
    ).toThrow("Invalid OPDS XML document");
  });

  it.each([
    [
      "a search link without href",
      `<link rel="search" type="application/opensearchdescription+xml" />`,
    ],
    [
      "a navigation link without href",
      `<link rel="next" type="application/atom+xml;profile=opds-catalog" />`,
    ],
    [
      "a search link with a blank href",
      `<link rel="search" href="   " type="application/opensearchdescription+xml" />`,
    ],
    [
      "a navigation link with an invalid href",
      `<link rel="next" href="http://[::1" type="application/atom+xml;profile=opds-catalog" />`,
    ],
    [
      "a feed-level acquisition",
      `<link rel="http://opds-spec.org/acquisition" href="book.epub" type="application/epub+zip" />`,
    ],
    [
      "an entry acquisition without href",
      `<entry><title>Book</title><link rel="http://opds-spec.org/acquisition" type="application/epub+zip" /></entry>`,
    ],
    [
      "an entry acquisition with an invalid href",
      `<entry><title>Book</title><link rel="http://opds-spec.org/acquisition" href="http://[::1" type="application/epub+zip" /></entry>`,
    ],
  ])("rejects an otherwise empty Atom feed with %s", (_name, evidence) => {
    const body = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Generic feed</title>${evidence}</feed>`;

    expect(() =>
      parseOpdsDocument(body, "application/atom+xml", "https://catalog.test/feed.xml"),
    ).toThrow("Invalid OPDS XML document");
  });

  it("accepts a direct feed navigation link with a valid href", () => {
    const body = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Catalog</title><link rel="next" href="page-2.xml" type="application/atom+xml;profile=opds-catalog" /></feed>`;

    expect(
      parseOpdsDocument(body, "application/atom+xml", "https://catalog.test/feed.xml"),
    ).toMatchObject({ title: "Catalog", nextUrl: "https://catalog.test/page-2.xml" });
  });

  it("accepts an acquisition link owned by a direct entry", () => {
    const body = `<feed xmlns="http://www.w3.org/2005/Atom"><title>Catalog</title><entry><title>Book</title><link rel="http://opds-spec.org/acquisition" href="book.epub" type="application/epub+zip" /></entry></feed>`;

    expect(
      parseOpdsDocument(body, "application/atom+xml", "https://catalog.test/feed.xml").publications,
    ).toHaveLength(1);
  });

  it.each([
    [
      "navigation",
      `<entry><title>Books</title><link href="books.xml" type="Application/Atom+XML; PROFILE=&quot;OPDS-CATALOG&quot;; charset=utf-8" /></entry>`,
    ],
    [
      "search",
      `<link rel="search" href="search.xml" type="Application/OpenSearchDescription+XML; charset=UTF-8" />`,
    ],
    [
      "facet",
      `<link rel="http://opds-spec.org/facet" href="fiction.xml" title="Fiction" opds:facetGroup="Genre" />`,
    ],
    [
      "acquisition",
      `<entry><title>Book</title><link rel="http://opds-spec.org/acquisition" href="book.epub" type="application/epub+zip" /></entry>`,
    ],
  ])("accepts a valid Atom OPDS %s feed", (_name, evidence) => {
    const body = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog"><title>Catalog</title>${evidence}</feed>`;

    expect(
      parseOpdsDocument(body, "application/atom+xml", "https://catalog.test/feed.xml").title,
    ).toBe("Catalog");
  });

  it("preserves distinct Atom IDs when grouped entries share an acquisition URL", () => {
    const body = `<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Grouped catalog</title>
  <entry>
    <id>urn:book:first</id><title>First</title>
    <link rel="http://opds-spec.org/group" href="#featured" title="Featured" />
    <link rel="http://opds-spec.org/acquisition" href="same.epub" type="application/epub+zip" />
  </entry>
  <entry>
    <id>urn:book:second</id><title>Second</title>
    <link rel="http://opds-spec.org/group" href="#featured" title="Featured" />
    <link rel="http://opds-spec.org/acquisition" href="same.epub" type="application/epub+zip" />
  </entry>
</feed>`;

    const feed = parseOpdsDocument(body, "application/atom+xml", "https://catalog.test/feed");
    expect(feed.groups[0]?.publications.map(({ id }) => id)).toEqual([
      "urn:book:first",
      "urn:book:second",
    ]);
  });

  it("does not read a real local file through an external XML entity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "readany-opds-xxe-"));
    const marker = `READANY_XXE_MARKER_${Date.now()}`;
    const markerPath = join(directory, "marker.txt");
    await writeFile(markerPath, marker, "utf8");

    try {
      const body = `<?xml version="1.0"?>
<!DOCTYPE feed [<!ENTITY xxe SYSTEM "${pathToFileURL(markerPath).href}">]>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opds="http://opds-spec.org/2010/catalog">
  <title>Safe catalog</title>
  <entry>
    <title>Safe book</title>
    <content type="text">&xxe;</content>
    <link rel="http://opds-spec.org/acquisition" href="book.epub" type="application/epub+zip" />
  </entry>
</feed>`;

      const feed = parseOpdsDocument(body, "application/atom+xml", "https://catalog.test/feed");
      expect(JSON.stringify(feed)).not.toContain(marker);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("does not expand internal XML entities", () => {
    const body = `<?xml version="1.0"?>
<!DOCTYPE feed [<!ENTITY internal "INTERNAL_ENTITY_MARKER">]>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Safe catalog</title>
  <entry>
    <title>Safe book</title>
    <content type="text">&internal;</content>
    <link rel="http://opds-spec.org/acquisition" href="book.epub" type="application/epub+zip" />
  </entry>
</feed>`;

    const feed = parseOpdsDocument(body, "application/atom+xml", "https://catalog.test/feed");
    expect(JSON.stringify(feed)).not.toContain("INTERNAL_ENTITY_MARKER");
  });

  it("sanitizes an Atom XHTML description without losing safe markup", () => {
    const body = `<feed xmlns="http://www.w3.org/2005/Atom">
  <title>XHTML catalog</title>
  <entry>
    <title>XHTML book</title>
    <content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p onmouseover="steal()">Keep <strong>this</strong><img src="https://evil.test/pixel" /></p><script>steal()</script></div></content>
    <link rel="http://opds-spec.org/acquisition" href="book.epub" type="application/epub+zip" />
  </entry>
</feed>`;

    const feed = parseOpdsDocument(body, "application/atom+xml", "https://catalog.test/feed");
    expect(feed.publications[0]?.description).toBe("<p>Keep <strong>this</strong></p>");
  });
});
