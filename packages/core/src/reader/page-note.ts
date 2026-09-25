/**
 * Page-level note helpers（桌面端与移动端共用）。
 *
 * 页级笔记（page-level note）锚定在「当前位置」，用于固定版式（PDF/CBZ）等无法选中文本的格式。
 * 这些格式的位置是 foliate 的「假 section」CFI —— `epubcfi(/6/N)`，N = 页码 * 2
 * （见 packages/foliate-js/pdf.js 的 fakePageCfi），所以页码可以从 CFI 反推，用作列表标题。
 * 可重排格式（EPUB）用的是真实位置 CFI，不含页码，标题回落到通用徽标
 * （章节标题在下方单独显示，提供上下文）。
 *
 * 注意：这段逻辑原先只存在于桌面端（packages/app/src/lib/reader/page-note.ts），
 * 导致移动端页级笔记展示不出页码标题 —— 现移到 core，两端共用。
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
