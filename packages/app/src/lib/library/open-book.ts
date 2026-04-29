import { useAppStore } from "@/stores/app-store";
import { useLibraryStore } from "@/stores/library-store";
import { useMissingBookPromptStore } from "@/stores/missing-book-prompt-store";
import { setBookSyncStatus } from "@readany/core/db/database";
import { getPlatformService } from "@readany/core/services";
import { useSyncStore } from "@readany/core/stores/sync-store";
import { downloadBookFile } from "@readany/core/sync";
import { createSyncBackend } from "@readany/core/sync/sync-backend-factory";
import type { Book } from "@readany/core/types";
import type { TFunction } from "i18next";
import { toast } from "sonner";

interface OpenDesktopBookOptions {
  book: Book;
  t: TFunction;
  initialCfi?: string;
}

function normalizeBookIdentityText(value?: string): string {
  return (value || "").toLowerCase().replace(/[\s\p{P}\p{S}_-]+/gu, "");
}

function authorsLikelyMatch(a?: string, b?: string): boolean {
  const left = normalizeBookIdentityText(a);
  const right = normalizeBookIdentityText(b);
  if (!left || !right) return true;
  if (left === right || left.includes(right) || right.includes(left)) return true;
  const leftParts = left.split(/[,，、/&]+/).filter((part) => part.length > 1);
  const rightParts = right.split(/[,，、/&]+/).filter((part) => part.length > 1);
  return leftParts.some((part) =>
    rightParts.some((candidate) => part.includes(candidate) || candidate.includes(part)),
  );
}

function shouldConfirmReimportCandidate(
  originalBook: Book,
  candidate: { title: string; author: string; format: Book["format"]; fileHash?: string },
): boolean {
  if (candidate.fileHash && originalBook.fileHash && candidate.fileHash === originalBook.fileHash) {
    return false;
  }
  const originalTitle = normalizeBookIdentityText(originalBook.meta.title);
  const candidateTitle = normalizeBookIdentityText(candidate.title);
  const titleMismatch =
    !!originalTitle &&
    !!candidateTitle &&
    originalTitle !== candidateTitle &&
    !originalTitle.includes(candidateTitle) &&
    !candidateTitle.includes(originalTitle);
  const authorMismatch = !authorsLikelyMatch(originalBook.meta.author, candidate.author);
  const formatMismatch = originalBook.format !== candidate.format;
  return titleMismatch || (formatMismatch && authorMismatch);
}

const pendingDownloads = new Set<string>();
const BOOK_IMPORT_FILTERS = [
  {
    name: "Books",
    extensions: ["epub", "pdf", "mobi", "azw", "azw3", "cbz", "fb2", "fbz", "txt"],
  },
];

function isLikelyRelativeDesktopPath(path: string): boolean {
  if (!path) return false;
  return !/^(\/|file:\/\/|asset:\/\/|https?:\/\/|[A-Za-z]:[\\/])/i.test(path);
}

function openReaderTab(book: Book, initialCfi?: string) {
  const { addTab, setActiveTab } = useAppStore.getState();
  const tabId = `reader-${book.id}`;
  addTab({
    id: tabId,
    type: "reader",
    title: book.meta.title,
    bookId: book.id,
    initialCfi,
  });
  setActiveTab(tabId);
}

