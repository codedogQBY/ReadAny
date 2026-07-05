export interface TocTreeItemLike {
  label?: string;
  href?: string;
  index?: number;
  subitems?: TocTreeItemLike[];
}

export interface SectionRefLike {
  href?: string;
}

export interface ChapterSectionGroup {
  index: number;
  title: string;
  sectionIndices: number[];
}

interface TocAnchor {
  title: string;
  sectionIndex: number;
}

export function buildChapterSectionGroups(
  sections: SectionRefLike[],
  toc: TocTreeItemLike[] = [],
): ChapterSectionGroup[] {
  if (sections.length === 0) return [];

  const tocAnchors = getTocAnchors(sections, toc);
  if (tocAnchors.length === 0) {
    return sections.map((_, index) => ({
      index,
      title: `Section ${index + 1}`,
      sectionIndices: [index],
    }));
  }

  const boundaryIndices = getTocBoundaryIndices(sections, toc);
  return tocAnchors.map((anchor, index) => {
    const endExclusive =
      boundaryIndices.find((boundaryIndex) => boundaryIndex > anchor.sectionIndex) ??
      sections.length;
    return {
      index,
      title: anchor.title,
      sectionIndices: range(anchor.sectionIndex, Math.max(anchor.sectionIndex + 1, endExclusive)),
    };
  });
}

function getTocAnchors(sections: SectionRefLike[], toc: TocTreeItemLike[]): TocAnchor[] {
  const hrefToSectionIndex = buildSectionHrefIndex(sections);
  const anchors: TocAnchor[] = [];
  const seenSectionIndices = new Set<number>();

  for (const item of flattenToc(toc)) {
    const title = item.label?.trim();
    if (!title) continue;

    const sectionIndex = getSectionIndexForTocItem(item, hrefToSectionIndex, sections.length);
    if (sectionIndex === null || seenSectionIndices.has(sectionIndex)) continue;
    if (!shouldUseTocItemAsChapterAnchor(item, sectionIndex, hrefToSectionIndex, sections.length)) {
      continue;
    }

    seenSectionIndices.add(sectionIndex);
    anchors.push({ title, sectionIndex });
  }

  return anchors.sort((a, b) => a.sectionIndex - b.sectionIndex);
}

function getTocBoundaryIndices(sections: SectionRefLike[], toc: TocTreeItemLike[]): number[] {
  const hrefToSectionIndex = buildSectionHrefIndex(sections);
  const seen = new Set<number>();

  for (const item of flattenToc(toc)) {
    const sectionIndex = getSectionIndexForTocItem(item, hrefToSectionIndex, sections.length);
    if (sectionIndex !== null) {
      seen.add(sectionIndex);
    }
  }

  return Array.from(seen).sort((a, b) => a - b);
}

function shouldUseTocItemAsChapterAnchor(
  item: TocTreeItemLike,
  sectionIndex: number,
  hrefToSectionIndex: Map<string, number>,
  sectionCount: number,
): boolean {
  if (!item.subitems?.length) return true;

  const descendantSectionIndices = flattenToc(item.subitems)
    .map((child) => getSectionIndexForTocItem(child, hrefToSectionIndex, sectionCount))
    .filter((index): index is number => index !== null);

  if (descendantSectionIndices.length === 0) return true;

  return descendantSectionIndices.every((descendantIndex) => descendantIndex === sectionIndex);
}

function buildSectionHrefIndex(sections: SectionRefLike[]): Map<string, number> {
  const hrefToSectionIndex = new Map<string, number>();

  for (let index = 0; index < sections.length; index++) {
    const href = sections[index]?.href;
    if (!href) continue;

    for (const key of getHrefLookupKeys(href)) {
      if (!hrefToSectionIndex.has(key)) {
        hrefToSectionIndex.set(key, index);
      }
    }
  }

  return hrefToSectionIndex;
}

function getSectionIndexForTocItem(
  item: TocTreeItemLike,
  hrefToSectionIndex: Map<string, number>,
  sectionCount: number,
): number | null {
  if (item.href) {
    for (const key of getHrefLookupKeys(item.href)) {
      const sectionIndex = hrefToSectionIndex.get(key);
      if (sectionIndex !== undefined) return sectionIndex;
    }
  }

  if (
    typeof item.index === "number" &&
    Number.isInteger(item.index) &&
    item.index >= 0 &&
    item.index < sectionCount
  ) {
    return item.index;
  }

  return null;
}

function flattenToc(toc: TocTreeItemLike[]): TocTreeItemLike[] {
  const items: TocTreeItemLike[] = [];

  for (const item of toc) {
    items.push(item);
    if (item.subitems?.length) {
      items.push(...flattenToc(item.subitems));
    }
  }

  return items;
}

function getHrefLookupKeys(href: string): string[] {
  const decoded = safeDecodeUri(href);
  const withoutFragment = decoded.split("#")[0] || decoded;
  const normalized = normalizeHrefPath(withoutFragment);
  const fileName = normalized.split("/").pop() || normalized;

  return Array.from(new Set([decoded, withoutFragment, normalized, fileName].filter(Boolean)));
}

function normalizeHrefPath(href: string): string {
  return href.replace(/^\/+/, "").replace(/^\.\//, "");
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function range(start: number, endExclusive: number): number[] {
  const values: number[] = [];
  for (let index = start; index < endExclusive; index++) {
    values.push(index);
  }
  return values;
}
