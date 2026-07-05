import { describe, expect, it } from "vitest";
import { getFirstTocHref } from "./toc";

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
