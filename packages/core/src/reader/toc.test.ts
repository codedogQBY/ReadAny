import { describe, expect, it } from "vitest";
import { getFirstTocHref, resolveCurrentChapterFromToc } from "./toc";

describe("getFirstTocHref", () => {
  it("returns the current item href when present", () => {
    expect(
      getFirstTocHref({
        id: "chapter-1",
        title: "Chapter 1",
        level: 0,
        href: "chapter-1.xhtml",
        subitems: [
          {
            id: "chapter-1-1",
            title: "Chapter 1.1",
            level: 1,
            href: "chapter-1-1.xhtml",
          },
        ],
      }),
    ).toBe("chapter-1.xhtml");
  });

  it("falls back to the first descendant href for grouping nodes", () => {
    expect(
      getFirstTocHref({
        id: "volume-1",
        title: "Volume 1",
        level: 0,
        subitems: [
          {
            id: "part-1",
            title: "Part 1",
            level: 1,
            subitems: [
              {
                id: "chapter-1",
                title: "Chapter 1",
                level: 2,
                href: "text/chapter-1.xhtml#start",
              },
            ],
          },
        ],
      }),
    ).toBe("text/chapter-1.xhtml#start");
  });

  it("ignores blank href values", () => {
    expect(
      getFirstTocHref({
        id: "volume-1",
        title: "Volume 1",
        level: 0,
        href: "   ",
        subitems: [
          {
            id: "chapter-1",
            title: "Chapter 1",
            level: 1,
            href: "chapter-1.xhtml",
          },
        ],
      }),
    ).toBe("chapter-1.xhtml");
  });

  it("returns null when no item in the branch can be opened", () => {
    expect(
      getFirstTocHref({
        id: "volume-1",
        title: "Volume 1",
        level: 0,
        subitems: [{ id: "part-1", title: "Part 1", level: 1 }],
      }),
    ).toBeNull();
  });
});

describe("resolveCurrentChapterFromToc", () => {
  it("maps a same-section subsection back to its logical parent chapter", () => {
    const result = resolveCurrentChapterFromToc(
      [
        { id: "chapter-7", title: "Chapter 7", level: 0, href: "Text/c07.xhtml" },
        {
          id: "chapter-8",
          title: "Chapter 8: Higher Libido Partners",
          level: 0,
          href: "Text/c08.xhtml",
          subitems: [
            {
              id: "opening-up",
              title: "Opening Up",
              level: 1,
              href: "Text/c08.xhtml#opening-up",
            },
          ],
        },
      ],
      { label: "Opening Up", href: "Text/c08.xhtml#opening-up" },
      12,
    );

    expect(result).toEqual({
      index: 1,
      title: "Chapter 8: Higher Libido Partners",
      href: "Text/c08.xhtml",
    });
  });

  it("keeps a nested chapter when its parent spans multiple section hrefs", () => {
    const result = resolveCurrentChapterFromToc(
      [
        {
          id: "part-1",
          title: "Part I",
          level: 0,
          href: "Text/part-1.xhtml",
          subitems: [
            { id: "chapter-1", title: "Chapter 1", level: 1, href: "Text/c01.xhtml" },
            { id: "chapter-2", title: "Chapter 2", level: 1, href: "Text/c02.xhtml" },
          ],
        },
      ],
      { label: "Chapter 2", href: "Text/c02.xhtml" },
      9,
    );

    expect(result).toEqual({ index: 1, title: "Chapter 2", href: "Text/c02.xhtml" });
  });

  it("falls back to the relocate payload while the TOC is still loading", () => {
    const result = resolveCurrentChapterFromToc(
      [],
      { label: "Opening Up", href: "Text/c08.xhtml#opening-up" },
      12,
    );

    expect(result).toEqual({
      index: 12,
      title: "Opening Up",
      href: "Text/c08.xhtml#opening-up",
    });
  });
});
