import type { TOCItem } from "../types";

export function getFirstTocHref(item: TOCItem | null | undefined): string | null {
  const href = item?.href?.trim();
  if (href) return href;

  for (const child of item?.subitems ?? []) {
    const childHref = getFirstTocHref(child);
    if (childHref) return childHref;
  }

  return null;
}
