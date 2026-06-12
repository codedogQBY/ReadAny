import { describe, expect, it } from "vitest";
import { buildChapterSectionGroups } from "./chapter-structure";

describe("buildChapterSectionGroups", () => {
  it("uses leaf TOC entries as logical chapters for multi-volume books", () => {
    const groups = buildChapterSectionGroups(
      [
        { href: "cover.xhtml" },
        { href: "volume-1.xhtml" },
        { href: "chapter-1.xhtml" },
        { href: "chapter-1-extra.xhtml" },
        { href: "chapter-2.xhtml" },
        { href: "volume-2.xhtml" },
        { href: "chapter-3.xhtml" },
      ],
      [
        {
          label: "第一卷",
          href: "volume-1.xhtml",
          subitems: [
            { label: "第一章", href: "chapter-1.xhtml" },
            { label: "第二章", href: "chapter-2.xhtml" },
          ],
        },
        {
          label: "第二卷",
          href: "volume-2.xhtml",
          subitems: [{ label: "第三章", href: "chapter-3.xhtml" }],
        },
      ],
    );

    expect(groups).toEqual([
      { index: 0, title: "第一章", sectionIndices: [2, 3] },
      { index: 1, title: "第二章", sectionIndices: [4] },
      { index: 2, title: "第三章", sectionIndices: [6] },
    ]);
  });

  it("falls back to top-level TOC entries when no leaf hrefs exist", () => {
    const groups = buildChapterSectionGroups(
      [{ href: "intro.xhtml" }, { href: "body.xhtml" }],
      [{ label: "正文", href: "body.xhtml", subitems: [] }],
    );

    expect(groups).toEqual([{ index: 0, title: "正文", sectionIndices: [1] }]);
  });

  it("normalizes encoded and relative hrefs before matching sections", () => {
    const groups = buildChapterSectionGroups(
      [{ href: "Text/第1章.xhtml" }, { href: "Text/%E7%AC%AC2%E7%AB%A0.xhtml" }],
      [
        { label: "第一章", href: "./Text/%E7%AC%AC1%E7%AB%A0.xhtml#start" },
        { label: "第二章", href: "第2章.xhtml" },
      ],
    );

    expect(groups).toEqual([
      { index: 0, title: "第一章", sectionIndices: [0] },
      { index: 1, title: "第二章", sectionIndices: [1] },
    ]);
  });

  it("falls back to one group per section when TOC has no usable anchors", () => {
    const groups = buildChapterSectionGroups([{ href: "a.xhtml" }, { href: "b.xhtml" }], []);

    expect(groups).toEqual([
      { index: 0, title: "Section 1", sectionIndices: [0] },
      { index: 1, title: "Section 2", sectionIndices: [1] },
    ]);
  });
});
