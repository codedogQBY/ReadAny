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

  it("uses parent chapter entries when child TOC entries are same-section fragments", () => {
    const groups = buildChapterSectionGroups(
      [
        { href: "Text/part0008.xhtml" },
        { href: "Text/part0009.xhtml" },
        { href: "Text/part0010.xhtml" },
      ],
      [
        {
          label: "第1章 整洁代码",
          href: "Text/part0008.xhtml",
          subitems: [
            { label: "1.1 要有代码", href: "Text/part0008.xhtml#bw1" },
            { label: "1.2 糟糕的代码", href: "Text/part0008.xhtml#bw2" },
          ],
        },
        {
          label: "第2章 有意义的命名",
          href: "Text/part0009.xhtml",
          subitems: [
            { label: "2.1 介绍", href: "Text/part0009.xhtml#bw15" },
            { label: "2.2 名副其实", href: "Text/part0009.xhtml#bw16" },
          ],
        },
        { label: "第3章 函数", href: "Text/part0010.xhtml" },
      ],
    );

    expect(groups).toEqual([
      { index: 0, title: "第1章 整洁代码", sectionIndices: [0] },
      { index: 1, title: "第2章 有意义的命名", sectionIndices: [1] },
      { index: 2, title: "第3章 函数", sectionIndices: [2] },
    ]);
  });

  it("uses TOC item indices when section hrefs are unavailable", () => {
    const groups = buildChapterSectionGroups(
      [{}, {}, {}],
      [
        {
          label: "第1章 整洁代码",
          href: "Text/part0008.xhtml",
          index: 0,
          subitems: [
            { label: "1.1 要有代码", href: "Text/part0008.xhtml#bw1", index: 0 },
            { label: "1.2 糟糕的代码", href: "Text/part0008.xhtml#bw2", index: 0 },
          ],
        },
        {
          label: "第2章 有意义的命名",
          href: "Text/part0009.xhtml",
          index: 1,
          subitems: [{ label: "2.1 介绍", href: "Text/part0009.xhtml#bw15", index: 1 }],
        },
        { label: "第3章 函数", href: "Text/part0010.xhtml", index: 2 },
      ],
    );

    expect(groups).toEqual([
      { index: 0, title: "第1章 整洁代码", sectionIndices: [0] },
      { index: 1, title: "第2章 有意义的命名", sectionIndices: [1] },
      { index: 2, title: "第3章 函数", sectionIndices: [2] },
    ]);
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
