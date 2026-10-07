import type { TOCItem } from "../types";

export interface CurrentChapterReference {
  index: number;
  title: string;
  href: string;
}

interface CurrentTocItemLike {
  label?: string;
  href?: string;
}

export function getFirstTocHref(item: TOCItem | null | undefined): string | null {
  const href = item?.href?.trim();
  if (href) return href;

  for (const child of item?.subitems ?? []) {
    const childHref = getFirstTocHref(child);
    if (childHref) return childHref;
  }

  return null;
}

export function resolveCurrentChapterFromToc(
  toc: TOCItem[],
  currentItem: CurrentTocItemLike,
  currentSectionIndex: number,
): CurrentChapterReference {
  const fallback = {
    index: currentSectionIndex,
    title: currentItem.label?.trim() || "",
    href: currentItem.href?.trim() || "",
  };
  if (toc.length === 0) return fallback;

  const logicalChapters = collectLogicalChapters(toc);
  const currentHrefKey = getHrefKey(currentItem.href);
  const currentTitle = currentItem.label?.trim();
  const chapterIndex = logicalChapters.findIndex((item) => {
    const itemHrefKey = getHrefKey(item.href);
    if (currentHrefKey && itemHrefKey) return itemHrefKey === currentHrefKey;
    return Boolean(currentTitle && item.title.trim() === currentTitle);
  });
  if (chapterIndex < 0) return fallback;

  const chapter = logicalChapters[chapterIndex];
  return {
    index: chapterIndex,
    title: chapter.title.trim(),
    href: chapter.href?.trim() || fallback.href,
  };
}

function collectLogicalChapters(toc: TOCItem[]): TOCItem[] {
  const chapters: TOCItem[] = [];
  const seenHrefKeys = new Set<string>();

  const visit = (item: TOCItem) => {
    const itemHrefKey = getHrefKey(item.href);
    const descendantHrefKeys = collectDescendantHrefKeys(item.subitems ?? []);
    const isSameSectionChapter =
      Boolean(itemHrefKey) &&
      descendantHrefKeys.length > 0 &&
      descendantHrefKeys.every((hrefKey) => hrefKey === itemHrefKey);

    if (isSameSectionChapter || !item.subitems?.length) {
      if (itemHrefKey && !seenHrefKeys.has(itemHrefKey)) {
        seenHrefKeys.add(itemHrefKey);
        chapters.push(item);
      }
      return;
    }

    for (const child of item.subitems) visit(child);
  };

  for (const item of toc) visit(item);
  return chapters;
}

function collectDescendantHrefKeys(items: TOCItem[]): string[] {
  const hrefKeys: string[] = [];
  for (const item of items) {
    const hrefKey = getHrefKey(item.href);
    if (hrefKey) hrefKeys.push(hrefKey);
    if (item.subitems?.length) hrefKeys.push(...collectDescendantHrefKeys(item.subitems));
  }
  return hrefKeys;
}

function getHrefKey(href: string | undefined): string {
  if (!href?.trim()) return "";
  const decoded = safeDecodeUri(href.trim());
  return (decoded.split("#")[0] || decoded).replace(/^\.?\//, "");
}

function safeDecodeUri(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
