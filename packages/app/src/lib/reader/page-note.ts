/**
 * Page-level note helpers.
 *
 * Page-level notes anchor to the current position. For fixed-layout books
 * (PDF/CBZ) that position is a foliate "fake" section CFI — `epubcfi(/6/N)`
 * where N = (pageIndex + 1) * 2 — so the page number can be recovered from
 * the CFI for list labels. Reflowable books use real position CFIs, which
 * carry no page number; their label falls back to the generic badge (the
 * chapter title shown beneath provides the context).
 */

const FAKE_SECTION_CFI_RE = /^epubcfi\(\/6\/(\d+)\)$/;

export function parseFakeCfiPage(cfi: string): number | null {
  const match = FAKE_SECTION_CFI_RE.exec(cfi.trim());
  if (!match) return null;
  const page = Math.round(Number(match[1]) / 2);
  return page > 0 ? page : null;
}

type LabelT = (key: string, options?: Record<string, unknown>) => string;

/** List label for a page-level note: "第N页笔记" when the page is known. */
export function pageNoteLabel(cfi: string, t: LabelT): string {
  const page = parseFakeCfiPage(cfi);
  return page
    ? t("notebook.pageNoteWithPage", { page })
    : t("notebook.pageNoteBadge");
}