export async function openDesktopBook({
  book,
  t,
  initialCfi,
}: OpenDesktopBookOptions): Promise<boolean> {
  const { books, setBooks, loadBooks, inspectDeletedBookCandidate, reimportDeletedBook } =
    useLibraryStore.getState();

  if (pendingDownloads.has(book.id) || book.syncStatus === "downloading") {
    return false;
  }

  if (book.syncStatus === "remote") {
    const syncStore = useSyncStore.getState();
    if (!syncStore.config) {
      toast.error(t("settings.syncNotConfigured"));
      return false;
    }

    const platform = getPlatformService();
    const secretKey =
      syncStore.config.type === "webdav" ? "sync_webdav_password" : "sync_s3_secret_key";
    const password = await platform.kvGetItem(secretKey);
    if (!password) {
      toast.error(t("library.passwordNotFound", "未找到同步密码，请重新配置"));
      return false;
    }

    pendingDownloads.add(book.id);
    setBooks(
      books.map((item) => (item.id === book.id ? { ...item, syncStatus: "downloading" } : item)),
    );
    await setBookSyncStatus(book.id, "downloading");

    try {
      const backend = createSyncBackend(syncStore.config, password);
      const success = await downloadBookFile(backend, book.id, book.filePath);
      await loadBooks();

      if (!success) {
        toast.error(t("library.downloadFailed", "下载失败，请重试"));
        return false;
      }
    } catch (error) {
      console.error("[openDesktopBook] Failed to download remote book:", error);
      await setBookSyncStatus(book.id, "remote");
      await loadBooks();
      toast.error(t("library.downloadFailed", "下载失败，请重试"));
      return false;
    } finally {
      pendingDownloads.delete(book.id);
    }
  }

  const platform = getPlatformService();

  // A soft-deleted book is no longer in the live store — even if its file
  // still exists on disk we must re-import it first so it rejoins the store.
  const isSoftDeleted = !!book.deletedAt;

  // Check whether the local book file is accessible
  let fileAccessible = false;
  if (!isSoftDeleted && book.filePath) {
    const targetPath = isLikelyRelativeDesktopPath(book.filePath)
      ? await platform.joinPath(await platform.getAppDataDir(), book.filePath)
      : book.filePath;
    fileAccessible = await platform.exists(targetPath).catch(() => false);
  }

  if (!fileAccessible) {
    // File missing or never had one — prompt user to re-import
    const shouldReimport = await useMissingBookPromptStore.getState().showPrompt({
      title: t("reader.reimportPromptTitle", "书籍文件缺失"),
      description: t(
        "reader.reimportDialogDescriptionDesktop",
        "笔记和阅读记录都还在，重新导入即可继续。",
      ),
      confirmLabel: t("reader.reimportSelectFile", "重新导入"),
      cancelLabel: t("common.cancel", "取消"),
    });
    if (!shouldReimport) {
      return false;
    }

    const picked = await platform.pickFile({
      multiple: false,
      filters: BOOK_IMPORT_FILTERS,
    });
    const selectedPath = Array.isArray(picked) ? picked[0] : picked;
    if (!selectedPath) {
      return false;
    }

    const candidate = await inspectDeletedBookCandidate(book.id, selectedPath);
    if (candidate && shouldConfirmReimportCandidate(book, candidate)) {
      const shouldContinue = await useMissingBookPromptStore.getState().showPrompt({
        title: t("reader.reimportMismatchTitle", "这份文件看起来和原书不太一致"),
        description: t(
          "reader.reimportMismatchDescription",
          "原书《{{originalTitle}}》与当前文件《{{candidateTitle}}》信息差异较大。仍要把它接回原来的笔记和阅读统计吗？",
          {
            originalTitle: book.meta.title,
            candidateTitle: candidate.title || t("reader.unknownBook", "未命名书籍"),
          },
        ),
        confirmLabel: t("reader.reimportContinue", "继续接回"),
        cancelLabel: t("reader.reimportPickAnotherFile", "重新选择"),
      });
      if (!shouldContinue) {
        return false;
      }
    }

    const restoredBook = await reimportDeletedBook(book.id, selectedPath);
    if (!restoredBook) {
      toast.error(t("reader.reimportFailed", "重新导入失败，请稍后再试。"));
      return false;
    }

    toast.success(t("reader.reimportSuccess", "书籍已重新导入，笔记和阅读记录已恢复。"));
    openReaderTab(restoredBook, initialCfi);
    return true;
  }

  openReaderTab(book, initialCfi);
  return true;
}
