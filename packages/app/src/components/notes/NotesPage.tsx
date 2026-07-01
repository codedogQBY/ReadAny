import {
  KnowledgeEditor,
  type KnowledgeEditorOutlineTarget,
  type KnowledgeEditorValue,
  type KnowledgeImageInsertAttrs,
  type KnowledgeInternalLinkTarget,
  type KnowledgeSourceReferenceRequest,
} from "@/components/knowledge/KnowledgeEditor";
import { SyncButton } from "@/components/ui/SyncButton";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { useResolvedSrc, useSyncVersion } from "@/hooks/use-resolved-src";
import type { HighlightWithBook, KnowledgeBacklink } from "@/lib/db/database";
import {
  createKnowledgeDocument,
  deleteKnowledgeDocument,
  ensureBookHomeDocument,
  ensureHighlightNoteKnowledgeDocuments,
  ensureNoteKnowledgeDocuments,
  getBook as getBookRecord,
  getKnowledgeAttachments,
  getKnowledgeBacklinks,
  getKnowledgeCardTemplates,
  getKnowledgeDocument,
  getKnowledgeDocuments,
  getKnowledgeLinks,
  updateKnowledgeDocument,
  upsertKnowledgeCardTemplate,
} from "@/lib/db/database";
import { pickAndPersistKnowledgeImageAttachment } from "@/lib/knowledge/attachment-assets";
import { openDesktopBook } from "@/lib/library/open-book";
import { useAnnotationStore } from "@/stores/annotation-store";
import { useAppStore } from "@/stores/app-store";
import { useLibraryStore } from "@/stores/library-store";
import { useSettingsStore } from "@/stores/settings-store";
import {
  maybeCompressAndPersistKnowledgeSummary,
  maybeCompressKnowledgeDocumentsById,
} from "@readany/core/ai";
import {
  type ExportFormat,
  type KnowledgeExportFile,
  type KnowledgeExportFormat,
  type KnowledgeExportManifest,
  type KnowledgeExportObservedFile,
  type KnowledgeImportWriteProposal,
  type KnowledgeVaultImportPlan,
  type KnowledgeVaultImportResolution,
  annotationExporter,
  createObsidianSearchUri,
  createObsidianVaultFileOpenUri,
  createKnowledgeMarkdownImportPlan,
  createKnowledgeVaultImportPlan,
  createKnowledgeVaultImportWriteProposals,
  inferObsidianVaultNameFromPath,
  knowledgeExporter,
  scopeKnowledgeExportInputToDocumentSubtree,
} from "@readany/core/export";
import {
  type KnowledgeDocumentOutlineItem,
  type KnowledgeDocumentTreeNode,
  buildKnowledgeDocumentTree,
  canonicalizeKnowledgeAttachmentImageSources,
  createKnowledgeDocumentMoveTargets,
  createKnowledgeExcerpt,
  createKnowledgeFolderDisplaySections,
  createKnowledgeRootDisplaySections,
  createKnowledgeSummarySourceFingerprint,
  extractKnowledgeDocumentOutline,
  filterKnowledgeDocumentTreeNodesForSearch,
  flattenKnowledgeDocumentTree,
  getKnowledgeEditorSurfaceForDocumentType,
  getKnowledgeDocumentCreateParentId,
  getKnowledgeDocumentOpenMode,
  ensureKnowledgeSourceLink,
  knowledgeDocumentFingerprint,
  markdownToBasicTiptap,
  orderKnowledgeDocuments,
  renderKnowledgeJsonToMarkdown,
  resolveKnowledgeAttachmentImageSources,
  resolveKnowledgeDocumentPath,
  syncKnowledgeInternalDocumentLinks,
  validateKnowledgeDocumentParent,
  validateKnowledgeDocumentSiblingTitle,
} from "@readany/core/knowledge";
import {
  type KnowledgeDocumentUpdateProposal,
  applyKnowledgeWriteProposal,
} from "@readany/core/knowledge/proposals";
import { sortAnnotationsByPosition } from "@readany/core/reader";
import { getPlatformService } from "@readany/core/services";
import type {
  Book,
  Highlight,
  KnowledgeAttachment,
  KnowledgeDocument,
  KnowledgeDocumentType,
  KnowledgeLink,
  Note,
} from "@readany/core/types";
import { HIGHLIGHT_COLOR_HEX } from "@readany/core/types";
import { cn, providerRequiresApiKey } from "@readany/core/utils";
import { eventBus } from "@readany/core/utils/event-bus";
import {
  AlertTriangle,
  BookOpen,
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  Edit3,
  ExternalLink,
  FileText,
  Folder,
  FolderDown,
  FolderOpen,
  FolderUp,
  Highlighter,
  Link2,
  ListTree,
  NotebookPen,
  Plus,
  Save,
  Search,
  Sparkles,
  Tag,
  Trash2,
  X,
} from "lucide-react";
/**
 * NotesPage — book-centered knowledge vault workspace.
 * Legacy notes and highlights stay available, while knowledge documents use a
 * folder tree plus WYSIWYG writing canvas.
 */
import {
  type ImgHTMLAttributes,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import { ExportDropdown } from "./ExportDropdown";

type DetailTab = "knowledge" | "notes" | "highlights";
type CreatableKnowledgeDocumentType = Extract<
  KnowledgeDocumentType,
  "folder" | "standalone_note" | "review" | "summary"
>;

const KNOWLEDGE_SUMMARY_AUTOSAVE_MAINTENANCE_DELAY_MS = 45_000;

interface KnowledgeVaultConflictNotice {
  rootPath: string;
  paths: string[];
  kind: "external_modified" | "untracked_existing_file";
}

interface KnowledgeVaultImportReview {
  rootPath: string;
  plan: KnowledgeVaultImportPlan;
  proposals: KnowledgeDocumentUpdateProposal[];
}

function knowledgeVaultImportResolutionLabel(
  resolution: KnowledgeVaultImportResolution | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  if (!resolution) return null;
  return t(`notes.knowledgeVaultImportResolution.${resolution.kind}`);
}

async function openKnowledgeObsidianUri(
  uri: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): Promise<void> {
  const platform = getPlatformService();
  if (!platform.openExternalUrl) {
    toast.error(t("notes.knowledgeObsidianOpenUnavailable"));
    return;
  }

  try {
    await platform.openExternalUrl(uri);
  } catch (error) {
    toast.error(t("notes.knowledgeObsidianOpenFailed"));
    console.error("[Notes] Failed to open Obsidian URI:", error);
  }
}

interface KnowledgeMarkdownImportReviewItem {
  path: string;
  sourcePath: string;
  proposal: KnowledgeImportWriteProposal;
  warnings: string[];
}

interface KnowledgeMarkdownImportReview {
  items: KnowledgeMarkdownImportReviewItem[];
}

function createEmptyKnowledgeValue(): KnowledgeEditorValue {
  return {
    contentJson: { type: "doc", content: [] },
    contentMd: "",
    plainText: "",
  };
}

function normalizeKnowledgeTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

function canDeleteKnowledgeDocument(document: KnowledgeDocument): boolean {
  if (document.type === "book_home") return false;
  if (document.sourceKind === "highlight" || document.sourceKind === "note") return false;
  return true;
}

function knowledgeDocumentCreateTitle(
  type: CreatableKnowledgeDocumentType,
  count: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (type === "folder") return t("notes.knowledgeNewFolderTitle", { count });
  if (type === "review") return t("notes.knowledgeNewReviewTitle", { count });
  if (type === "summary") return t("notes.knowledgeNewSummaryTitle", { count });
  return t("notes.knowledgeNewNoteTitle", { count });
}

function sameKnowledgeParent(left?: string | null, right?: string | null): boolean {
  return (left || undefined) === (right || undefined);
}

function createUniqueKnowledgeDocumentCreateTitle(input: {
  type: CreatableKnowledgeDocumentType;
  bookId?: string;
  parentId?: string;
  documents: readonly KnowledgeDocument[];
  t: (key: string, options?: Record<string, unknown>) => string;
}): string {
  const baseCount =
    input.documents.filter(
      (document) =>
        document.type === input.type && sameKnowledgeParent(document.parentId, input.parentId),
    ).length + 1;

  for (let offset = 0; offset < 1000; offset += 1) {
    const title = knowledgeDocumentCreateTitle(input.type, baseCount + offset, input.t);
    const validation = validateKnowledgeDocumentSiblingTitle({
      bookId: input.bookId,
      parentId: input.parentId,
      title,
      documents: input.documents,
    });
    if (validation.ok) return title;
  }

  return knowledgeDocumentCreateTitle(input.type, baseCount, input.t);
}

function isEmptyTiptapDocument(content: KnowledgeDocument["contentJson"]): boolean {
  return (
    !!content &&
    typeof content === "object" &&
    !Array.isArray(content) &&
    content.type === "doc" &&
    (!Array.isArray(content.content) || content.content.length === 0)
  );
}

function createKnowledgeContentJsonFromDocument(
  document: KnowledgeDocument,
): KnowledgeDocument["contentJson"] {
  if (!!document.contentMd.trim() && isEmptyTiptapDocument(document.contentJson)) {
    return markdownToBasicTiptap(document.contentMd) as unknown as KnowledgeDocument["contentJson"];
  }
  return document.contentJson;
}

function createKnowledgeValueFromDocument(
  document: KnowledgeDocument,
  contentJsonOverride?: KnowledgeDocument["contentJson"],
): KnowledgeEditorValue {
  const contentJson = contentJsonOverride ?? createKnowledgeContentJsonFromDocument(document);
  const contentMd = document.contentMd || renderKnowledgeJsonToMarkdown(contentJson);

  return {
    contentJson,
    contentMd,
    plainText: createKnowledgeExcerpt(contentMd) ?? "",
  };
}

function resolveKnowledgeAttachmentDisplaySrc(attachment: KnowledgeAttachment): string | undefined {
  if (!attachment.localPath) return undefined;
  try {
    return getPlatformService().convertFileSrc(attachment.localPath);
  } catch (error) {
    console.warn("[Notes] Failed to resolve knowledge attachment image source:", error);
    return attachment.localPath;
  }
}

async function createResolvedKnowledgeValueFromDocument(
  document: KnowledgeDocument,
): Promise<KnowledgeEditorValue> {
  let attachments: KnowledgeAttachment[] = [];
  try {
    attachments = await getKnowledgeAttachments(document.id);
  } catch (error) {
    console.warn("[Notes] Failed to load knowledge attachments:", error);
    return createKnowledgeValueFromDocument(document);
  }
  if (attachments.length === 0) return createKnowledgeValueFromDocument(document);

  const displaySrcByAttachmentId = new Map<string, string>();
  for (const attachment of attachments) {
    if (attachment.kind !== "image") continue;
    const displaySrc = resolveKnowledgeAttachmentDisplaySrc(attachment);
    if (displaySrc) displaySrcByAttachmentId.set(attachment.id, displaySrc);
  }

  if (displaySrcByAttachmentId.size === 0) return createKnowledgeValueFromDocument(document);

  const contentJson = createKnowledgeContentJsonFromDocument(document);
  const resolvedContentJson = resolveKnowledgeAttachmentImageSources(contentJson, (attachmentId) =>
    displaySrcByAttachmentId.get(attachmentId),
  ) as KnowledgeDocument["contentJson"];

  return createKnowledgeValueFromDocument(document, resolvedContentJson);
}

function normalizeExportPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\/+/g, "/");
}

function exportFileDirectory(path: string): string | null {
  const normalized = normalizeExportPath(path);
  const index = normalized.lastIndexOf("/");
  return index > 0 ? normalized.slice(0, index) : null;
}

function uniqueExportPaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map(normalizeExportPath))).filter(Boolean);
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mediaQuery = window.matchMedia(query);
    setMatches(mediaQuery.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    mediaQuery.addEventListener("change", handleChange);
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, [query]);

  return matches;
}

function desktopFileName(path: string): string {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? path;
}

function knowledgeMarkdownImportWarningLabel(
  warning: string,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (warning === "frontmatter_not_readany") {
    return t("notes.knowledgeMarkdownImportWarningFrontmatterNotReadAny");
  }
  if (warning === "created_folder_from_import_path") {
    return t("notes.knowledgeMarkdownImportWarningCreatedFolder");
  }
  if (warning === "duplicate_sibling_title") {
    return t("notes.knowledgeMarkdownImportWarningDuplicateTitle");
  }
  return t("notes.knowledgeMarkdownImportWarningFallback", { warning });
}

async function joinDesktopPath(rootPath: string, relativePath: string): Promise<string> {
  const { join } = await import("@tauri-apps/api/path");
  const parts = normalizeExportPath(relativePath).split("/").filter(Boolean);
  return join(rootPath, ...parts);
}

function knowledgeVaultManifestPath(scopeDocument?: KnowledgeDocument | null): string {
  if (!scopeDocument) return ".readany/manifest.json";
  const safeDocumentId = scopeDocument.id.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `.readany/scopes/${safeDocumentId}.json`;
}

async function readKnowledgeVaultManifest(
  rootPath: string,
  manifestPath = ".readany/manifest.json",
): Promise<KnowledgeExportManifest | undefined> {
  const { exists, readTextFile } = await import("@tauri-apps/plugin-fs");
  const resolvedManifestPath = await joinDesktopPath(rootPath, manifestPath);
  if (!(await exists(resolvedManifestPath))) return undefined;

  const raw = await readTextFile(resolvedManifestPath);
  return JSON.parse(raw) as KnowledgeExportManifest;
}

async function collectKnowledgeVaultMarkdownPaths(rootPath: string): Promise<string[]> {
  const { exists, readDir } = await import("@tauri-apps/plugin-fs");

  const visit = async (relativeDir = ""): Promise<string[]> => {
    const directoryPath = relativeDir ? await joinDesktopPath(rootPath, relativeDir) : rootPath;
    if (!(await exists(directoryPath))) return [];

    let entries: Awaited<ReturnType<typeof readDir>>;
    try {
      entries = await readDir(directoryPath);
    } catch {
      return [];
    }

    const paths: string[] = [];
    for (const entry of entries) {
      if (!entry.name) continue;
      const relativePath = normalizeExportPath(
        relativeDir ? `${relativeDir}/${entry.name}` : entry.name,
      );
      if (entry.isDirectory) {
        if (entry.name === ".readany" || entry.name === ".git") continue;
        paths.push(...(await visit(relativePath)));
      } else if (entry.isFile && /\.md$/i.test(entry.name)) {
        paths.push(relativePath);
      }
    }
    return paths;
  };

  return uniqueExportPaths(await visit());
}

async function readExistingKnowledgeVaultFiles(
  rootPath: string,
  paths: string[],
  options: { includeMarkdownFiles?: boolean } = {},
): Promise<KnowledgeExportObservedFile[]> {
  const { exists, readTextFile } = await import("@tauri-apps/plugin-fs");
  const existingFiles: KnowledgeExportObservedFile[] = [];
  const pathsToRead = options.includeMarkdownFiles
    ? uniqueExportPaths([...paths, ...(await collectKnowledgeVaultMarkdownPaths(rootPath))])
    : uniqueExportPaths(paths);

  for (const path of pathsToRead) {
    const filePath = await joinDesktopPath(rootPath, path);
    if (!(await exists(filePath))) continue;
    try {
      existingFiles.push({
        path,
        content: await readTextFile(filePath),
      });
    } catch {
      existingFiles.push({ path });
    }
  }

  return existingFiles;
}

async function writeKnowledgeVaultFiles(
  rootPath: string,
  files: KnowledgeExportFile[],
): Promise<void> {
  const { copyFile, mkdir, writeTextFile } = await import("@tauri-apps/plugin-fs");

  for (const file of files) {
    const directory = exportFileDirectory(file.path);
    if (directory) {
      await mkdir(await joinDesktopPath(rootPath, directory), { recursive: true });
    }
    const targetPath = await joinDesktopPath(rootPath, file.path);
    if (file.sourcePath) {
      await copyFile(file.sourcePath, targetPath);
    } else {
      await writeTextFile(targetPath, file.content);
    }
  }
}

async function collectKnowledgeVaultInput(liveDocument: KnowledgeDocument, books: Book[]) {
  const documents = await getKnowledgeDocuments({ limit: 5000 });
  const documentMap = new Map(documents.map((document) => [document.id, document]));
  documentMap.set(liveDocument.id, liveDocument);
  const mergedDocuments = Array.from(documentMap.values());

  const [linksByDocument, attachmentsByDocument, cardTemplates] = await Promise.all([
    Promise.all(mergedDocuments.map((document) => getKnowledgeLinks(document.id))),
    Promise.all(mergedDocuments.map((document) => getKnowledgeAttachments(document.id))),
    getKnowledgeCardTemplates({ includeDisabled: true }),
  ]);

  return {
    documents: mergedDocuments,
    books,
    links: linksByDocument.flat(),
    attachments: attachmentsByDocument.flat(),
    cardTemplates,
  };
}

async function collectBookKnowledgeExportInput(
  bookId: string,
  liveDocument: KnowledgeDocument,
  book: Book,
) {
  const documents = await getKnowledgeDocuments({ bookId, limit: 500 });
  const documentMap = new Map(documents.map((document) => [document.id, document]));
  documentMap.set(liveDocument.id, liveDocument);
  const homeDocumentId = documents.find((document) => document.type === "book_home")?.id;
  const mergedDocuments = orderKnowledgeDocuments(Array.from(documentMap.values()), homeDocumentId);

  const [linksByDocument, attachmentsByDocument, cardTemplates] = await Promise.all([
    Promise.all(mergedDocuments.map((document) => getKnowledgeLinks(document.id))),
    Promise.all(mergedDocuments.map((document) => getKnowledgeAttachments(document.id))),
    getKnowledgeCardTemplates({ includeDisabled: true }),
  ]);

  return {
    documents: mergedDocuments,
    books: [book],
    links: linksByDocument.flat(),
    attachments: attachmentsByDocument.flat(),
    cardTemplates,
  };
}

// Helper component to resolve and display cover images
interface CoverImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  url: string | undefined | null;
  fallback?: ReactNode;
}

function CoverImage({ url, fallback, alt = "", ...imgProps }: CoverImageProps) {
  const resolvedSrc = useResolvedSrc(url ?? undefined);
  const syncVersion = useSyncVersion();
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const imageKey = resolvedSrc ? `${resolvedSrc}-${syncVersion}` : null;

  if (!resolvedSrc || imageKey === failedKey) {
    return <>{fallback}</>;
  }

  return (
    <img
      key={imageKey}
      src={resolvedSrc}
      onError={() => setFailedKey(imageKey)}
      {...imgProps}
      alt={alt}
    />
  );
}

export function NotesPage() {
  const { t } = useTranslation();
  const {
    highlightsWithBooks,
    loadAllHighlightsWithBooks,
    removeHighlight,
    updateHighlight,
    stats,
    loadStats,
  } = useAnnotationStore();
  const { activeTabId } = useAppStore();
  const books = useLibraryStore((s) => s.books);
  const aiConfig = useSettingsStore((s) => s.aiConfig);

  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [detailTab, setDetailTab] = useState<DetailTab>("knowledge");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editNote, setEditNote] = useState("");
  const [knowledgeHome, setKnowledgeHome] = useState<KnowledgeDocument | null>(null);
  const [knowledgeDocuments, setKnowledgeDocuments] = useState<KnowledgeDocument[]>([]);
  const [selectedKnowledgeDocumentId, setSelectedKnowledgeDocumentId] = useState<string | null>(
    null,
  );
  const [isKnowledgeVaultRootOpen, setIsKnowledgeVaultRootOpen] = useState(false);
  const [knowledgeTitle, setKnowledgeTitle] = useState("");
  const [knowledgeTags, setKnowledgeTags] = useState<string[]>([]);
  const [knowledgeValue, setKnowledgeValue] =
    useState<KnowledgeEditorValue>(createEmptyKnowledgeValue);
  const [knowledgeSourceReferenceRequest, setKnowledgeSourceReferenceRequest] =
    useState<KnowledgeSourceReferenceRequest | null>(null);
  const [savedKnowledgeFingerprint, setSavedKnowledgeFingerprint] = useState(
    knowledgeDocumentFingerprint("", createEmptyKnowledgeValue()),
  );
  const [knowledgeLinks, setKnowledgeLinks] = useState<KnowledgeLink[]>([]);
  const [knowledgeBacklinks, setKnowledgeBacklinks] = useState<KnowledgeBacklink[]>([]);
  const [isKnowledgeRelationsLoading, setIsKnowledgeRelationsLoading] = useState(false);
  const [isKnowledgeLoading, setIsKnowledgeLoading] = useState(false);
  const [isKnowledgeSaving, setIsKnowledgeSaving] = useState(false);
  const [isKnowledgeSummaryCompressing, setIsKnowledgeSummaryCompressing] = useState(false);
  const [isKnowledgeDocumentCreating, setIsKnowledgeDocumentCreating] = useState(false);
  const [isKnowledgeMarkdownImporting, setIsKnowledgeMarkdownImporting] = useState(false);
  const [isKnowledgeMarkdownImportApplying, setIsKnowledgeMarkdownImportApplying] = useState(false);
  const [isKnowledgeVaultExporting, setIsKnowledgeVaultExporting] = useState(false);
  const [isKnowledgeVaultImporting, setIsKnowledgeVaultImporting] = useState(false);
  const [isKnowledgeVaultImportApplying, setIsKnowledgeVaultImportApplying] = useState(false);
  const [knowledgeVaultConflicts, setKnowledgeVaultConflicts] =
    useState<KnowledgeVaultConflictNotice | null>(null);
  const [knowledgeMarkdownImportReview, setKnowledgeMarkdownImportReview] =
    useState<KnowledgeMarkdownImportReview | null>(null);
  const [knowledgeVaultImportReview, setKnowledgeVaultImportReview] =
    useState<KnowledgeVaultImportReview | null>(null);
  const knowledgeSaveVersionRef = useRef(0);
  const knowledgeSourceReferenceRequestIdRef = useRef(0);
  const knowledgeSummaryMaintenanceTimersRef = useRef<Map<string, number>>(new Map());
  const knowledgeSummaryMaintenanceFingerprintsRef = useRef<Map<string, string>>(new Map());
  const currentKnowledgeFingerprint = useMemo(
    () => knowledgeDocumentFingerprint(knowledgeTitle, knowledgeValue, knowledgeTags),
    [knowledgeTitle, knowledgeTags, knowledgeValue],
  );
  const knowledgeDocumentIds = useMemo(
    () => knowledgeDocuments.map((document) => document.id),
    [knowledgeDocuments],
  );
  const knowledgeFolderCount = useMemo(
    () => knowledgeDocuments.filter((document) => document.type === "folder").length,
    [knowledgeDocuments],
  );

  useEffect(() => {
    const timers = knowledgeSummaryMaintenanceTimersRef.current;
    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (activeTabId !== "notes") return;
    setIsLoading(true);
    Promise.all([loadAllHighlightsWithBooks(500), loadStats()]).finally(() => setIsLoading(false));
  }, [loadAllHighlightsWithBooks, loadStats, activeTabId]);

  useEffect(() => {
    return eventBus.on("sync:completed", () => {
      if (activeTabId !== "notes") return;
      setIsLoading(true);
      Promise.all([loadAllHighlightsWithBooks(500), loadStats()]).finally(() =>
        setIsLoading(false),
      );
    });
  }, [activeTabId, loadAllHighlightsWithBooks, loadStats]);

  // Group highlights by book, but keep every library book available as a knowledge workspace.
  const bookNotebooks = useMemo(() => {
    const grouped = new Map<
      string,
      {
        bookId: string;
        title: string;
        author: string;
        coverUrl: string | null;
        highlights: HighlightWithBook[];
        notesCount: number;
        highlightsOnlyCount: number;
        latestAt: number;
      }
    >();

    for (const book of books) {
      if (book.deletedAt) continue;
      grouped.set(book.id, {
        bookId: book.id,
        title: book.meta.title || t("notes.unknownBook"),
        author: book.meta.author || t("notes.unknownAuthor"),
        coverUrl: book.meta.coverUrl || null,
        highlights: [],
        notesCount: 0,
        highlightsOnlyCount: 0,
        latestAt: book.lastOpenedAt || book.updatedAt || book.addedAt,
      });
    }

    for (const h of highlightsWithBooks) {
      const existing = grouped.get(h.bookId);
      if (existing) {
        existing.highlights.push(h);
        if (h.note) existing.notesCount++;
        else existing.highlightsOnlyCount++;
        if (h.updatedAt > existing.latestAt) existing.latestAt = h.updatedAt;
      } else {
        grouped.set(h.bookId, {
          bookId: h.bookId,
          title: h.bookTitle || t("notes.unknownBook"),
          author: h.bookAuthor || t("notes.unknownAuthor"),
          coverUrl: h.bookCoverUrl || null,
          highlights: [h],
          notesCount: h.note ? 1 : 0,
          highlightsOnlyCount: h.note ? 0 : 1,
          latestAt: h.createdAt,
        });
      }
    }

    return Array.from(grouped.values()).sort((a, b) => b.latestAt - a.latestAt);
  }, [books, highlightsWithBooks, t]);

  const selectedBook = useMemo(() => {
    if (!selectedBookId) return null;
    return bookNotebooks.find((b) => b.bookId === selectedBookId) || null;
  }, [selectedBookId, bookNotebooks]);
  const selectedKnowledgeBookId = selectedBook?.bookId ?? null;
  const selectedKnowledgeBookTitle = selectedBook?.title ?? "";
  const activeKnowledgeDocumentId = knowledgeHome?.id ?? null;

  useEffect(() => {
    if (!selectedBookId) return;
    if (bookNotebooks.some((book) => book.bookId === selectedBookId)) return;

    setSelectedBookId(null);
    setDetailTab("knowledge");
    setSearchQuery("");
    setEditingId(null);
    setIsKnowledgeVaultRootOpen(false);
  }, [bookNotebooks, selectedBookId]);

  // Split into notes (has note text) and highlights-only
  const { notes, highlightsOnly } = useMemo(() => {
    if (!selectedBook) return { notes: [], highlightsOnly: [] };
    let all = selectedBook.highlights;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      all = all.filter(
        (h) =>
          h.text.toLowerCase().includes(q) ||
          h.note?.toLowerCase().includes(q) ||
          h.chapterTitle?.toLowerCase().includes(q),
      );
    }
    const sorted = sortAnnotationsByPosition(all);
    return {
      notes: sorted.filter((h) => h.note),
      highlightsOnly: sorted.filter((h) => !h.note),
    };
  }, [selectedBook, searchQuery]);

  const currentList =
    detailTab === "notes" ? notes : detailTab === "highlights" ? highlightsOnly : [];

  // Group by chapter
  const itemsByChapter = useMemo(() => {
    const chapters = new Map<string, HighlightWithBook[]>();
    for (const h of currentList) {
      const chapter = h.chapterTitle || t("notes.unknownChapter");
      const arr = chapters.get(chapter) || [];
      arr.push(h);
      chapters.set(chapter, arr);
    }
    return chapters;
  }, [currentList, t]);

  useEffect(() => {
    let cancelled = false;

    async function loadKnowledgeHome() {
      knowledgeSaveVersionRef.current += 1;

      if (!selectedKnowledgeBookId) {
        setKnowledgeHome(null);
        setKnowledgeDocuments([]);
        setSelectedKnowledgeDocumentId(null);
        setIsKnowledgeVaultRootOpen(false);
        setKnowledgeTitle("");
        setKnowledgeTags([]);
        const emptyValue = createEmptyKnowledgeValue();
        setKnowledgeValue(emptyValue);
        setKnowledgeSourceReferenceRequest(null);
        setSavedKnowledgeFingerprint(knowledgeDocumentFingerprint("", emptyValue));
        setIsKnowledgeSaving(false);
        setKnowledgeLinks([]);
        setKnowledgeBacklinks([]);
        return;
      }

      setIsKnowledgeLoading(true);
      setIsKnowledgeSaving(false);
      try {
        const homeDocument = await ensureBookHomeDocument(
          selectedKnowledgeBookId,
          selectedKnowledgeBookTitle,
        );
        await Promise.all([
          ensureHighlightNoteKnowledgeDocuments(selectedKnowledgeBookId),
          ensureNoteKnowledgeDocuments(selectedKnowledgeBookId),
        ]);
        const bookDocuments = await getKnowledgeDocuments({
          bookId: selectedKnowledgeBookId,
          limit: 200,
        });
        if (cancelled) return;
        const nextDocuments = orderKnowledgeDocuments(
          [homeDocument, ...bookDocuments],
          homeDocument.id,
        );
        const activeDocument = nextDocuments[0] ?? homeDocument;
        const nextValue = await createResolvedKnowledgeValueFromDocument(activeDocument);
        setKnowledgeDocuments(nextDocuments);
        setSelectedKnowledgeDocumentId(activeDocument.id);
        setIsKnowledgeVaultRootOpen(false);
        setKnowledgeHome(activeDocument);
        setKnowledgeTitle(activeDocument.title);
        setKnowledgeTags(normalizeKnowledgeTags(activeDocument.tags));
        setKnowledgeValue(nextValue);
        setKnowledgeSourceReferenceRequest(null);
        setSavedKnowledgeFingerprint(
          knowledgeDocumentFingerprint(activeDocument.title, nextValue, activeDocument.tags),
        );
      } catch (error) {
        console.error("[Notes] Failed to load knowledge home:", error);
        toast.error(t("notes.knowledgeLoadFailed"));
      } finally {
        if (!cancelled) setIsKnowledgeLoading(false);
      }
    }

    void loadKnowledgeHome();

    return () => {
      cancelled = true;
    };
  }, [selectedKnowledgeBookId, selectedKnowledgeBookTitle, t]);

  useEffect(() => {
    let cancelled = false;

    async function loadKnowledgeRelations() {
      if (!activeKnowledgeDocumentId) {
        setKnowledgeLinks([]);
        setKnowledgeBacklinks([]);
        setIsKnowledgeRelationsLoading(false);
        return;
      }

      setIsKnowledgeRelationsLoading(true);
      try {
        const [links, backlinks] = await Promise.all([
          getKnowledgeLinks(activeKnowledgeDocumentId),
          getKnowledgeBacklinks(activeKnowledgeDocumentId),
        ]);
        if (cancelled) return;
        setKnowledgeLinks(links);
        setKnowledgeBacklinks(backlinks);
      } catch (error) {
        if (cancelled) return;
        console.error("[Notes] Failed to load knowledge relations:", error);
        setKnowledgeLinks([]);
        setKnowledgeBacklinks([]);
      } finally {
        if (!cancelled) setIsKnowledgeRelationsLoading(false);
      }
    }

    void loadKnowledgeRelations();

    return () => {
      cancelled = true;
    };
  }, [activeKnowledgeDocumentId]);

  useEffect(() => {
    if (!knowledgeHome || currentKnowledgeFingerprint === savedKnowledgeFingerprint) return;

    const saveVersion = knowledgeSaveVersionRef.current + 1;
    knowledgeSaveVersionRef.current = saveVersion;
    const normalizedTitle = knowledgeTitle.trim() || knowledgeHome.title;
    const normalizedTags = normalizeKnowledgeTags(knowledgeTags);
    const nextExcerpt = createKnowledgeExcerpt(knowledgeValue.contentMd);
    const contentJsonForStorage = canonicalizeKnowledgeAttachmentImageSources(
      knowledgeValue.contentJson,
    ) as KnowledgeDocument["contentJson"];
    const titleValidation = validateKnowledgeDocumentSiblingTitle({
      documentId: knowledgeHome.id,
      bookId: knowledgeHome.bookId,
      parentId: knowledgeHome.parentId,
      title: normalizedTitle,
      documents: knowledgeDocuments,
    });
    if (!titleValidation.ok) {
      setIsKnowledgeSaving(false);
      toast.error(t("notes.knowledgeDocumentTitleDuplicate"));
      return;
    }

    const timeout = window.setTimeout(async () => {
      if (knowledgeSaveVersionRef.current !== saveVersion) return;
      setIsKnowledgeSaving(true);
      try {
        await updateKnowledgeDocument(knowledgeHome.id, {
          title: normalizedTitle,
          contentMd: knowledgeValue.contentMd,
          contentJson: contentJsonForStorage,
          excerpt: nextExcerpt,
          tags: normalizedTags,
        });
        if (knowledgeSaveVersionRef.current !== saveVersion) return;
        const linkSync = await syncKnowledgeInternalDocumentLinks({
          documentId: knowledgeHome.id,
          contentJson: contentJsonForStorage,
          validDocumentIds: knowledgeDocumentIds,
        });
        if (knowledgeSaveVersionRef.current !== saveVersion) return;
        if (linkSync.added > 0 || linkSync.deleted > 0) {
          const [links, backlinks] = await Promise.all([
            getKnowledgeLinks(knowledgeHome.id),
            getKnowledgeBacklinks(knowledgeHome.id),
          ]);
          if (knowledgeSaveVersionRef.current !== saveVersion) return;
          setKnowledgeLinks(links);
          setKnowledgeBacklinks(backlinks);
        }
        const updatedDocument: KnowledgeDocument = {
          ...knowledgeHome,
          title: normalizedTitle,
          contentMd: knowledgeValue.contentMd,
          contentJson: contentJsonForStorage,
          excerpt: nextExcerpt,
          tags: normalizedTags,
          updatedAt: Date.now(),
        };
        setKnowledgeHome(updatedDocument);
        setKnowledgeDocuments((documents) =>
          orderKnowledgeDocuments(
            documents.map((document) =>
              document.id === updatedDocument.id ? updatedDocument : document,
            ),
            documents.find((document) => document.type === "book_home")?.id,
          ),
        );
        if (normalizedTitle !== knowledgeTitle) setKnowledgeTitle(normalizedTitle);
        if (normalizedTags.join("\u0000") !== knowledgeTags.join("\u0000")) {
          setKnowledgeTags(normalizedTags);
        }
        setSavedKnowledgeFingerprint(
          knowledgeDocumentFingerprint(normalizedTitle, knowledgeValue, normalizedTags),
        );
      } catch (error) {
        if (knowledgeSaveVersionRef.current !== saveVersion) return;
        console.error("[Notes] Failed to save knowledge home:", error);
        toast.error(t("notes.knowledgeSaveFailed"));
      } finally {
        if (knowledgeSaveVersionRef.current === saveVersion) {
          setIsKnowledgeSaving(false);
        }
      }
    }, 700);

    return () => window.clearTimeout(timeout);
  }, [
    knowledgeHome,
    knowledgeTitle,
    knowledgeTags,
    knowledgeValue,
    knowledgeDocuments,
    knowledgeDocumentIds,
    currentKnowledgeFingerprint,
    savedKnowledgeFingerprint,
    t,
  ]);

  const saveActiveKnowledgeDocumentNow = async (): Promise<boolean> => {
    if (!knowledgeHome || currentKnowledgeFingerprint === savedKnowledgeFingerprint) return true;

    const saveVersion = knowledgeSaveVersionRef.current + 1;
    knowledgeSaveVersionRef.current = saveVersion;
    const normalizedTitle = knowledgeTitle.trim() || knowledgeHome.title;
    const normalizedTags = normalizeKnowledgeTags(knowledgeTags);
    const nextExcerpt = createKnowledgeExcerpt(knowledgeValue.contentMd);
    const contentJsonForStorage = canonicalizeKnowledgeAttachmentImageSources(
      knowledgeValue.contentJson,
    ) as KnowledgeDocument["contentJson"];
    const titleValidation = validateKnowledgeDocumentSiblingTitle({
      documentId: knowledgeHome.id,
      bookId: knowledgeHome.bookId,
      parentId: knowledgeHome.parentId,
      title: normalizedTitle,
      documents: knowledgeDocuments,
    });
    if (!titleValidation.ok) {
      setIsKnowledgeSaving(false);
      toast.error(t("notes.knowledgeDocumentTitleDuplicate"));
      return false;
    }

    setIsKnowledgeSaving(true);
    try {
      await updateKnowledgeDocument(knowledgeHome.id, {
        title: normalizedTitle,
        contentMd: knowledgeValue.contentMd,
        contentJson: contentJsonForStorage,
        excerpt: nextExcerpt,
        tags: normalizedTags,
      });
      if (knowledgeSaveVersionRef.current !== saveVersion) return false;
      const linkSync = await syncKnowledgeInternalDocumentLinks({
        documentId: knowledgeHome.id,
        contentJson: contentJsonForStorage,
        validDocumentIds: knowledgeDocumentIds,
      });
      if (knowledgeSaveVersionRef.current !== saveVersion) return false;
      if (linkSync.added > 0 || linkSync.deleted > 0) {
        const [links, backlinks] = await Promise.all([
          getKnowledgeLinks(knowledgeHome.id),
          getKnowledgeBacklinks(knowledgeHome.id),
        ]);
        if (knowledgeSaveVersionRef.current !== saveVersion) return false;
        setKnowledgeLinks(links);
        setKnowledgeBacklinks(backlinks);
      }
      const updatedDocument: KnowledgeDocument = {
        ...knowledgeHome,
        title: normalizedTitle,
        contentMd: knowledgeValue.contentMd,
        contentJson: contentJsonForStorage,
        excerpt: nextExcerpt,
        tags: normalizedTags,
        updatedAt: Date.now(),
      };
      setKnowledgeHome(updatedDocument);
      setKnowledgeDocuments((documents) =>
        orderKnowledgeDocuments(
          documents.map((document) =>
            document.id === updatedDocument.id ? updatedDocument : document,
          ),
          documents.find((document) => document.type === "book_home")?.id,
        ),
      );
      if (normalizedTitle !== knowledgeTitle) setKnowledgeTitle(normalizedTitle);
      if (normalizedTags.join("\u0000") !== knowledgeTags.join("\u0000")) {
        setKnowledgeTags(normalizedTags);
      }
      setSavedKnowledgeFingerprint(
        knowledgeDocumentFingerprint(normalizedTitle, knowledgeValue, normalizedTags),
      );
      return true;
    } catch (error) {
      if (knowledgeSaveVersionRef.current === saveVersion) {
        console.error("[Notes] Failed to save knowledge document:", error);
        toast.error(t("notes.knowledgeSaveFailed"));
      }
      return false;
    } finally {
      if (knowledgeSaveVersionRef.current === saveVersion) {
        setIsKnowledgeSaving(false);
      }
    }
  };

  const openKnowledgeDocument = async (document: KnowledgeDocument): Promise<boolean> => {
    if (document.id === knowledgeHome?.id) {
      setSelectedKnowledgeDocumentId(document.id);
      setIsKnowledgeVaultRootOpen(false);
      return true;
    }
    const saved = await saveActiveKnowledgeDocumentNow();
    if (!saved) return false;

    knowledgeSaveVersionRef.current += 1;
    const nextValue = await createResolvedKnowledgeValueFromDocument(document);
    setSelectedKnowledgeDocumentId(document.id);
    setIsKnowledgeVaultRootOpen(false);
    setKnowledgeHome(document);
    setKnowledgeTitle(document.title);
    setKnowledgeTags(normalizeKnowledgeTags(document.tags));
    setKnowledgeValue(nextValue);
    setKnowledgeSourceReferenceRequest(null);
    setSavedKnowledgeFingerprint(
      knowledgeDocumentFingerprint(document.title, nextValue, document.tags),
    );
    setIsKnowledgeSaving(false);
    return true;
  };

  const openKnowledgeVaultRoot = async (): Promise<boolean> => {
    if (isKnowledgeVaultRootOpen) return true;
    const saved = await saveActiveKnowledgeDocumentNow();
    if (!saved) return false;
    setSelectedKnowledgeDocumentId(null);
    setIsKnowledgeVaultRootOpen(true);
    setKnowledgeSourceReferenceRequest(null);
    return true;
  };

  const refreshSelectedKnowledgeDocuments = useCallback(
    async (
      preferredDocumentId?: string | null,
      options: { keepVaultRootOpen?: boolean } = {},
    ) => {
      if (!selectedKnowledgeBookId) return;

      const homeDocument = await ensureBookHomeDocument(
        selectedKnowledgeBookId,
        selectedKnowledgeBookTitle,
      );
      await Promise.all([
        ensureHighlightNoteKnowledgeDocuments(selectedKnowledgeBookId),
        ensureNoteKnowledgeDocuments(selectedKnowledgeBookId),
      ]);
      const bookDocuments = await getKnowledgeDocuments({
        bookId: selectedKnowledgeBookId,
        limit: 200,
      });
      const documentsById = new Map<string, KnowledgeDocument>();
      for (const document of [homeDocument, ...bookDocuments]) {
        documentsById.set(document.id, document);
      }
      const nextDocuments = orderKnowledgeDocuments(
        Array.from(documentsById.values()),
        homeDocument.id,
      );
      const nextActiveDocument =
        nextDocuments.find((document) => document.id === preferredDocumentId) ??
        nextDocuments.find((document) => document.id === knowledgeHome?.id) ??
        nextDocuments[0] ??
        null;

      knowledgeSaveVersionRef.current += 1;
      setKnowledgeDocuments(nextDocuments);

      if (!nextActiveDocument) {
        setSelectedKnowledgeDocumentId(null);
        setIsKnowledgeVaultRootOpen(Boolean(options.keepVaultRootOpen));
        setKnowledgeHome(null);
        setKnowledgeTitle("");
        setKnowledgeTags([]);
        const emptyValue = createEmptyKnowledgeValue();
        setKnowledgeValue(emptyValue);
        setKnowledgeSourceReferenceRequest(null);
        setSavedKnowledgeFingerprint(knowledgeDocumentFingerprint("", emptyValue));
        setIsKnowledgeSaving(false);
        return;
      }

      const nextValue = await createResolvedKnowledgeValueFromDocument(nextActiveDocument);
      setSelectedKnowledgeDocumentId(options.keepVaultRootOpen ? null : nextActiveDocument.id);
      setIsKnowledgeVaultRootOpen(Boolean(options.keepVaultRootOpen));
      setKnowledgeHome(nextActiveDocument);
      setKnowledgeTitle(nextActiveDocument.title);
      setKnowledgeTags(normalizeKnowledgeTags(nextActiveDocument.tags));
      setKnowledgeValue(nextValue);
      setKnowledgeSourceReferenceRequest(null);
      setSavedKnowledgeFingerprint(
        knowledgeDocumentFingerprint(nextActiveDocument.title, nextValue, nextActiveDocument.tags),
      );
      setIsKnowledgeSaving(false);
    },
    [knowledgeHome?.id, selectedKnowledgeBookId, selectedKnowledgeBookTitle],
  );

  useEffect(() => {
    return eventBus.on("knowledge:changed", (event) => {
      if (activeTabId !== "notes") return;
      if (!selectedKnowledgeBookId) return;
      if (event.bookId && event.bookId !== selectedKnowledgeBookId) return;

      void (async () => {
        try {
          const preferredDocumentId =
            event.action === "create" ? event.documentId : selectedKnowledgeDocumentId;
          await refreshSelectedKnowledgeDocuments(preferredDocumentId);
          if (event.action === "link" && event.documentId === activeKnowledgeDocumentId) {
            const [links, backlinks] = await Promise.all([
              getKnowledgeLinks(activeKnowledgeDocumentId),
              getKnowledgeBacklinks(activeKnowledgeDocumentId),
            ]);
            setKnowledgeLinks(links);
            setKnowledgeBacklinks(backlinks);
          }
        } catch (error) {
          console.error("[Notes] Failed to refresh knowledge after proposal apply:", error);
        }
      })();
    });
  }, [
    activeKnowledgeDocumentId,
    activeTabId,
    selectedKnowledgeBookId,
    selectedKnowledgeDocumentId,
    refreshSelectedKnowledgeDocuments,
  ]);

  useEffect(() => {
    return eventBus.on("knowledge:open-document", (event) => {
      if (activeTabId !== "notes" || !selectedKnowledgeBookId) {
        event.respond?.(false);
        return;
      }
      if (event.bookId && event.bookId !== selectedKnowledgeBookId) {
        event.respond?.(false);
        return;
      }
      const localDocument = knowledgeDocuments.find((document) => document.id === event.documentId);
      if (!localDocument && event.bookId !== selectedKnowledgeBookId) {
        event.respond?.(false);
        return;
      }
      event.respond?.(true);

      void (async () => {
        try {
          const targetDocument = localDocument ?? (await getKnowledgeDocument(event.documentId));
          if (!targetDocument || targetDocument.bookId !== selectedKnowledgeBookId) {
            return;
          }

          setDetailTab("knowledge");
          if (localDocument) {
            await openKnowledgeDocument(localDocument);
          } else {
            await refreshSelectedKnowledgeDocuments(event.documentId);
          }
        } catch (error) {
          console.error("[Notes] Failed to open knowledge document from event:", error);
        }
      })();
    });
  }, [
    activeTabId,
    knowledgeDocuments,
    openKnowledgeDocument,
    refreshSelectedKnowledgeDocuments,
    selectedKnowledgeBookId,
  ]);

  useEffect(() => {
    return eventBus.on("sync:completed", () => {
      if (activeTabId !== "notes") return;
      if (!selectedKnowledgeBookId) return;

      void (async () => {
        try {
          const saved = await saveActiveKnowledgeDocumentNow();
          if (!saved) return;
          await refreshSelectedKnowledgeDocuments(selectedKnowledgeDocumentId, {
            keepVaultRootOpen: isKnowledgeVaultRootOpen,
          });
        } catch (error) {
          console.error("[Notes] Failed to refresh knowledge after sync:", error);
        }
      })();
    });
  }, [
    activeTabId,
    isKnowledgeVaultRootOpen,
    selectedKnowledgeBookId,
    selectedKnowledgeDocumentId,
    refreshSelectedKnowledgeDocuments,
    saveActiveKnowledgeDocumentNow,
  ]);

  const handleCreateKnowledgeDocument = async (
    type: CreatableKnowledgeDocumentType = "standalone_note",
    parentId?: string,
  ) => {
    if (!selectedKnowledgeBookId || isKnowledgeDocumentCreating) return;
    const saved = await saveActiveKnowledgeDocumentNow();
    if (!saved) return;

    setIsKnowledgeDocumentCreating(true);
    try {
      const title = createUniqueKnowledgeDocumentCreateTitle({
        type,
        bookId: selectedKnowledgeBookId,
        parentId,
        documents: knowledgeDocuments,
        t,
      });
      const document = await createKnowledgeDocument({
        bookId: selectedKnowledgeBookId,
        parentId,
        type,
        title,
        contentJson: createEmptyKnowledgeValue().contentJson,
        contentMd: "",
        excerpt: undefined,
        tags: [],
        sourceKind: "book",
        sourceId: selectedKnowledgeBookId,
      });
      const nextValue = createKnowledgeValueFromDocument(document);
      setKnowledgeDocuments((documents) =>
        orderKnowledgeDocuments(
          [document, ...documents],
          documents.find((item) => item.type === "book_home")?.id,
        ),
      );
      setSelectedKnowledgeDocumentId(document.id);
      setIsKnowledgeVaultRootOpen(false);
      setKnowledgeHome(document);
      setKnowledgeTitle(document.title);
      setKnowledgeTags([]);
      setKnowledgeValue(nextValue);
      setKnowledgeSourceReferenceRequest(null);
      setSavedKnowledgeFingerprint(knowledgeDocumentFingerprint(document.title, nextValue, []));
      toast.success(t("notes.knowledgeDocumentCreated"));
    } catch (error) {
      console.error("[Notes] Failed to create knowledge document:", error);
      toast.error(t("notes.knowledgeDocumentCreateFailed"));
    } finally {
      setIsKnowledgeDocumentCreating(false);
    }
  };

  const handleDeleteKnowledgeDocument = async (document: KnowledgeDocument) => {
    if (!canDeleteKnowledgeDocument(document)) {
      toast.error(t("notes.knowledgeDocumentDeleteBlocked"));
      return;
    }
    if (
      document.type === "folder" &&
      knowledgeDocuments.some((item) => item.parentId === document.id)
    ) {
      toast.error(t("notes.knowledgeFolderDeleteBlocked"));
      return;
    }

    if (!window.confirm(t("notes.knowledgeDocumentDeleteConfirm", { title: document.title }))) {
      return;
    }

    const isDeletingActiveDocument = document.id === knowledgeHome?.id;
    if (isDeletingActiveDocument) {
      knowledgeSaveVersionRef.current += 1;
    }

    try {
      await deleteKnowledgeDocument(document.id);
      const remainingDocuments = orderKnowledgeDocuments(
        knowledgeDocuments.filter((item) => item.id !== document.id),
        knowledgeDocuments.find((item) => item.type === "book_home")?.id,
      );
      setKnowledgeDocuments(remainingDocuments);

      if (isDeletingActiveDocument) {
        const nextDocument =
          remainingDocuments.find((item) => item.type === "book_home") ??
          remainingDocuments[0] ??
          null;
        if (nextDocument) {
          const nextValue = await createResolvedKnowledgeValueFromDocument(nextDocument);
          setSelectedKnowledgeDocumentId(nextDocument.id);
          setIsKnowledgeVaultRootOpen(false);
          setKnowledgeHome(nextDocument);
          setKnowledgeTitle(nextDocument.title);
          setKnowledgeTags(normalizeKnowledgeTags(nextDocument.tags));
          setKnowledgeValue(nextValue);
          setKnowledgeSourceReferenceRequest(null);
          setSavedKnowledgeFingerprint(
            knowledgeDocumentFingerprint(nextDocument.title, nextValue, nextDocument.tags),
          );
        } else {
          setSelectedKnowledgeDocumentId(null);
          setIsKnowledgeVaultRootOpen(false);
          setKnowledgeHome(null);
          setKnowledgeTitle("");
          setKnowledgeTags([]);
          const emptyValue = createEmptyKnowledgeValue();
          setKnowledgeValue(emptyValue);
          setKnowledgeSourceReferenceRequest(null);
          setSavedKnowledgeFingerprint(knowledgeDocumentFingerprint("", emptyValue));
        }
        setIsKnowledgeSaving(false);
      } else if (selectedKnowledgeDocumentId === document.id) {
        setSelectedKnowledgeDocumentId(knowledgeHome?.id ?? null);
      }

      toast.success(t("notes.knowledgeDocumentDeleted"));
    } catch (error) {
      console.error("[Notes] Failed to delete knowledge document:", error);
      toast.error(t("notes.knowledgeDocumentDeleteFailed"));
    }
  };

  const handleMoveKnowledgeDocument = async (
    document: KnowledgeDocument,
    parentId?: string | null,
  ) => {
    const validation = validateKnowledgeDocumentParent(document.id, parentId, knowledgeDocuments);
    if (!validation.ok) {
      if (validation.reason !== "same_parent") {
        toast.error(t("notes.knowledgeDocumentMoveInvalid"));
      }
      return;
    }
    const nextParentId = parentId || undefined;
    const nextTitle =
      knowledgeHome?.id === document.id ? knowledgeTitle.trim() || document.title : document.title;
    const titleValidation = validateKnowledgeDocumentSiblingTitle({
      documentId: document.id,
      bookId: document.bookId,
      parentId: nextParentId,
      title: nextTitle,
      documents: knowledgeDocuments,
    });
    if (!titleValidation.ok) {
      toast.error(t("notes.knowledgeDocumentTitleDuplicate"));
      return;
    }

    const saved = await saveActiveKnowledgeDocumentNow();
    if (!saved) return;

    try {
      await updateKnowledgeDocument(document.id, { parentId: nextParentId });
      const isMovingActiveDocument = knowledgeHome?.id === document.id;
      const updatedAt = Date.now();
      const updatedDocument: KnowledgeDocument = isMovingActiveDocument
        ? {
            ...knowledgeHome,
            title: nextTitle,
            contentMd: knowledgeValue.contentMd,
            contentJson: canonicalizeKnowledgeAttachmentImageSources(
              knowledgeValue.contentJson,
            ) as KnowledgeDocument["contentJson"],
            excerpt: createKnowledgeExcerpt(knowledgeValue.contentMd),
            tags: normalizeKnowledgeTags(knowledgeTags),
            parentId: nextParentId,
            updatedAt,
          }
        : {
            ...document,
            parentId: nextParentId,
            updatedAt,
          };
      setKnowledgeDocuments((documents) =>
        orderKnowledgeDocuments(
          documents.map((item) => (item.id === document.id ? updatedDocument : item)),
          documents.find((item) => item.type === "book_home")?.id,
        ),
      );
      if (isMovingActiveDocument) {
        setKnowledgeHome(updatedDocument);
      }
      toast.success(t("notes.knowledgeDocumentMoved"));
    } catch (error) {
      console.error("[Notes] Failed to move knowledge document:", error);
      toast.error(t("notes.knowledgeDocumentMoveFailed"));
    }
  };

  const handleRenameKnowledgeDocument = async (document: KnowledgeDocument, title: string) => {
    const normalizedTitle = title.trim();
    if (!normalizedTitle || normalizedTitle === document.title.trim()) return;

    const titleValidation = validateKnowledgeDocumentSiblingTitle({
      documentId: document.id,
      bookId: document.bookId,
      parentId: document.parentId,
      title: normalizedTitle,
      documents: knowledgeDocuments,
    });
    if (!titleValidation.ok) {
      toast.error(t("notes.knowledgeDocumentTitleDuplicate"));
      return;
    }

    const saved = await saveActiveKnowledgeDocumentNow();
    if (!saved) return;

    try {
      await updateKnowledgeDocument(document.id, { title: normalizedTitle });
      const updatedAt = Date.now();
      setKnowledgeDocuments((documents) =>
        orderKnowledgeDocuments(
          documents.map((item) =>
            item.id === document.id ? { ...item, title: normalizedTitle, updatedAt } : item,
          ),
          documents.find((item) => item.type === "book_home")?.id,
        ),
      );

      if (knowledgeHome?.id === document.id) {
        const updatedDocument = { ...knowledgeHome, title: normalizedTitle, updatedAt };
        setKnowledgeHome(updatedDocument);
        setKnowledgeTitle(normalizedTitle);
        setSavedKnowledgeFingerprint(
          knowledgeDocumentFingerprint(
            normalizedTitle,
            knowledgeValue,
            normalizeKnowledgeTags(knowledgeTags),
          ),
        );
      }

      toast.success(t("notes.knowledgeDocumentRenamed"));
    } catch (error) {
      console.error("[Notes] Failed to rename knowledge document:", error);
      toast.error(t("notes.knowledgeDocumentRenameFailed"));
    }
  };

  const handlePickKnowledgeImageAttachment = useCallback(
    async (document: KnowledgeDocument): Promise<KnowledgeImageInsertAttrs | null> => {
      try {
        const result = await pickAndPersistKnowledgeImageAttachment(document.id);
        if (!result) return null;
        toast.success(t("notes.knowledgeAttachmentAdded", { name: result.attachment.fileName }));
        return result.attrs;
      } catch (error) {
        console.error("[Notes] Failed to add knowledge image attachment:", error);
        toast.error(t("notes.knowledgeAttachmentAddFailed"));
        return null;
      }
    },
    [t],
  );

  const handleInsertKnowledgeSourceReference = useCallback(
    async (highlight: HighlightWithBook) => {
      if (!knowledgeHome || isKnowledgeVaultRootOpen || knowledgeHome.type === "folder") {
        toast.error(t("notes.knowledgeSourceReferenceUnavailable"));
        return;
      }

      const label = highlight.chapterTitle?.trim() || t("notes.knowledgeSourceHighlight");
      try {
        await ensureKnowledgeSourceLink({
          documentId: knowledgeHome.id,
          toKind: "highlight",
          toId: highlight.id,
          label,
          cfi: highlight.cfi,
        });
        setKnowledgeLinks(await getKnowledgeLinks(knowledgeHome.id));
        knowledgeSourceReferenceRequestIdRef.current += 1;
        setKnowledgeSourceReferenceRequest({
          requestId: knowledgeSourceReferenceRequestIdRef.current,
          label,
          sourceTitle: label,
          cfi: highlight.cfi,
        });
        toast.success(t("notes.knowledgeSourceReferenceInserted"));
      } catch (error) {
        console.error("[Notes] Failed to insert knowledge source reference:", error);
        toast.error(t("notes.knowledgeSourceReferenceInsertFailed"));
      }
    },
    [isKnowledgeVaultRootOpen, knowledgeHome, t],
  );

  const getKnowledgeSummaryAIConfig = () => {
    const endpoint = aiConfig.endpoints.find((item) => item.id === aiConfig.activeEndpointId);
    const needsKey = endpoint ? providerRequiresApiKey(endpoint.provider) : true;
    if (!endpoint || (needsKey && !endpoint.apiKey) || !aiConfig.activeModel) return null;
    return aiConfig;
  };

  const applyBackgroundKnowledgeSummaryUpdate = (document: KnowledgeDocument) => {
    const summaryPatch = {
      summaryMd: document.summaryMd,
      summarySourceFingerprint: document.summarySourceFingerprint,
      summarySourceUpdatedAt: document.summarySourceUpdatedAt,
      summaryUpdatedAt: document.summaryUpdatedAt,
      updatedAt: document.updatedAt,
    };

    setKnowledgeDocuments((documents) =>
      orderKnowledgeDocuments(
        documents.map((item) =>
          item.id === document.id ? { ...item, ...summaryPatch } : item,
        ),
        documents.find((item) => item.type === "book_home")?.id,
      ),
    );
    setKnowledgeHome((current) =>
      current?.id === document.id ? { ...current, ...summaryPatch } : current,
    );
  };

  const queueKnowledgeSummaryMaintenance = (
    documentIds: string[],
    options: {
      delayMs?: number;
      sourceFingerprints?: Map<string, string>;
    } = {},
  ) => {
    const uniqueDocumentIds = [...new Set(documentIds.filter(Boolean))];
    if (uniqueDocumentIds.length === 0) return;

    const config = getKnowledgeSummaryAIConfig();
    if (!config) return;

    const delayMs = Math.max(0, options.delayMs ?? 0);
    for (const documentId of uniqueDocumentIds) {
      const nextFingerprint = options.sourceFingerprints?.get(documentId);
      if (
        nextFingerprint &&
        knowledgeSummaryMaintenanceFingerprintsRef.current.get(documentId) === nextFingerprint
      ) {
        continue;
      }
      if (nextFingerprint) {
        knowledgeSummaryMaintenanceFingerprintsRef.current.set(documentId, nextFingerprint);
      }

      const existingTimer = knowledgeSummaryMaintenanceTimersRef.current.get(documentId);
      if (existingTimer) window.clearTimeout(existingTimer);

      const timer = window.setTimeout(() => {
        knowledgeSummaryMaintenanceTimersRef.current.delete(documentId);
        void maybeCompressKnowledgeDocumentsById([documentId], config)
          .then(async (results) => {
            const result = results[0];
            if (result?.status === "failed" || result?.status === "missing") {
              knowledgeSummaryMaintenanceFingerprintsRef.current.delete(documentId);
              return;
            }
            if (result?.persisted) {
              const refreshedDocument = await getKnowledgeDocument(documentId);
              if (refreshedDocument) applyBackgroundKnowledgeSummaryUpdate(refreshedDocument);
            }
          })
          .catch((error) => {
            knowledgeSummaryMaintenanceFingerprintsRef.current.delete(documentId);
            console.warn("[Notes] Background knowledge summary maintenance failed:", error);
          });
      }, delayMs);
      knowledgeSummaryMaintenanceTimersRef.current.set(documentId, timer);
    }
  };

  useEffect(() => {
    if (!knowledgeHome || knowledgeHome.type === "folder") return;
    if (currentKnowledgeFingerprint !== savedKnowledgeFingerprint) return;

    const sourceFingerprint = createKnowledgeSummarySourceFingerprint(knowledgeHome);
    if (knowledgeHome.summarySourceFingerprint === sourceFingerprint) return;

    queueKnowledgeSummaryMaintenance([knowledgeHome.id], {
      delayMs: KNOWLEDGE_SUMMARY_AUTOSAVE_MAINTENANCE_DELAY_MS,
      sourceFingerprints: new Map([[knowledgeHome.id, sourceFingerprint]]),
    });
  }, [knowledgeHome, currentKnowledgeFingerprint, savedKnowledgeFingerprint]);

  const handleCompressKnowledgeSummary = async () => {
    if (!knowledgeHome || isKnowledgeSummaryCompressing) return;

    const endpoint = aiConfig.endpoints.find((item) => item.id === aiConfig.activeEndpointId);
    const needsKey = endpoint ? providerRequiresApiKey(endpoint.provider) : true;
    if (!endpoint || (needsKey && !endpoint.apiKey) || !aiConfig.activeModel) {
      toast.error(t("notes.knowledgeSummaryAIConfigMissing"));
      return;
    }

    const saved = await saveActiveKnowledgeDocumentNow();
    if (!saved) return;

    const liveDocument: KnowledgeDocument = {
      ...knowledgeHome,
      title: knowledgeTitle.trim() || knowledgeHome.title,
      contentJson: knowledgeValue.contentJson,
      contentMd: knowledgeValue.contentMd,
      excerpt: createKnowledgeExcerpt(knowledgeValue.contentMd),
      tags: normalizeKnowledgeTags(knowledgeTags),
      updatedAt: Date.now(),
    };

    setIsKnowledgeSummaryCompressing(true);
    try {
      const result = await maybeCompressAndPersistKnowledgeSummary(liveDocument, aiConfig);
      if (result.status === "failed") {
        toast.error(t("notes.knowledgeSummaryFailed"), {
          description: result.error,
        });
        return;
      }

      if (result.status === "skipped") {
        const message =
          result.plan.reason === "empty"
            ? t("notes.knowledgeSummaryEmpty")
            : result.plan.reason === "below_threshold"
              ? t("notes.knowledgeSummaryTooShort")
              : t("notes.knowledgeSummaryUpToDate");
        toast.success(message);
        return;
      }

      const refreshedDocument = await getKnowledgeDocument(liveDocument.id);
      const updatedDocument: KnowledgeDocument =
        refreshedDocument ??
        ({
          ...liveDocument,
          summaryMd: result.state?.summaryMd,
          summarySourceFingerprint: result.state?.sourceFingerprint,
          summarySourceUpdatedAt: result.state?.sourceUpdatedAt,
          summaryUpdatedAt: result.state?.compressedAt,
          updatedAt: Date.now(),
        } satisfies KnowledgeDocument);

      setKnowledgeHome(updatedDocument);
      setKnowledgeDocuments((documents) =>
        orderKnowledgeDocuments(
          documents.map((document) =>
            document.id === updatedDocument.id ? updatedDocument : document,
          ),
          documents.find((document) => document.type === "book_home")?.id,
        ),
      );
      toast.success(t("notes.knowledgeSummaryCompressed"));
    } catch (error) {
      console.error("[Notes] Failed to compress knowledge summary:", error);
      toast.error(t("notes.knowledgeSummaryFailed"));
    } finally {
      setIsKnowledgeSummaryCompressing(false);
    }
  };

  const handleOpenBook = async (bookId: string, _title: string, cfi?: string) => {
    const book =
      books.find((item) => item.id === bookId) ??
      (await getBookRecord(bookId, { includeDeleted: true }).catch((err) => {
        console.warn("[Notes] Failed to get book record:", err);
        return null;
      }));
    if (!book) return;

    await openDesktopBook({
      book,
      t,
      initialCfi: cfi,
    });
  };

  // Delete only the note text, keep the highlight
  const handleDeleteNote = (highlight: HighlightWithBook) => {
    updateHighlight(highlight.id, { note: undefined });
  };

  // Delete the entire highlight record
  const handleDeleteHighlight = (highlight: HighlightWithBook) => {
    removeHighlight(highlight.id);
  };

  const startEditNote = (highlight: HighlightWithBook) => {
    setEditingId(highlight.id);
    setEditNote(highlight.note || "");
  };

  const saveNote = (id: string) => {
    updateHighlight(id, { note: editNote || undefined });
    setEditingId(null);
    setEditNote("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditNote("");
  };

  const doExport = (
    format: ExportFormat,
    book: { id: string; meta: { title: string } },
    content: string,
  ) => {
    try {
      if (format === "notion") {
        annotationExporter.copyToClipboard(content);
        toast.success(t("notes.copiedToClipboard"));
      } else {
        const ext = format === "json" ? "json" : "md";
        annotationExporter.downloadAsFile(content, `${book.meta.title}-${format}.${ext}`, format);
        toast.success(t("notes.exportSuccess"), {
          description: `${book.meta.title}.${ext}`,
        });
      }
    } catch (error) {
      toast.error(t("notes.exportFailed"));
      console.error("Export failed:", error);
    }
  };

  const handleKnowledgeExport = async (format: KnowledgeExportFormat) => {
    if (!selectedBook || !knowledgeHome) return;
    const book = books.find((b) => b.id === selectedBook.bookId);
    if (!book) return;

    try {
      const liveDocument: KnowledgeDocument = {
        ...knowledgeHome,
        title: knowledgeTitle.trim() || knowledgeHome.title,
        contentJson: knowledgeValue.contentJson,
        contentMd: knowledgeValue.contentMd,
        excerpt: createKnowledgeExcerpt(knowledgeValue.contentMd),
        tags: normalizeKnowledgeTags(knowledgeTags),
        updatedAt: Date.now(),
      };
      const input = await collectBookKnowledgeExportInput(selectedBook.bookId, liveDocument, book);
      const file = knowledgeExporter.exportBundle(input, {
        format,
        rootDir: "ReadAny",
        title: `${selectedBook.title} Knowledge`,
      });

      const filename =
        file.path.split("/").filter(Boolean).pop() || `${book.meta.title}-knowledge.md`;
      await annotationExporter.downloadAsFile(file.content, filename, format);
      toast.success(t("notes.exportSuccess"), {
        description: file.path,
      });
    } catch (error) {
      toast.error(t("notes.exportFailed"));
      console.error("[Notes] Knowledge export failed:", error);
    }
  };

  const handleKnowledgeVaultExport = async (scopeDocument?: KnowledgeDocument | null) => {
    if (!selectedBook || !knowledgeHome || isKnowledgeVaultExporting) return;

    setIsKnowledgeVaultExporting(true);
    setKnowledgeVaultConflicts(null);
    setKnowledgeMarkdownImportReview(null);
    setKnowledgeVaultImportReview(null);

    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: scopeDocument
          ? t("notes.knowledgeVaultSelectScopedFolder", {
              title: scopeDocument.title || t("notes.knowledgeUntitledDocument"),
            })
          : t("notes.knowledgeVaultSelectFolder"),
      });
      if (!selected || Array.isArray(selected)) return;

      const liveDocument: KnowledgeDocument = {
        ...knowledgeHome,
        title: knowledgeTitle.trim() || knowledgeHome.title,
        contentJson: knowledgeValue.contentJson,
        contentMd: knowledgeValue.contentMd,
        excerpt: createKnowledgeExcerpt(knowledgeValue.contentMd),
        tags: normalizeKnowledgeTags(knowledgeTags),
        updatedAt: Date.now(),
      };
      const collectedInput = await collectKnowledgeVaultInput(liveDocument, books);
      const input = scopeDocument
        ? scopeKnowledgeExportInputToDocumentSubtree(collectedInput, scopeDocument)
        : collectedInput;
      if (scopeDocument && input.documents.length === 0) {
        toast.error(t("notes.knowledgeVaultScopedExportEmpty"));
        return;
      }
      const manifestPath = knowledgeVaultManifestPath(scopeDocument);

      let previousManifest: KnowledgeExportManifest | undefined;
      try {
        previousManifest = await readKnowledgeVaultManifest(selected, manifestPath);
      } catch (error) {
        toast.error(t("notes.knowledgeVaultManifestInvalid"));
        console.error("[Notes] Failed to read knowledge vault manifest:", error);
        return;
      }

      const draftPackage = knowledgeExporter.buildVaultPackage(input, {
        format: "obsidian",
        rootDir: "",
        previousManifest,
        manifestPath,
      });
      const existingFiles = await readExistingKnowledgeVaultFiles(
        selected,
        previousManifest
          ? [
              ...Object.values(previousManifest.documents).map((entry) => entry.path),
              ...Object.values(draftPackage.manifest.documents).map((entry) => entry.path),
            ]
          : draftPackage.files.map((file) => file.path),
      );

      if (!previousManifest && existingFiles.length > 0) {
        const paths = existingFiles.map((file) => file.path);
        setKnowledgeVaultConflicts({
          rootPath: selected,
          paths,
          kind: "untracked_existing_file",
        });
        toast.error(t("notes.knowledgeVaultConflictToast"));
        return;
      }

      const vaultPackage = knowledgeExporter.buildVaultPackage(input, {
        format: "obsidian",
        rootDir: "",
        previousManifest,
        existingFiles,
        manifestPath,
      });

      if (vaultPackage.conflicts.length > 0) {
        setKnowledgeVaultConflicts({
          rootPath: selected,
          paths: vaultPackage.conflicts.map((conflict) => conflict.path),
          kind: "external_modified",
        });
        toast.error(t("notes.knowledgeVaultConflictToast"));
        return;
      }

      await writeKnowledgeVaultFiles(selected, vaultPackage.files);
      toast.success(
        scopeDocument
          ? t("notes.knowledgeVaultScopedExportSuccess")
          : t("notes.knowledgeVaultExportSuccess"),
        {
          description: scopeDocument
            ? t("notes.knowledgeVaultScopedExportSuccessDetail", {
                count: vaultPackage.files.length,
                title: scopeDocument.title || t("notes.knowledgeUntitledDocument"),
              })
            : t("notes.knowledgeVaultExportSuccessDetail", {
                count: vaultPackage.files.length,
              }),
        },
      );
    } catch (error) {
      toast.error(t("notes.knowledgeVaultExportFailed"));
      console.error("[Notes] Knowledge vault export failed:", error);
    } finally {
      setIsKnowledgeVaultExporting(false);
    }
  };

  const handleKnowledgeMarkdownImport = async () => {
    if (
      !selectedKnowledgeBookId ||
      isKnowledgeMarkdownImporting ||
      isKnowledgeMarkdownImportApplying
    ) {
      return;
    }

    setIsKnowledgeMarkdownImporting(true);
    setKnowledgeVaultConflicts(null);
    setKnowledgeVaultImportReview(null);
    setKnowledgeMarkdownImportReview(null);

    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        multiple: true,
        title: t("notes.knowledgeMarkdownImportSelectFiles"),
        filters: [
          {
            name: "Markdown",
            extensions: ["md", "markdown", "MD", "MARKDOWN"],
          },
        ],
      });
      if (!selected) return;

      const paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length === 0) return;

      const saved = await saveActiveKnowledgeDocumentNow();
      if (!saved) return;

      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const defaultParentId = getKnowledgeDocumentCreateParentId({
        document: knowledgeHome,
        isVaultRootOpen: isKnowledgeVaultRootOpen,
      });
      const [files, cardTemplates] = await Promise.all([
        Promise.all(
          paths.map(async (path) => ({
            path,
            content: await readTextFile(path),
          })),
        ),
        getKnowledgeCardTemplates({ includeDisabled: true }),
      ]);
      const plan = createKnowledgeMarkdownImportPlan({
        bookId: selectedKnowledgeBookId,
        defaultParentId,
        currentDocuments: knowledgeDocuments,
        files,
        cardTemplates,
      });
      const items: KnowledgeMarkdownImportReviewItem[] = plan.items.map((item) => ({
        path: item.path,
        sourcePath: item.path,
        proposal: {
          ...item.proposal,
          message: t("notes.knowledgeMarkdownImportProposalMessage", {
            file: desktopFileName(item.relativePath || item.path),
          }),
        },
        warnings: item.warnings,
      }));
      if (items.length === 0) return;

      setKnowledgeMarkdownImportReview({ items });
      toast.success(t("notes.knowledgeMarkdownImportReady"), {
        description: t("notes.knowledgeMarkdownImportReadyDetail", { count: items.length }),
      });
    } catch (error) {
      toast.error(t("notes.knowledgeMarkdownImportFailed"));
      console.error("[Notes] Knowledge Markdown import failed:", error);
    } finally {
      setIsKnowledgeMarkdownImporting(false);
    }
  };

  const handleApplyKnowledgeMarkdownImport = async () => {
    if (!knowledgeMarkdownImportReview || isKnowledgeMarkdownImportApplying) return;

    const saved = await saveActiveKnowledgeDocumentNow();
    if (!saved) return;

    setIsKnowledgeMarkdownImportApplying(true);
    try {
      const importedDocumentIds: string[] = [];
      const preferredDocumentIds: string[] = [];
      const summaryDocumentIds: string[] = [];
      for (const item of knowledgeMarkdownImportReview.items) {
        const result = await applyKnowledgeWriteProposal(item.proposal);
        if (result.documentId) importedDocumentIds.push(result.documentId);
        if (result.documentId) {
          summaryDocumentIds.push(result.documentId);
        }
        if (item.proposal.action === "create" && item.proposal.draft.type !== "folder") {
          if (result.documentId) preferredDocumentIds.push(result.documentId);
        }
      }
      await refreshSelectedKnowledgeDocuments(
        preferredDocumentIds[0] ?? importedDocumentIds[0] ?? knowledgeHome?.id,
      );
      queueKnowledgeSummaryMaintenance(summaryDocumentIds);
      toast.success(t("notes.knowledgeMarkdownImportApplied"), {
        description: t("notes.knowledgeMarkdownImportAppliedDetail", {
          count: knowledgeMarkdownImportReview.items.length,
        }),
      });
      setKnowledgeMarkdownImportReview(null);
    } catch (error) {
      toast.error(t("notes.knowledgeMarkdownImportApplyFailed"));
      console.error("[Notes] Failed to apply knowledge Markdown import:", error);
    } finally {
      setIsKnowledgeMarkdownImportApplying(false);
    }
  };

  const handleKnowledgeVaultImport = async () => {
    if (isKnowledgeVaultImporting || isKnowledgeVaultImportApplying) return;

    setIsKnowledgeVaultImporting(true);
    setKnowledgeVaultConflicts(null);
    setKnowledgeMarkdownImportReview(null);
    setKnowledgeVaultImportReview(null);

    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("notes.knowledgeVaultImportSelectFolder"),
      });
      if (!selected || Array.isArray(selected)) return;

      const saved = await saveActiveKnowledgeDocumentNow();
      if (!saved) return;

      let manifest: KnowledgeExportManifest | undefined;
      try {
        manifest = await readKnowledgeVaultManifest(selected);
      } catch (error) {
        toast.error(t("notes.knowledgeVaultManifestInvalid"));
        console.error("[Notes] Failed to read knowledge vault manifest for import:", error);
        return;
      }

      if (!manifest) {
        toast.error(t("notes.knowledgeVaultImportManifestMissing"));
        return;
      }

      const files = await readExistingKnowledgeVaultFiles(
        selected,
        Object.values(manifest.documents).map((entry) => entry.path),
        { includeMarkdownFiles: true },
      );
      const liveDocument: KnowledgeDocument | null = knowledgeHome
        ? {
            ...knowledgeHome,
            title: knowledgeTitle.trim() || knowledgeHome.title,
            contentJson: knowledgeValue.contentJson,
            contentMd: knowledgeValue.contentMd,
            excerpt: createKnowledgeExcerpt(knowledgeValue.contentMd),
            tags: normalizeKnowledgeTags(knowledgeTags),
            updatedAt: Date.now(),
          }
        : null;
      const currentInput = liveDocument
        ? await collectKnowledgeVaultInput(liveDocument, books)
        : null;
      const cardTemplates =
        currentInput?.cardTemplates ??
        (await getKnowledgeCardTemplates({ includeDisabled: true }));
      const currentFiles = currentInput
        ? knowledgeExporter.buildVaultPackage(currentInput, {
            format: "obsidian",
            rootDir: "",
            previousManifest: manifest,
          }).files
        : [];
      const plan = createKnowledgeVaultImportPlan({
        manifest,
        files,
        currentFiles,
        cardTemplates,
      });
      const proposals = createKnowledgeVaultImportWriteProposals(plan);
      const applicableChangeCount = proposals.length + plan.cardTemplateChanges.length;

      if (
        plan.modified.length === 0 &&
        plan.missing.length === 0 &&
        plan.unreadable.length === 0 &&
        plan.conflicts.length === 0 &&
        plan.cardTemplateChanges.length === 0 &&
        plan.cardTemplateConflicts.length === 0
      ) {
        toast.success(t("notes.knowledgeVaultImportUpToDate"));
        return;
      }

      setKnowledgeVaultImportReview({
        rootPath: selected,
        plan,
        proposals,
      });

      if (applicableChangeCount > 0) {
        toast.success(t("notes.knowledgeVaultImportReady"), {
          description: t("notes.knowledgeVaultImportReadyDetailWithTemplates", {
            documentCount: proposals.length,
            templateCount: plan.cardTemplateChanges.length,
          }),
        });
      } else {
        toast.error(t("notes.knowledgeVaultImportNoApplicableChanges"));
      }
    } catch (error) {
      toast.error(t("notes.knowledgeVaultImportFailed"));
      console.error("[Notes] Knowledge vault import failed:", error);
    } finally {
      setIsKnowledgeVaultImporting(false);
    }
  };

  const handleApplyKnowledgeVaultImport = async () => {
    if (!knowledgeVaultImportReview || isKnowledgeVaultImportApplying) return;
    const applicableChangeCount =
      knowledgeVaultImportReview.proposals.length +
      knowledgeVaultImportReview.plan.cardTemplateChanges.length;
    if (applicableChangeCount === 0) return;

    const saved = await saveActiveKnowledgeDocumentNow();
    if (!saved) return;

    setIsKnowledgeVaultImportApplying(true);
    try {
      const summaryDocumentIds: string[] = [];
      for (const change of knowledgeVaultImportReview.plan.cardTemplateChanges) {
        await upsertKnowledgeCardTemplate(change.template);
      }
      for (const proposal of knowledgeVaultImportReview.proposals) {
        const result = await applyKnowledgeWriteProposal(proposal);
        if (result.documentId) {
          summaryDocumentIds.push(result.documentId);
        }
      }
      await refreshSelectedKnowledgeDocuments(knowledgeHome?.id);
      queueKnowledgeSummaryMaintenance(summaryDocumentIds);
      toast.success(t("notes.knowledgeVaultImportApplied"), {
        description: t("notes.knowledgeVaultImportAppliedDetailWithTemplates", {
          documentCount: knowledgeVaultImportReview.proposals.length,
          templateCount: knowledgeVaultImportReview.plan.cardTemplateChanges.length,
        }),
      });
      setKnowledgeVaultImportReview(null);
    } catch (error) {
      toast.error(t("notes.knowledgeVaultImportApplyFailed"));
      console.error("[Notes] Failed to apply knowledge vault import:", error);
    } finally {
      setIsKnowledgeVaultImportApplying(false);
    }
  };

  const handleSingleBookExport = (format: ExportFormat) => {
    if (!selectedBook) return;
    const book = books.find((b) => b.id === selectedBook.bookId);
    if (!book) return;
    const content = annotationExporter.export(
      selectedBook.highlights as Highlight[],
      [] as Note[],
      book,
      { format },
    );
    doExport(format, book, content);
  };

  const handleMultiBookExport = (format: ExportFormat) => {
    const booksData = bookNotebooks
      .map((notebook) => {
        const book = books.find((b) => b.id === notebook.bookId);
        if (!book) return null;
        return { book, highlights: notebook.highlights as Highlight[], notes: [] as Note[] };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null);
    if (booksData.length === 0) return;
    try {
      const content = annotationExporter.exportMultipleBooks(booksData, { format });
      if (format === "notion") {
        annotationExporter.copyToClipboard(content);
        toast.success(t("notes.copiedToClipboard"));
      } else {
        const ext = format === "json" ? "json" : "md";
        annotationExporter.downloadAsFile(content, `all-annotations.${ext}`, format);
        toast.success(t("notes.exportSuccess"), {
          description: `all-annotations.${ext}`,
        });
      }
    } catch (error) {
      toast.error(t("notes.exportFailed"));
      console.error("Export failed:", error);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  if (bookNotebooks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-6 text-center">
        <img src="/note.svg" alt="" className="mb-6 h-48 w-48 dark:invert" />
        <p className="text-base font-medium text-foreground">{t("notes.empty")}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t("notes.emptyHint")}</p>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left Panel — Notebooks */}
      <div
        className={cn(
          "shrink-0 border-r border-border/40 flex flex-col",
          selectedBookId ? "w-[260px]" : "w-full",
        )}
      >
        {/* Left header */}
        <div className="shrink-0 border-b border-border/40 px-4 py-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-1">
                <h1 className="text-base font-semibold">{t("notes.title")}</h1>
                <SyncButton iconSize={14} />
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {t("notes.stats", {
                  highlights: stats?.totalHighlights || 0,
                  notes: stats?.highlightsWithNotes || 0,
                  books: stats?.totalBooks || 0,
                })}
              </p>
            </div>
            {!selectedBookId && <ExportDropdown onExport={handleMultiBookExport} />}
          </div>
        </div>

        {/* Notebook list */}
        <div className="flex-1 overflow-y-auto p-3">
          {selectedBookId ? (
            <div className="space-y-1">
              {bookNotebooks.map((book) => (
                <button
                  key={book.bookId}
                  type="button"
                  className={cn(
                    "w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                    book.bookId === selectedBookId
                      ? "bg-primary/10 text-primary"
                      : "hover:bg-muted/60 text-foreground",
                  )}
                  onClick={() => {
                    setSelectedBookId(book.bookId);
                    setSearchQuery("");
                    setEditingId(null);
                  }}
                >
                  <CoverImage
                    url={book.coverUrl}
                    alt=""
                    className="h-9 w-6 shrink-0 rounded object-cover"
                    fallback={
                      <div className="flex h-9 w-6 shrink-0 items-center justify-center rounded bg-muted">
                        <BookOpen className="h-3 w-3 text-muted-foreground" />
                      </div>
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{book.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {book.highlights.length} {t("notes.highlightsCount")}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            /* Grid view — BookCard-inspired style */
            <div className="grid grid-cols-3 gap-x-5 gap-y-6 sm:grid-cols-4 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
              {bookNotebooks.map((book) => (
                <NotebookCard
                  key={book.bookId}
                  book={book}
                  onClick={() => {
                    setSelectedBookId(book.bookId);
                    setSearchQuery("");
                    setEditingId(null);
                    setDetailTab("knowledge");
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right Panel — Book Notes / Highlights Detail */}
      {selectedBookId && selectedBook && (
        <div className="flex-1 flex flex-col min-w-0">
          {/* Right header */}
          <div className="shrink-0 border-b border-border/40 px-5 py-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                className="rounded-md p-1 hover:bg-muted transition-colors"
                onClick={() => setSelectedBookId(null)}
              >
                <ChevronLeft className="h-4 w-4" />
              </button>

              <CoverImage
                url={selectedBook.coverUrl}
                alt=""
                className="h-10 w-7 shrink-0 rounded object-cover shadow-sm"
                fallback={
                  <div className="flex h-10 w-7 shrink-0 items-center justify-center rounded bg-muted">
                    <BookOpen className="h-4 w-4 text-muted-foreground" />
                  </div>
                }
              />

              <div className="min-w-0 flex-1">
                <h2 className="text-sm font-semibold truncate">{selectedBook.title}</h2>
                <p className="text-xs text-muted-foreground">{selectedBook.author}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleOpenBook(selectedBook.bookId, selectedBook.title)}
                  className="gap-1.5 h-7 text-xs"
                >
                  <BookOpen className="h-3 w-3" />
                  {t("notes.openBook")}
                </Button>
                <ExportDropdown onExport={handleSingleBookExport} variant="outline" size="sm" />
              </div>
            </div>

            {/* Tab switcher + search */}
            <div className="mt-3 flex items-center gap-3">
              <div className="flex rounded-lg border border-border/60 p-0.5">
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    detailTab === "knowledge"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setDetailTab("knowledge")}
                >
                  <ListTree className="h-3 w-3" />
                  {t("notes.knowledgeTab")}
                </button>
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    detailTab === "notes"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setDetailTab("notes")}
                >
                  <NotebookPen className="h-3 w-3" />
                  {t("notebook.notesSection")} ({selectedBook.notesCount})
                </button>
                <button
                  type="button"
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-medium transition-colors",
                    detailTab === "highlights"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                  onClick={() => setDetailTab("highlights")}
                >
                  <Highlighter className="h-3 w-3" />
                  {t("notebook.highlightsSection")} ({selectedBook.highlightsOnlyCount})
                </button>
              </div>

              {detailTab === "knowledge" ? (
                <div className="flex flex-1 items-center justify-end gap-3 text-xs text-muted-foreground">
                  <span>
                    {knowledgeDocuments.length} {t("notes.knowledgeDocuments")}
                  </span>
                  <span>
                    {knowledgeFolderCount} {t("notes.knowledgeDocumentFolder")}
                  </span>
                  <span className="flex items-center gap-1">
                    <Save className="h-3 w-3" />
                    {isKnowledgeSaving
                      ? t("notes.knowledgeSaving")
                      : currentKnowledgeFingerprint === savedKnowledgeFingerprint
                        ? t("notes.knowledgeSaved")
                        : t("notes.knowledgePending")}
                  </span>
                </div>
              ) : (
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder={t("notes.searchPlaceholder")}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 h-8 text-sm"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {detailTab === "knowledge" ? (
              <KnowledgeHomePanel
                book={selectedBook}
                document={knowledgeHome}
                documents={knowledgeDocuments}
                isVaultRootOpen={isKnowledgeVaultRootOpen}
                activeDocumentId={
                  isKnowledgeVaultRootOpen ? "__vault__" : selectedKnowledgeDocumentId
                }
                title={knowledgeTitle}
                tags={knowledgeTags}
                value={knowledgeValue}
                sourceReferenceRequest={knowledgeSourceReferenceRequest}
                links={knowledgeLinks}
                backlinks={knowledgeBacklinks}
                isRelationsLoading={isKnowledgeRelationsLoading}
                isLoading={isKnowledgeLoading}
                isSaving={isKnowledgeSaving}
                isSummaryCompressing={isKnowledgeSummaryCompressing}
                isCreatingDocument={isKnowledgeDocumentCreating}
                isSaved={currentKnowledgeFingerprint === savedKnowledgeFingerprint}
                onTitleChange={setKnowledgeTitle}
                onTagsChange={setKnowledgeTags}
                onChange={setKnowledgeValue}
                onOpenVaultRoot={openKnowledgeVaultRoot}
                onSelectDocument={openKnowledgeDocument}
                onCreateDocument={handleCreateKnowledgeDocument}
                onDeleteDocument={handleDeleteKnowledgeDocument}
                onMoveDocument={handleMoveKnowledgeDocument}
                onRenameDocument={handleRenameKnowledgeDocument}
                onPickImageAttachment={handlePickKnowledgeImageAttachment}
                onInsertSourceReference={handleInsertKnowledgeSourceReference}
                onCompressSummary={handleCompressKnowledgeSummary}
                onExport={handleKnowledgeExport}
                onImportMarkdown={handleKnowledgeMarkdownImport}
                onExportVault={handleKnowledgeVaultExport}
                onExportVaultScope={handleKnowledgeVaultExport}
                onImportVault={handleKnowledgeVaultImport}
                onOpenBook={(cfi) => handleOpenBook(selectedBook.bookId, selectedBook.title, cfi)}
                isMarkdownImporting={isKnowledgeMarkdownImporting}
                isMarkdownImportApplying={isKnowledgeMarkdownImportApplying}
                isVaultExporting={isKnowledgeVaultExporting}
                isVaultImporting={isKnowledgeVaultImporting}
                isVaultImportApplying={isKnowledgeVaultImportApplying}
                vaultConflicts={knowledgeVaultConflicts}
                onDismissVaultConflicts={() => setKnowledgeVaultConflicts(null)}
                markdownImportReview={knowledgeMarkdownImportReview}
                onApplyMarkdownImport={handleApplyKnowledgeMarkdownImport}
                onDismissMarkdownImport={() => setKnowledgeMarkdownImportReview(null)}
                vaultImportReview={knowledgeVaultImportReview}
                onApplyVaultImport={handleApplyKnowledgeVaultImport}
                onDismissVaultImport={() => setKnowledgeVaultImportReview(null)}
                t={t}
              />
            ) : currentList.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center p-6 text-center">
                <NotebookPen className="mb-3 h-10 w-10 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">
                  {searchQuery
                    ? t("notes.noSearchResults")
                    : detailTab === "notes"
                      ? t("notes.noNotes")
                      : t("highlights.noHighlights")}
                </p>
              </div>
            ) : (
              <div className="p-5 space-y-6">
                {Array.from(itemsByChapter.entries()).map(([chapter, items]) => (
                  <div key={chapter}>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="h-px flex-1 bg-border/50" />
                      <span className="shrink-0 text-xs font-medium text-muted-foreground px-2">
                        {chapter}
                      </span>
                      <div className="h-px flex-1 bg-border/50" />
                    </div>

                    <div className="space-y-3">
                      {items.map((item) =>
                        detailTab === "notes" ? (
                          <NoteDetailCard
                            key={item.id}
                            highlight={item}
                            isEditing={editingId === item.id}
                            editNote={editNote}
                            setEditNote={setEditNote}
                            onStartEdit={() => startEditNote(item)}
                            onSaveNote={() => saveNote(item.id)}
                            onCancelEdit={cancelEdit}
                            onDeleteNote={() => handleDeleteNote(item)}
                            onNavigate={() =>
                              handleOpenBook(selectedBook.bookId, selectedBook.title, item.cfi)
                            }
                            t={t}
                          />
                        ) : (
                          <HighlightDetailCard
                            key={item.id}
                            highlight={item}
                            onDelete={() => handleDeleteHighlight(item)}
                            onNavigate={() =>
                              handleOpenBook(selectedBook.bookId, selectedBook.title, item.cfi)
                            }
                            t={t}
                          />
                        ),
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// --- Knowledge home workspace ---

interface KnowledgeHomePanelProps {
  book: {
    bookId: string;
    title: string;
    author: string;
    highlights: HighlightWithBook[];
    notesCount: number;
    highlightsOnlyCount: number;
  };
  document: KnowledgeDocument | null;
  documents: KnowledgeDocument[];
  isVaultRootOpen: boolean;
  activeDocumentId: string | null;
  title: string;
  tags: string[];
  value: KnowledgeEditorValue;
  sourceReferenceRequest: KnowledgeSourceReferenceRequest | null;
  links: KnowledgeLink[];
  backlinks: KnowledgeBacklink[];
  isRelationsLoading: boolean;
  isLoading: boolean;
  isSaving: boolean;
  isSummaryCompressing: boolean;
  isCreatingDocument: boolean;
  isSaved: boolean;
  onTitleChange: (title: string) => void;
  onTagsChange: (tags: string[]) => void;
  onChange: (value: KnowledgeEditorValue) => void;
  onOpenVaultRoot: () => boolean | Promise<boolean>;
  onSelectDocument: (document: KnowledgeDocument) => boolean | Promise<boolean>;
  onCreateDocument: (type?: CreatableKnowledgeDocumentType, parentId?: string) => void;
  onDeleteDocument: (document: KnowledgeDocument) => void;
  onMoveDocument: (document: KnowledgeDocument, parentId?: string | null) => void;
  onRenameDocument: (document: KnowledgeDocument, title: string) => void;
  onPickImageAttachment: (document: KnowledgeDocument) => Promise<KnowledgeImageInsertAttrs | null>;
  onInsertSourceReference: (highlight: HighlightWithBook) => void;
  onCompressSummary: () => void;
  onExport: (format: KnowledgeExportFormat) => void;
  onImportMarkdown: () => void;
  onExportVault: () => void;
  onExportVaultScope: (document: KnowledgeDocument) => void;
  onImportVault: () => void;
  onOpenBook: (cfi?: string) => void;
  isMarkdownImporting: boolean;
  isMarkdownImportApplying: boolean;
  isVaultExporting: boolean;
  isVaultImporting: boolean;
  isVaultImportApplying: boolean;
  vaultConflicts: KnowledgeVaultConflictNotice | null;
  onDismissVaultConflicts: () => void;
  markdownImportReview: KnowledgeMarkdownImportReview | null;
  onApplyMarkdownImport: () => void;
  onDismissMarkdownImport: () => void;
  vaultImportReview: KnowledgeVaultImportReview | null;
  onApplyVaultImport: () => void;
  onDismissVaultImport: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function KnowledgeHomePanel({
  book,
  document,
  documents,
  isVaultRootOpen,
  activeDocumentId,
  title,
  tags,
  value,
  sourceReferenceRequest,
  links,
  backlinks,
  isRelationsLoading,
  isLoading,
  isSaving,
  isSummaryCompressing,
  isCreatingDocument,
  isSaved,
  onTitleChange,
  onTagsChange,
  onChange,
  onOpenVaultRoot,
  onSelectDocument,
  onCreateDocument,
  onDeleteDocument,
  onMoveDocument,
  onRenameDocument,
  onPickImageAttachment,
  onInsertSourceReference,
  onCompressSummary,
  onExport,
  onImportMarkdown,
  onExportVault,
  onExportVaultScope,
  onImportVault,
  onOpenBook,
  isMarkdownImporting,
  isMarkdownImportApplying,
  isVaultExporting,
  isVaultImporting,
  isVaultImportApplying,
  vaultConflicts,
  onDismissVaultConflicts,
  markdownImportReview,
  onApplyMarkdownImport,
  onDismissMarkdownImport,
  vaultImportReview,
  onApplyVaultImport,
  onDismissVaultImport,
  t,
}: KnowledgeHomePanelProps) {
  const recentHighlights = useMemo(
    () => sortAnnotationsByPosition(book.highlights).slice(0, 4),
    [book.highlights],
  );
  const activeDocumentChildren = useMemo(
    () => (document ? documents.filter((item) => item.parentId === document.id) : []),
    [document, documents],
  );
  const rootDocuments = useMemo(() => {
    const homeDocumentId = documents.find((item) => item.type === "book_home")?.id;
    const sections = createKnowledgeRootDisplaySections(documents, homeDocumentId);
    return [...sections.home, ...sections.folders, ...sections.documents, ...sections.orphaned];
  }, [documents]);
  const activeKnowledgeOpenMode = getKnowledgeDocumentOpenMode({ document, isVaultRootOpen });
  const isFolderDocument = activeKnowledgeOpenMode === "folder_browser";
  const activePathItems = useMemo(
    () =>
      isVaultRootOpen
        ? [
            {
              id: "__vault__",
              title: t("notes.knowledgeVaultRoot", { defaultValue: "Knowledge base" }),
            },
          ]
        : document
          ? knowledgeDocumentPath(document, documents, t, title)
          : [
              {
                id: "__vault__",
                title: t("notes.knowledgeVaultRoot", { defaultValue: "Knowledge base" }),
              },
            ],
    [document, documents, isVaultRootOpen, t, title],
  );
  const activePathLabel = activePathItems.map((item) => item.title).join(" / ");
  const documentOutline = useMemo(
    () =>
      document && !isVaultRootOpen && !isFolderDocument
        ? extractKnowledgeDocumentOutline(value.contentJson, value.contentMd)
        : [],
    [document, isFolderDocument, isVaultRootOpen, value.contentJson, value.contentMd],
  );
  const internalLinkTargets = useMemo<KnowledgeInternalLinkTarget[]>(
    () =>
      documents
        .filter((item) => item.id !== document?.id)
        .map((item) => {
          const pathItems = knowledgeDocumentPath(item, documents, t).slice(1);
          const path = pathItems
            .slice(0, -1)
            .map((part) => part.title)
            .join(" / ");
          const targetPath = pathItems.map((part) => part.title).join("/");
          return {
            id: item.id,
            title: item.title.trim() || t("notes.knowledgeUntitledDocument"),
            path,
            targetPath,
            typeLabel: knowledgeDocumentTypeLabel(item, t),
          };
        }),
    [document?.id, documents, t],
  );
  const [outlineTarget, setOutlineTarget] = useState<KnowledgeEditorOutlineTarget | null>(null);
  const [isContextInspectorOpen, setIsContextInspectorOpen] = useState(true);
  const isCompactWorkspace = useMediaQuery("(max-width: 1320px)");
  const [hasAutoCollapsedInspector, setHasAutoCollapsedInspector] = useState(false);
  const handleSelectOutlineItem = useCallback((item: KnowledgeDocumentOutlineItem) => {
    setOutlineTarget((current) => ({
      index: item.index,
      requestId: (current?.requestId ?? 0) + 1,
    }));
  }, []);

  useEffect(() => {
    if (!isCompactWorkspace || hasAutoCollapsedInspector) return;
    setIsContextInspectorOpen(false);
    setHasAutoCollapsedInspector(true);
  }, [hasAutoCollapsedInspector, isCompactWorkspace]);

  if (isLoading || !document) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
          <p className="text-sm text-muted-foreground">{t("notes.knowledgeLoading")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full min-h-[720px] bg-background">
      <div
        className={cn(
          "relative grid h-full gap-0 overflow-hidden bg-background",
          isContextInspectorOpen && !isCompactWorkspace
            ? "grid-cols-[316px_minmax(0,1fr)_320px]"
            : "grid-cols-[316px_minmax(0,1fr)]",
        )}
      >
        <KnowledgeDocumentExplorer
          documents={documents}
          activeDocumentId={activeDocumentId}
          isRootActive={isVaultRootOpen}
          isCreating={isCreatingDocument}
          onSelectRoot={onOpenVaultRoot}
          onSelect={onSelectDocument}
          onCreate={onCreateDocument}
          onDelete={onDeleteDocument}
          onMove={onMoveDocument}
          onRename={onRenameDocument}
          t={t}
        />

        <section className="flex min-w-0 flex-col overflow-hidden bg-background">
          <div className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-border/30 bg-background/95 px-4 py-2 backdrop-blur">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <div
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md border border-border/35 bg-muted/[0.16] px-2.5 py-1.5 text-xs text-muted-foreground"
                title={activePathLabel}
              >
                <BookOpen className="h-3.5 w-3.5 shrink-0 text-primary/80" />
                <span className="max-w-52 truncate font-medium text-foreground/90">
                  {book.title}
                </span>
                <span className="text-border">/</span>
                <KnowledgePathInline
                  path={activePathItems}
                  documents={documents}
                  onSelectRoot={onOpenVaultRoot}
                  onSelectDocument={onSelectDocument}
                  ariaLabel={t("notes.knowledgeDocumentPath", { defaultValue: "Document path" })}
                  title={activePathLabel}
                />
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="flex h-8 items-center gap-2 rounded-md border border-border/40 bg-background px-2.5 text-xs text-muted-foreground">
                <Save className="h-3.5 w-3.5" />
                {isSaving
                  ? t("notes.knowledgeSaving")
                  : isSaved
                    ? t("notes.knowledgeSaved")
                    : t("notes.knowledgePending")}
              </div>
              <button
                type="button"
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors",
                  isContextInspectorOpen
                    ? "border-primary/25 bg-primary/10 text-primary hover:bg-primary/15"
                    : "border-border/50 bg-muted/20 text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
                onClick={() => setIsContextInspectorOpen((open) => !open)}
                aria-label={t("notes.knowledgeContext")}
                title={t("notes.knowledgeContext")}
              >
                <Brain className="h-3.5 w-3.5" />
              </button>
              <KnowledgeExportMenu
                onExport={onExport}
                onImportMarkdown={onImportMarkdown}
                onExportVault={onExportVault}
                onImportVault={onImportVault}
                isMarkdownImporting={isMarkdownImporting}
                isVaultExporting={isVaultExporting}
                isVaultImporting={isVaultImporting}
                t={t}
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto bg-background px-8 py-7">
            <div
              className={cn(
                isVaultRootOpen || isFolderDocument ? "w-full pb-4" : "mx-auto max-w-[820px] pb-3",
              )}
            >
              {isVaultRootOpen ? (
                <KnowledgeVaultRootTitle
                  bookTitle={book.title}
                  documentCount={documents.length}
                  t={t}
                />
              ) : (
                <>
                  <KnowledgeDocumentBreadcrumbs
                    document={document}
                    documents={documents}
                    activeTitle={title}
                    onSelectRoot={onOpenVaultRoot}
                    onSelectDocument={onSelectDocument}
                    t={t}
                    className="mb-3"
                  />
                  <KnowledgeDocumentTitleEditor
                    value={title}
                    onChange={onTitleChange}
                    label={t("notes.knowledgeDocumentTitle")}
                    placeholder={t("notes.knowledgeUntitledDocument")}
                  />
                  <div className="mt-3 h-px w-full bg-border/35" />
                </>
              )}
            </div>

            {vaultConflicts ? (
              <KnowledgeVaultConflictCard
                notice={vaultConflicts}
                onDismiss={onDismissVaultConflicts}
                t={t}
              />
            ) : null}

            {markdownImportReview ? (
              <KnowledgeMarkdownImportReviewCard
                review={markdownImportReview}
                documents={documents}
                isApplying={isMarkdownImportApplying}
                onApply={onApplyMarkdownImport}
                onDismiss={onDismissMarkdownImport}
                t={t}
              />
            ) : null}

            {vaultImportReview ? (
              <KnowledgeVaultImportReviewCard
                review={vaultImportReview}
                isApplying={isVaultImportApplying}
                onApply={onApplyVaultImport}
                onDismiss={onDismissVaultImport}
                t={t}
              />
            ) : null}

            {isVaultRootOpen ? (
              <KnowledgeVaultRootOverview
                items={rootDocuments}
                documents={documents}
                isCreating={isCreatingDocument}
                onSelect={onSelectDocument}
                onCreate={onCreateDocument}
                onDelete={onDeleteDocument}
                onMove={onMoveDocument}
                onRename={onRenameDocument}
                t={t}
              />
            ) : isFolderDocument ? (
              <KnowledgeFolderOverview
                folder={document}
                items={activeDocumentChildren}
                documents={documents}
                isCreating={isCreatingDocument}
                onSelect={onSelectDocument}
                onCreate={onCreateDocument}
                onDelete={onDeleteDocument}
                onMove={onMoveDocument}
                onRename={onRenameDocument}
                onExport={onExportVaultScope}
                isExporting={isVaultExporting}
                t={t}
              />
            ) : (
              <article className="mx-auto max-w-[820px]">
                <KnowledgeEditor
                  documentId={document.id}
                  tier="knowledge_doc"
                  surface={getKnowledgeEditorSurfaceForDocumentType(document.type)}
                  value={value}
                  onChange={onChange}
                  isSaved={isSaved}
                  onPickLocalImage={() => onPickImageAttachment(document)}
                  placeholder={t("notes.knowledgePlaceholder")}
                  chrome="canvas"
                  outlineTarget={outlineTarget}
                  internalLinkTargets={internalLinkTargets}
                  sourceReferenceRequest={sourceReferenceRequest}
                  contentClassName="max-h-none min-h-[700px] px-0 pb-14 [&_.ProseMirror]:min-h-[680px] [&_.ProseMirror]:bg-transparent [&_.ProseMirror]:px-0 [&_.ProseMirror]:pb-10 [&_.ProseMirror]:pt-1 [&_.ProseMirror]:text-[15.5px] [&_.ProseMirror_p]:text-[15.5px] [&_.ProseMirror_p]:leading-7"
                />
              </article>
            )}
          </div>
        </section>

        {isContextInspectorOpen ? (
          <aside
            className={cn(
              "min-h-0 min-w-0 overflow-y-auto border-l border-border/35 bg-muted/[0.10]",
              isCompactWorkspace &&
                "absolute bottom-0 right-0 top-0 z-20 w-[320px] max-w-[calc(100%-292px)] bg-background shadow-2xl shadow-background/30",
            )}
          >
            <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border/35 bg-background/95 px-3 py-2.5 backdrop-blur">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">
                  {t("notes.knowledgeContext")}
                </p>
                <p
                  className="mt-0.5 truncate text-[11px] text-muted-foreground"
                  title={activePathLabel}
                >
                  {activePathLabel}
                </p>
              </div>
              <button
                type="button"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                onClick={() => setIsContextInspectorOpen(false)}
                aria-label={t("common.close")}
                title={t("common.close")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="border-b border-border/35 bg-background/55 px-3 py-2.5">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
                <p className="text-xs font-semibold text-foreground">
                  {t("notes.knowledgeSignals")}
                </p>
              </div>
              <div className="space-y-1 text-[11px]">
                <div className="flex items-center justify-between gap-3 rounded-sm px-1 py-1 text-muted-foreground">
                  <span>{t("notes.notesCount")}</span>
                  <span className="font-medium tabular-nums text-foreground">
                    {book.notesCount}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-sm px-1 py-1 text-muted-foreground">
                  <span>{t("notes.highlightsCount")}</span>
                  <span className="font-medium tabular-nums text-foreground">
                    {book.highlightsOnlyCount}
                  </span>
                </div>
              </div>
            </div>

            {!isVaultRootOpen && !isFolderDocument ? (
              <div className="border-b border-border/35 bg-background/55 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Tag className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs font-semibold text-foreground">
                    {t("notes.knowledgeTags")}
                  </p>
                </div>
                <KnowledgeTagEditor tags={tags} onChange={onTagsChange} t={t} compact />
              </div>
            ) : null}

            {!isVaultRootOpen && !isFolderDocument ? (
              <KnowledgeDocumentOutlinePanel
                outline={documentOutline}
                onSelectItem={handleSelectOutlineItem}
                t={t}
              />
            ) : null}

            {!isVaultRootOpen ? (
              <KnowledgeRelationsPanel
                links={links}
                backlinks={backlinks}
                documents={documents}
                highlights={book.highlights}
                isLoading={isRelationsLoading}
                onSelectDocument={onSelectDocument}
                onOpenBook={onOpenBook}
                t={t}
              />
            ) : null}

            {!isVaultRootOpen && !isFolderDocument ? (
              <KnowledgeSummaryMemoryCard
                document={document}
                isCompressing={isSummaryCompressing}
                onCompress={onCompressSummary}
                t={t}
              />
            ) : null}

            <div className="border-b border-border/35 bg-background/55 p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-foreground">
                  {t("notes.knowledgeRecentExcerpts")}
                </p>
                <button
                  type="button"
                  className="rounded-md px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  onClick={() => onOpenBook()}
                >
                  {t("notes.openBook")}
                </button>
              </div>

              {recentHighlights.length === 0 ? (
                <p className="rounded-md bg-muted/30 px-2.5 py-3 text-xs leading-relaxed text-muted-foreground">
                  {t("notes.knowledgeNoSources")}
                </p>
              ) : (
                <div className="space-y-2">
                  {recentHighlights.map((highlight) => {
                    const canInsertReference = !isVaultRootOpen && !isFolderDocument;
                    return (
                      <div
                        key={highlight.id}
                        className="rounded-md border border-border/40 bg-background px-2.5 py-2 transition-colors hover:border-primary/30 hover:bg-primary/5"
                      >
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={() => onOpenBook(highlight.cfi)}
                        >
                          <p className="line-clamp-3 text-xs leading-relaxed text-foreground/90">
                            "{highlight.text}"
                          </p>
                          {highlight.chapterTitle && (
                            <p className="mt-1 truncate text-[11px] text-muted-foreground">
                              {highlight.chapterTitle}
                            </p>
                          )}
                        </button>
                        {canInsertReference ? (
                          <div className="mt-2 flex justify-end border-t border-border/30 pt-1.5">
                            <button
                              type="button"
                              className="inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10"
                              onClick={() => onInsertSourceReference(highlight)}
                              aria-label={t("notes.knowledgeInsertSourceReference")}
                            >
                              <BookOpen className="h-3 w-3" />
                              {t("notes.knowledgeInsertSourceReference")}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function KnowledgeDocumentTitleEditor({
  value,
  onChange,
  label,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const resize = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${textarea.scrollHeight}px`;
  }, []);

  useEffect(() => {
    resize();
  });

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(event) => {
        onChange(event.target.value.replace(/\s*\n+\s*/g, " "));
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      onPaste={(event) => {
        const text = event.clipboardData.getData("text/plain");
        if (!text.includes("\n")) return;
        event.preventDefault();
        const normalizedText = text.replace(/\s*\n+\s*/g, " ");
        const target = event.currentTarget;
        const start = target.selectionStart ?? target.value.length;
        const end = target.selectionEnd ?? start;
        onChange(`${value.slice(0, start)}${normalizedText}${value.slice(end)}`);
      }}
      rows={1}
      aria-label={label}
      placeholder={placeholder}
      spellCheck={false}
      className="block max-h-36 min-h-[3.5rem] w-full min-w-0 resize-none overflow-hidden bg-transparent text-[40px] font-semibold leading-[1.08] text-foreground outline-none placeholder:text-muted-foreground/38 focus-visible:text-foreground"
    />
  );
}

function KnowledgeVaultRootTitle({
  bookTitle,
  documentCount,
  t,
}: {
  bookTitle: string;
  documentCount: number;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <>
      <nav
        className="mb-2 flex min-w-0 flex-wrap items-center gap-1 text-[11px] font-medium text-muted-foreground"
        aria-label={t("notes.knowledgeDocumentPath", { defaultValue: "Document path" })}
      >
        <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary/80" />
        <span>{t("notes.knowledgeVaultRoot", { defaultValue: "Knowledge base" })}</span>
      </nav>
      <h2 className="block w-full min-w-0 truncate text-[32px] font-semibold leading-[1.12] text-foreground">
        {bookTitle}
      </h2>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>{t("notes.knowledgeDocumentFolder")}</span>
        <span className="text-border">/</span>
        <span>
          {documentCount} {t("notes.knowledgeDocuments")}
        </span>
      </div>
    </>
  );
}

function KnowledgeVaultRootOverview({
  items,
  documents,
  isCreating,
  onSelect,
  onCreate,
  onDelete,
  onMove,
  onRename,
  t,
}: {
  items: KnowledgeDocument[];
  documents: KnowledgeDocument[];
  isCreating: boolean;
  onSelect: (document: KnowledgeDocument) => void;
  onCreate: (type?: CreatableKnowledgeDocumentType, parentId?: string) => void;
  onDelete: (document: KnowledgeDocument) => void;
  onMove: (document: KnowledgeDocument, parentId?: string | null) => void;
  onRename: (document: KnowledgeDocument, title: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const childCountByParentId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const document of documents) {
      if (!document.parentId) continue;
      counts.set(document.parentId, (counts.get(document.parentId) ?? 0) + 1);
    }
    return counts;
  }, [documents]);
  const homeDocumentId = documents.find((document) => document.type === "book_home")?.id;
  const childSections = useMemo(
    () => createKnowledgeRootDisplaySections(documents, homeDocumentId),
    [documents, homeDocumentId],
  );

  return (
    <div className="w-full pb-10 pt-1">
      <div className="mb-4 flex items-center justify-between gap-4 border-b border-border/35 pb-3">
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-1.5 truncate text-[11px] text-muted-foreground">
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary/80" />
            <span className="truncate">
              {t("notes.knowledgeVaultRoot", { defaultValue: "Knowledge base" })} /{" "}
              {t("notes.knowledgeFolderInside")}
            </span>
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {items.length} {t("notes.knowledgeDocuments")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={isCreating}
            onClick={() => onCreate("folder")}
          >
            <Folder className="mr-2 h-3.5 w-3.5" />
            {t("notes.knowledgeNewFolder")}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={isCreating}
            onClick={() => onCreate("standalone_note")}
          >
            <FileText className="mr-2 h-3.5 w-3.5" />
            {t("notes.knowledgeNewNote")}
          </Button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="flex min-h-64 items-center justify-center border border-dashed border-border/55 bg-muted/[0.14] px-6 py-10 text-center">
          <div className="max-w-sm">
            <p className="text-sm font-medium text-foreground">{t("notes.knowledgeFolderEmpty")}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {t("notes.knowledgeFolderEmptyHint")}
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isCreating}
                onClick={() => onCreate("folder")}
              >
                <Folder className="mr-2 h-3.5 w-3.5" />
                {t("notes.knowledgeNewFolder")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isCreating}
                onClick={() => onCreate("standalone_note")}
              >
                <FileText className="mr-2 h-3.5 w-3.5" />
                {t("notes.knowledgeNewNote")}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <KnowledgeFolderBrowserSection
            title={t("notes.knowledgeDocumentHome")}
            items={childSections.home}
            documents={documents}
            childCountByParentId={childCountByParentId}
            onSelect={onSelect}
            onDelete={onDelete}
            onMove={onMove}
            onRename={onRename}
            t={t}
          />
          <KnowledgeFolderBrowserSection
            title={t("notes.knowledgeFolderChildFolders")}
            items={childSections.folders}
            documents={documents}
            childCountByParentId={childCountByParentId}
            onSelect={onSelect}
            onDelete={onDelete}
            onMove={onMove}
            onRename={onRename}
            t={t}
          />
          <KnowledgeFolderBrowserSection
            title={t("notes.knowledgeFolderChildDocuments")}
            items={childSections.documents}
            documents={documents}
            childCountByParentId={childCountByParentId}
            onSelect={onSelect}
            onDelete={onDelete}
            onMove={onMove}
            onRename={onRename}
            t={t}
          />
          <KnowledgeFolderBrowserSection
            title={t("notes.knowledgeOrphanedDocument", { defaultValue: "Orphaned" })}
            items={childSections.orphaned}
            documents={documents}
            childCountByParentId={childCountByParentId}
            onSelect={onSelect}
            onDelete={onDelete}
            onMove={onMove}
            onRename={onRename}
            t={t}
          />
        </div>
      )}
    </div>
  );
}

function KnowledgeFolderBrowserSection({
  title,
  items,
  documents,
  childCountByParentId,
  onSelect,
  onDelete,
  onMove,
  onRename,
  t,
}: {
  title: string;
  items: KnowledgeDocument[];
  documents: KnowledgeDocument[];
  childCountByParentId: Map<string, number>;
  onSelect: (document: KnowledgeDocument) => void;
  onDelete: (document: KnowledgeDocument) => void;
  onMove: (document: KnowledgeDocument, parentId?: string | null) => void;
  onRename: (document: KnowledgeDocument, title: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  if (items.length === 0) return null;

  return (
    <section className="min-w-0">
      <div className="mb-2 flex min-w-0 items-center justify-between gap-3 px-0.5">
        <p className="truncate text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          {title}
        </p>
        <span className="shrink-0 text-[11px] font-medium tabular-nums text-muted-foreground">
          {items.length}
        </span>
      </div>
      <div className="overflow-hidden border-y border-border/35 bg-background">
        <div className="hidden grid-cols-[minmax(0,1.25fr)_minmax(8rem,0.75fr)_5.5rem_3rem_4.5rem] border-b border-border/30 px-1 py-1.5 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/80 md:grid">
          <span>{t("notes.knowledgeDocuments")}</span>
          <span>{t("notes.knowledgeDocumentPath")}</span>
          <span className="text-right">
            {t("notes.knowledgeUpdated", { defaultValue: "Updated" })}
          </span>
          <span className="text-right">{t("notes.knowledgeDocumentFolder")}</span>
          <span />
        </div>
        {items.map((document) => (
          <KnowledgeFolderBrowserRow
            key={document.id}
            document={document}
            documents={documents}
            childCountByParentId={childCountByParentId}
            onSelect={onSelect}
            onDelete={onDelete}
            onMove={onMove}
            onRename={onRename}
            t={t}
          />
        ))}
      </div>
    </section>
  );
}

function knowledgeDocumentMoveTargets(
  document: KnowledgeDocument,
  documents: KnowledgeDocument[],
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  return createKnowledgeDocumentMoveTargets(document, documents, {
    rootTitle: t("notes.knowledgeVaultRoot", { defaultValue: "Knowledge base" }),
    rootTargetTitle: t("notes.knowledgeMoveRoot"),
    untitledTitle: t("notes.knowledgeUntitledDocument"),
    orphanedParentTitle: t("notes.knowledgeOrphanedDocument", { defaultValue: "Orphaned" }),
  });
}

function KnowledgeInlineRenameField({
  value,
  placeholder,
  onChange,
  onCommit,
  onCancel,
  ariaLabel,
  className,
}: {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  ariaLabel: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, []);

  return (
    <input
      ref={inputRef}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
      onBlur={onCommit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          onCancel();
        }
      }}
      aria-label={ariaLabel}
      className={cn(
        "h-7 min-w-0 rounded-md border border-primary/35 bg-background px-2 text-xs font-medium text-foreground shadow-sm outline-none ring-2 ring-primary/10 transition focus:ring-primary/20",
        className,
      )}
    />
  );
}

function KnowledgeFolderBrowserRow({
  document,
  documents,
  childCountByParentId,
  onSelect,
  onDelete,
  onMove,
  onRename,
  t,
}: {
  document: KnowledgeDocument;
  documents: KnowledgeDocument[];
  childCountByParentId: Map<string, number>;
  onSelect: (document: KnowledgeDocument) => void;
  onDelete: (document: KnowledgeDocument) => void;
  onMove: (document: KnowledgeDocument, parentId?: string | null) => void;
  onRename: (document: KnowledgeDocument, title: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const isFolder = document.type === "folder";
  const Icon = isFolder ? FolderOpen : document.type === "book_home" ? BookOpen : FileText;
  const childCount = childCountByParentId.get(document.id) ?? 0;
  const updatedLabel = formatKnowledgeDocumentUpdatedDate(document);
  const parentPathLabel = knowledgeDocumentPath(document, documents, t)
    .slice(0, -1)
    .map((item) => item.title)
    .join(" / ");
  const meta = isFolder
    ? t("notes.knowledgeFolderChildCount", { count: childCount })
    : document.excerpt;
  const metaParts = [knowledgeDocumentTypeLabel(document, t), meta].filter(Boolean);
  const canDelete =
    canDeleteKnowledgeDocument(document) && !(document.type === "folder" && childCount > 0);
  const moveTargets = knowledgeDocumentMoveTargets(document, documents, t);
  const displayTitle = document.title.trim() || t("notes.knowledgeUntitledDocument");
  const renamePlaceholder = t("notes.knowledgeUntitledDocument");
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState(document.title.trim());

  useEffect(() => {
    if (!isRenaming) setRenameDraft(document.title.trim());
  }, [document.title, isRenaming]);

  const cancelRename = () => {
    setRenameDraft(document.title.trim());
    setIsRenaming(false);
  };

  const commitRename = () => {
    const nextTitle = renameDraft.trim();
    setIsRenaming(false);
    if (!nextTitle || nextTitle === document.title.trim()) {
      setRenameDraft(document.title.trim());
      return;
    }
    onRename(document, nextTitle);
  };

  return (
    <div className="group flex w-full items-center gap-2.5 border-b border-border/30 px-1 py-1 transition-colors last:border-b-0 hover:bg-muted/20">
      {isRenaming ? (
        <div className="grid min-h-10 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] items-center gap-2 rounded-sm py-1 pr-1 text-left md:grid-cols-[minmax(0,1.25fr)_minmax(8rem,0.75fr)_5.5rem_3rem]">
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-sm",
                isFolder ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <KnowledgeInlineRenameField
                value={renameDraft}
                placeholder={renamePlaceholder}
                onChange={setRenameDraft}
                onCommit={commitRename}
                onCancel={cancelRename}
                ariaLabel={t("notes.knowledgeRenameDocument")}
                className="w-full text-sm"
              />
              <span
                className="mt-0.5 block truncate text-[11px] text-muted-foreground md:hidden"
                title={parentPathLabel}
              >
                {metaParts.join(" · ")}
              </span>
            </span>
          </span>
          <span
            className="hidden truncate text-[11px] text-muted-foreground md:block"
            title={parentPathLabel}
          >
            {parentPathLabel || t("notes.knowledgeVaultRoot", { defaultValue: "Knowledge base" })}
          </span>
          <span className="hidden shrink-0 text-right text-[11px] font-medium text-muted-foreground md:block">
            {updatedLabel || "-"}
          </span>
          <span className="hidden shrink-0 text-right text-[11px] font-medium text-muted-foreground md:block">
            {isFolder ? childCount : "-"}
          </span>
        </div>
      ) : (
        <button
          type="button"
          className="grid min-h-10 min-w-0 flex-1 grid-cols-[minmax(0,1fr)] items-center gap-2 rounded-sm py-1 pr-1 text-left focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/45 md:grid-cols-[minmax(0,1.25fr)_minmax(8rem,0.75fr)_5.5rem_3rem]"
          onClick={() => onSelect(document)}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-sm",
                isFolder ? "text-primary" : "text-muted-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-foreground group-hover:text-primary">
                {displayTitle}
              </span>
              <span
                className="mt-0.5 block truncate text-[11px] text-muted-foreground md:hidden"
                title={parentPathLabel}
              >
                {metaParts.join(" · ")}
              </span>
            </span>
          </span>
          <span
            className="hidden truncate text-[11px] text-muted-foreground md:block"
            title={parentPathLabel}
          >
            {parentPathLabel || t("notes.knowledgeVaultRoot", { defaultValue: "Knowledge base" })}
          </span>
          <span className="hidden shrink-0 text-right text-[11px] font-medium text-muted-foreground md:block">
            {updatedLabel || "-"}
          </span>
          <span className="hidden shrink-0 text-right text-[11px] font-medium text-muted-foreground md:block">
            {isFolder ? childCount : "-"}
          </span>
        </button>
      )}

      <div className="flex h-7 shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        {!isRenaming ? (
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
            onClick={() => setIsRenaming(true)}
            aria-label={t("notes.knowledgeRenameDocument")}
            title={t("notes.knowledgeRenameDocument")}
          >
            <Edit3 className="h-3.5 w-3.5" />
          </button>
        ) : null}
        {moveTargets.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                aria-label={t("notes.knowledgeMoveDocument")}
                title={t("notes.knowledgeMoveDocument")}
              >
                <FolderDown className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-72 min-w-64 overflow-y-auto">
              <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {t("notes.knowledgeMoveTo")}
              </div>
              {moveTargets.map((target) => (
                <DropdownMenuItem
                  key={target.id ?? "__root__"}
                  onClick={() => onMove(document, target.id)}
                  className="items-start py-2 text-xs"
                  title={target.path}
                >
                  <span
                    className="inline-flex min-w-0 items-start gap-2"
                    style={{ paddingLeft: `${Math.min(target.depth, 7) * 10}px` }}
                  >
                    {target.id ? (
                      <Folder className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <FolderUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{target.title}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                        {target.path}
                      </span>
                    </span>
                  </span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {canDelete ? (
          <button
            type="button"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            onClick={() => onDelete(document)}
            aria-label={t("notes.knowledgeDeleteDocument")}
            title={t("notes.knowledgeDeleteDocument")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : null}
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-50 transition-opacity group-hover:opacity-100" />
      </div>
    </div>
  );
}

function KnowledgeTagEditor({
  tags,
  onChange,
  t,
  compact = false,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  compact?: boolean;
}) {
  const [draft, setDraft] = useState("");

  const commitDraft = (rawValue = draft) => {
    const nextTags = rawValue
      .split(/[,\uFF0C]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    if (nextTags.length === 0) {
      setDraft("");
      return;
    }
    onChange(normalizeKnowledgeTags([...tags, ...nextTags]));
    setDraft("");
  };

  const removeTag = (tag: string) => {
    onChange(tags.filter((item) => item !== tag));
  };

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-1.5",
        compact ? "max-w-none" : "mt-3 max-w-2xl",
      )}
    >
      {tags.map((tag) => (
        <span
          key={tag}
          className={cn(
            "group inline-flex items-center gap-1.5 rounded-sm border border-border/45 bg-muted/30 text-xs text-foreground/90",
            compact ? "h-6 px-1.5" : "h-7 px-2",
          )}
        >
          <span className="max-w-28 truncate">{tag}</span>
          <button
            type="button"
            className="rounded-sm text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            onClick={() => removeTag(tag)}
            aria-label={t("notes.knowledgeTagRemove", { tag })}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <label
        className={cn(
          "inline-flex min-w-28 flex-1 items-center gap-1.5 rounded-sm border border-dashed border-border/65 bg-transparent text-xs text-muted-foreground transition-colors focus-within:border-primary/45 focus-within:bg-background",
          compact ? "h-6 px-1.5" : "h-7 px-2",
        )}
      >
        <Tag className="h-3 w-3 shrink-0" />
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => commitDraft()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              commitDraft();
            }
          }}
          aria-label={t("notes.knowledgeTagInputLabel")}
          placeholder={
            tags.length > 0 ? t("notes.knowledgeTagPlaceholder") : t("notes.knowledgeTags")
          }
          className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
        />
      </label>
    </div>
  );
}

function knowledgeLinkTargetLabel(
  link: KnowledgeLink,
  highlights: HighlightWithBook[],
  t: (key: string, options?: Record<string, unknown>) => string,
): { title: string; detail: string; cfi?: string } {
  if (link.toKind === "highlight") {
    const highlight = highlights.find((item) => item.id === link.toId);
    return {
      title: link.label || highlight?.chapterTitle || t("notes.knowledgeSourceHighlight"),
      detail: highlight?.text || link.toId,
      cfi: link.cfi || highlight?.cfi,
    };
  }

  if (link.toKind === "cfi") {
    return {
      title: link.label || t("notes.knowledgeSourcePosition"),
      detail: link.cfi || link.toId,
      cfi: link.cfi || link.toId,
    };
  }

  if (link.toKind === "book") {
    return {
      title: link.label || t("notes.knowledgeSourceBook"),
      detail: link.toId,
    };
  }

  return {
    title: link.label || t("notes.knowledgeSourceReference"),
    detail: link.toId,
    cfi: link.cfi,
  };
}

function KnowledgeDocumentOutlinePanel({
  outline,
  onSelectItem,
  t,
}: {
  outline: KnowledgeDocumentOutlineItem[];
  onSelectItem: (item: KnowledgeDocumentOutlineItem) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <div className="border-b border-border/35 bg-background/55 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ListTree className="h-3.5 w-3.5 shrink-0 text-primary" />
          <p className="truncate text-xs font-semibold text-foreground">
            {t("notes.knowledgeDocumentOutline")}
          </p>
        </div>
        {outline.length > 0 ? (
          <span className="text-[11px] text-muted-foreground">{outline.length}</span>
        ) : null}
      </div>

      {outline.length === 0 ? (
        <p className="rounded-md bg-muted/30 px-2.5 py-3 text-xs leading-relaxed text-muted-foreground">
          {t("notes.knowledgeDocumentOutlineEmpty")}
        </p>
      ) : (
        <div className="space-y-1">
          {outline.map((item) => (
            <button
              key={item.id}
              type="button"
              className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-foreground/90 transition-colors hover:bg-muted/55 focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/45"
              style={{ paddingLeft: `${8 + Math.min(item.level - 1, 4) * 12}px` }}
              onClick={() => onSelectItem(item)}
              title={item.title}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/45" />
              <span className="w-5 shrink-0 text-[10px] font-medium text-muted-foreground">
                H{item.level}
              </span>
              <span className="truncate">{item.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function KnowledgeRelationsPanel({
  links,
  backlinks,
  documents,
  highlights,
  isLoading,
  onSelectDocument,
  onOpenBook,
  t,
}: {
  links: KnowledgeLink[];
  backlinks: KnowledgeBacklink[];
  documents: KnowledgeDocument[];
  highlights: HighlightWithBook[];
  isLoading: boolean;
  onSelectDocument: (document: KnowledgeDocument) => void;
  onOpenBook: (cfi?: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const sourceLinks = links.filter((link) => link.relation === "source").slice(0, 4);
  const relatedLinks = links.filter((link) => link.relation !== "source").slice(0, 4);
  const visibleBacklinks = backlinks.slice(0, 4);
  const documentById = useMemo(
    () => new Map(documents.map((document) => [document.id, document])),
    [documents],
  );

  return (
    <div className="border-b border-border/35 bg-background/55 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Link2 className="h-3.5 w-3.5 text-primary" />
          <p className="text-xs font-semibold text-foreground">{t("notes.knowledgeRelations")}</p>
        </div>
        {isLoading ? (
          <span className="text-[11px] text-muted-foreground">
            {t("notes.knowledgeRelationsLoading")}
          </span>
        ) : null}
      </div>

      <div className="space-y-3">
        <div>
          <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
            {t("notes.knowledgeSourceLinks")}
          </p>
          {sourceLinks.length === 0 ? (
            <p className="rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
              {t("notes.knowledgeNoSourceLinks")}
            </p>
          ) : (
            <div className="space-y-1.5">
              {sourceLinks.map((link) => {
                const targetDocument =
                  link.toKind === "document" ? documentById.get(link.toId) : undefined;
                const target = targetDocument
                  ? {
                      title:
                        link.label || targetDocument.title || t("notes.knowledgeUntitledDocument"),
                      detail: knowledgeDocumentPathLabel(targetDocument, documents, t),
                      cfi: undefined,
                    }
                  : knowledgeLinkTargetLabel(link, highlights, t);
                const canOpenDocument = !!targetDocument;
                const canOpenBook = !canOpenDocument && (!!target.cfi || link.toKind === "book");
                return (
                  <button
                    key={link.id}
                    type="button"
                    className="w-full rounded-md border border-border/40 bg-background px-2.5 py-2 text-left transition-colors enabled:hover:border-primary/30 enabled:hover:bg-primary/5 disabled:cursor-default"
                    onClick={() => {
                      if (targetDocument) {
                        onSelectDocument(targetDocument);
                        return;
                      }
                      onOpenBook(target.cfi);
                    }}
                    disabled={!canOpenDocument && !canOpenBook}
                    title={
                      canOpenDocument
                        ? t("notes.knowledgeOpenRelatedDocument")
                        : canOpenBook
                          ? t("notes.knowledgeOpenRelation")
                          : undefined
                    }
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      {targetDocument ? (
                        <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                      ) : null}
                      <p className="truncate text-xs font-medium text-foreground">{target.title}</p>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                      {target.detail}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
            {t("notes.knowledgeRelatedLinks")}
          </p>
          {relatedLinks.length === 0 ? (
            <p className="rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
              {t("notes.knowledgeNoRelatedLinks")}
            </p>
          ) : (
            <div className="space-y-1.5">
              {relatedLinks.map((link) => {
                const targetDocument =
                  link.toKind === "document" ? documentById.get(link.toId) : undefined;
                const target = targetDocument
                  ? {
                      title:
                        link.label || targetDocument.title || t("notes.knowledgeUntitledDocument"),
                      detail: knowledgeDocumentPathLabel(targetDocument, documents, t),
                      cfi: undefined,
                    }
                  : knowledgeLinkTargetLabel(link, highlights, t);
                const canOpenDocument = !!targetDocument;
                const canOpenBook = !canOpenDocument && (!!target.cfi || link.toKind === "book");

                return (
                  <button
                    key={link.id}
                    type="button"
                    className="w-full rounded-md border border-border/40 bg-background px-2.5 py-2 text-left transition-colors enabled:hover:border-primary/30 enabled:hover:bg-primary/5 disabled:cursor-default"
                    onClick={() => {
                      if (targetDocument) {
                        onSelectDocument(targetDocument);
                        return;
                      }
                      onOpenBook(target.cfi);
                    }}
                    disabled={!canOpenDocument && !canOpenBook}
                    title={
                      canOpenDocument
                        ? t("notes.knowledgeOpenRelatedDocument")
                        : canOpenBook
                          ? t("notes.knowledgeOpenRelation")
                          : undefined
                    }
                  >
                    <div className="flex min-w-0 items-center gap-1.5">
                      {targetDocument ? (
                        <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                      ) : null}
                      <p className="truncate text-xs font-medium text-foreground">{target.title}</p>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                      {target.detail}
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div>
          <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
            {t("notes.knowledgeBacklinks")}
          </p>
          {visibleBacklinks.length === 0 ? (
            <p className="rounded-md bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
              {t("notes.knowledgeNoBacklinks")}
            </p>
          ) : (
            <div className="space-y-1.5">
              {visibleBacklinks.map(({ link, fromDocument }) => (
                <button
                  key={link.id}
                  type="button"
                  className="w-full rounded-md border border-border/40 bg-background px-2.5 py-2 text-left transition-colors hover:border-primary/30 hover:bg-primary/5"
                  onClick={() => onSelectDocument(fromDocument)}
                >
                  <p className="truncate text-xs font-medium text-foreground">
                    {fromDocument.title || t("notes.knowledgeUntitledDocument")}
                  </p>
                  <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                    {knowledgeDocumentPathLabel(fromDocument, documents, t)}
                  </p>
                  {fromDocument.excerpt ? (
                    <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                      {fromDocument.excerpt}
                    </p>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function KnowledgeSummaryMemoryCard({
  document,
  isCompressing,
  onCompress,
  t,
}: {
  document: KnowledgeDocument;
  isCompressing: boolean;
  onCompress: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const summary = document.summaryMd?.trim();
  const updatedAt = document.summaryUpdatedAt;
  const isStale =
    !!summary &&
    document.summarySourceFingerprint !== createKnowledgeSummarySourceFingerprint(document);
  const statusLabel = !summary
    ? t("notes.knowledgeSummaryMissing")
    : isStale
      ? t("notes.knowledgeSummaryStale")
      : t("notes.knowledgeSummaryReady");

  return (
    <div className="border-b border-border/35 bg-background/55 p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Brain className="h-3.5 w-3.5 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground">
              {t("notes.knowledgeSummaryMemory")}
            </p>
            <p
              className={cn(
                "mt-0.5 text-[11px]",
                !summary ? "text-muted-foreground" : isStale ? "text-foreground" : "text-primary",
              )}
            >
              {statusLabel}
            </p>
          </div>
        </div>
        <button
          type="button"
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-background px-2 text-[11px] font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onCompress}
          disabled={isCompressing}
        >
          {isCompressing ? (
            <span className="h-3 w-3 animate-spin rounded-full border border-primary/30 border-t-primary" />
          ) : (
            <Sparkles className="h-3 w-3 text-primary" />
          )}
          {isCompressing
            ? t("notes.knowledgeSummaryCompressing")
            : t("notes.knowledgeSummaryCompress")}
        </button>
      </div>

      {summary ? (
        <div className="rounded-md border border-border/40 bg-background px-2.5 py-2">
          <div className="max-h-36 overflow-hidden text-[11px] leading-relaxed text-muted-foreground">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h1: ({ children }) => (
                  <p className="mb-1 text-xs font-semibold text-foreground">{children}</p>
                ),
                h2: ({ children }) => (
                  <p className="mb-1 text-xs font-semibold text-foreground">{children}</p>
                ),
                h3: ({ children }) => (
                  <p className="mb-1 text-[11px] font-semibold text-foreground">{children}</p>
                ),
                p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                ul: ({ children }) => <ul className="mb-1 list-disc pl-4 last:mb-0">{children}</ul>,
                ol: ({ children }) => (
                  <ol className="mb-1 list-decimal pl-4 last:mb-0">{children}</ol>
                ),
                li: ({ children }) => <li className="mb-0.5">{children}</li>,
              }}
            >
              {summary}
            </ReactMarkdown>
          </div>
          {updatedAt ? (
            <p className="mt-2 border-t border-border/40 pt-1.5 text-[10px] text-muted-foreground">
              {t("notes.knowledgeSummaryUpdatedAt", {
                time: new Date(updatedAt).toLocaleString(),
              })}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="rounded-md bg-muted/30 px-2.5 py-3 text-xs leading-relaxed text-muted-foreground">
          {t("notes.knowledgeSummaryPreview")}
        </p>
      )}
    </div>
  );
}

function knowledgeDocumentTypeLabel(
  document: KnowledgeDocument,
  t: (key: string) => string,
): string {
  if (document.type === "book_home") return t("notes.knowledgeDocumentHome");
  if (document.type === "review") return t("notes.knowledgeDocumentReview");
  if (document.type === "summary") return t("notes.knowledgeDocumentSummary");
  if (document.type === "highlight_note") return t("notes.knowledgeDocumentHighlight");
  if (document.type === "folder") return t("notes.knowledgeDocumentFolder");
  return t("notes.knowledgeDocumentNote");
}

function formatKnowledgeDocumentUpdatedDate(
  document: Pick<KnowledgeDocument, "updatedAt">,
): string {
  if (!Number.isFinite(document.updatedAt)) return "";
  return new Date(document.updatedAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function knowledgeDocumentPath(
  document: KnowledgeDocument,
  documents: KnowledgeDocument[],
  t: (key: string, options?: Record<string, unknown>) => string,
  activeTitle?: string,
): { id: string; title: string; type?: KnowledgeDocumentType }[] {
  const path = resolveKnowledgeDocumentPath(document, documents);

  return [
    {
      id: "__vault__",
      title: t("notes.knowledgeVaultRoot", { defaultValue: "Knowledge base" }),
    },
    ...path.map((item, index) => ({
      id: item.id,
      type: item.type,
      title:
        index === path.length - 1 && activeTitle?.trim()
          ? activeTitle.trim()
          : item.title.trim() || t("notes.knowledgeUntitledDocument"),
    })),
  ];
}

function knowledgeDocumentPathLabel(
  document: KnowledgeDocument,
  documents: KnowledgeDocument[],
  t: (key: string, options?: Record<string, unknown>) => string,
  activeTitle?: string,
): string {
  return knowledgeDocumentPath(document, documents, t, activeTitle)
    .map((item) => item.title)
    .join(" / ");
}

function KnowledgeDocumentBreadcrumbs({
  document,
  documents,
  activeTitle,
  onSelectRoot,
  onSelectDocument,
  t,
  className,
}: {
  document: KnowledgeDocument;
  documents: KnowledgeDocument[];
  activeTitle?: string;
  onSelectRoot?: () => void;
  onSelectDocument?: (document: KnowledgeDocument) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
  className?: string;
}) {
  const path = knowledgeDocumentPath(document, documents, t, activeTitle);
  const documentById = useMemo(
    () => new Map(documents.map((item) => [item.id, item])),
    [documents],
  );

  return (
    <nav
      className={cn(
        "flex min-w-0 items-center gap-x-1 overflow-x-auto whitespace-nowrap text-[11px] font-medium text-muted-foreground",
        className,
      )}
      aria-label={t("notes.knowledgeDocumentPath", { defaultValue: "Document path" })}
    >
      {path.map((item, index) => {
        const targetDocument = documentById.get(item.id);
        const isLast = index === path.length - 1;
        const isRoot = item.id === "__vault__";
        const isClickable =
          !isLast && ((isRoot && !!onSelectRoot) || (!!targetDocument && !!onSelectDocument));

        return (
          <span key={item.id} className="inline-flex min-w-0 items-center gap-1">
            {index > 0 ? <span className="text-border/80">/</span> : null}
            {isClickable ? (
              <button
                type="button"
                className="inline-flex max-w-[12rem] items-center gap-1 truncate px-0.5 py-0.5 text-muted-foreground transition-colors hover:text-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/45"
                onClick={() => {
                  if (isRoot) {
                    onSelectRoot?.();
                    return;
                  }
                  if (targetDocument) onSelectDocument?.(targetDocument);
                }}
                title={item.title}
              >
                {isRoot || item.type === "folder" ? <Folder className="h-3 w-3 shrink-0" /> : null}
                {item.title}
              </button>
            ) : (
              <span
                className={cn(
                  "inline-flex max-w-[12rem] items-center gap-1 truncate px-0.5 py-0.5",
                  isLast ? "text-foreground" : "text-muted-foreground",
                )}
                title={item.title}
              >
                {item.id === "__vault__" || item.type === "folder" ? (
                  <Folder className="h-3 w-3 shrink-0" />
                ) : null}
                {item.title}
              </span>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function KnowledgePathInline({
  path,
  documents,
  onSelectRoot,
  onSelectDocument,
  ariaLabel,
  title,
}: {
  path: Array<{ id: string; title: string; type?: KnowledgeDocumentType }>;
  documents: KnowledgeDocument[];
  onSelectRoot: () => void;
  onSelectDocument: (document: KnowledgeDocument) => void;
  ariaLabel: string;
  title?: string;
}) {
  const documentById = useMemo(
    () => new Map(documents.map((item) => [item.id, item])),
    [documents],
  );

  return (
    <nav
      className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap"
      aria-label={ariaLabel}
      title={title}
    >
      {path.map((item, index) => {
        const targetDocument = documentById.get(item.id);
        const isRoot = item.id === "__vault__";
        const isLast = index === path.length - 1;
        const canNavigate = !isLast && (isRoot || !!targetDocument);

        return (
          <span key={`${item.id}-${index}`} className="inline-flex min-w-0 items-center gap-1">
            {index > 0 ? <span className="text-border/80">/</span> : null}
            <button
              type="button"
              disabled={!canNavigate}
              className={cn(
                "inline-flex h-6 max-w-[12rem] min-w-0 items-center gap-1 px-0.5 text-[11px] font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-primary/45",
                isLast
                  ? "cursor-default text-foreground"
                  : "text-muted-foreground hover:text-primary",
                !canNavigate && !isLast && "cursor-default opacity-70",
              )}
              onClick={() => {
                if (!canNavigate) return;
                if (isRoot) {
                  onSelectRoot();
                  return;
                }
                if (targetDocument) onSelectDocument(targetDocument);
              }}
            >
              <span className="truncate">{item.title}</span>
            </button>
          </span>
        );
      })}
    </nav>
  );
}

function KnowledgeDocumentExplorer({
  documents,
  activeDocumentId,
  isRootActive,
  isCreating,
  onSelectRoot,
  onSelect,
  onCreate,
  onDelete,
  onMove,
  onRename,
  t,
}: {
  documents: KnowledgeDocument[];
  activeDocumentId: string | null;
  isRootActive: boolean;
  isCreating: boolean;
  onSelectRoot: () => void;
  onSelect: (document: KnowledgeDocument) => void;
  onCreate: (type?: CreatableKnowledgeDocumentType, parentId?: string) => void;
  onDelete: (document: KnowledgeDocument) => void;
  onMove: (document: KnowledgeDocument, parentId?: string | null) => void;
  onRename: (document: KnowledgeDocument, title: string) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const [query, setQuery] = useState("");
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => new Set());
  const [renamingDocumentId, setRenamingDocumentId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const homeDocumentId = documents.find((document) => document.type === "book_home")?.id;
  const tree = useMemo(
    () => buildKnowledgeDocumentTree(documents, homeDocumentId),
    [documents, homeDocumentId],
  );
  const childCountByParentId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const document of documents) {
      if (!document.parentId) continue;
      counts.set(document.parentId, (counts.get(document.parentId) ?? 0) + 1);
    }
    return counts;
  }, [documents]);
  const activeDocument = documents.find((document) => document.id === activeDocumentId) ?? null;
  const activePathItems = useMemo(
    () =>
      isRootActive
        ? [
            {
              id: "__vault__",
              title: t("notes.knowledgeVaultRoot", { defaultValue: "Knowledge base" }),
            },
          ]
        : activeDocument
          ? knowledgeDocumentPath(activeDocument, documents, t)
          : [
              {
                id: "__vault__",
                title: t("notes.knowledgeVaultRoot", { defaultValue: "Knowledge base" }),
              },
            ],
    [activeDocument, documents, isRootActive, t],
  );
  const activePath = activePathItems.map((item) => item.title).join(" / ");
  const activePathIds = useMemo(
    () =>
      new Set(
        activeDocument
          ? knowledgeDocumentPath(activeDocument, documents, t)
              .map((item) => item.id)
              .filter((id) => id !== "__vault__")
          : [],
      ),
    [activeDocument, documents, t],
  );
  const activeCreateParentId = getKnowledgeDocumentCreateParentId({
    document: activeDocument,
    isVaultRootOpen: isRootActive,
  });
  const createDestinationDocument = activeCreateParentId
    ? documents.find((document) => document.id === activeCreateParentId)
    : null;
  const createDestinationPath = createDestinationDocument
    ? knowledgeDocumentPath(createDestinationDocument, documents, t)
        .map((item) => item.title)
        .join(" / ")
    : t("notes.knowledgeVaultRoot", { defaultValue: "Knowledge base" });
  const normalizedQuery = query.trim().toLowerCase();
  const flatNodes = useMemo(() => flattenKnowledgeDocumentTree(tree.roots), [tree]);
  const orphanedDocumentIds = useMemo(
    () => new Set(tree.orphaned.map((document) => document.id)),
    [tree],
  );
  const folderCount = useMemo(
    () => documents.filter((document) => document.type === "folder").length,
    [documents],
  );
  const visibleSearchNodes = useMemo(() => {
    return filterKnowledgeDocumentTreeNodesForSearch(flatNodes, documents, normalizedQuery, {
      rootTitle: t("notes.knowledgeVaultRoot", { defaultValue: "Knowledge base" }),
      untitledTitle: t("notes.knowledgeUntitledDocument"),
      orphanedParentTitle: t("notes.knowledgeOrphanedDocument", { defaultValue: "Orphaned" }),
      getTypeLabel: (document) => knowledgeDocumentTypeLabel(document, t),
    });
  }, [documents, flatNodes, normalizedQuery, t]);

  useEffect(() => {
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      if (activeDocument?.type === "folder") next.add(activeDocument.id);

      let parentId = activeDocument?.parentId;
      while (parentId) {
        next.add(parentId);
        parentId = documents.find((document) => document.id === parentId)?.parentId;
      }

      return next;
    });
  }, [activeDocument?.id, activeDocument?.parentId, activeDocument?.type, documents]);

  const toggleFolder = (id: string) => {
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startRename = (document: KnowledgeDocument) => {
    setRenamingDocumentId(document.id);
    setRenameDraft(document.title.trim());
  };

  const cancelRename = () => {
    setRenamingDocumentId(null);
    setRenameDraft("");
  };

  const commitRename = (document: KnowledgeDocument) => {
    const nextTitle = renameDraft.trim();
    setRenamingDocumentId(null);
    setRenameDraft("");
    if (!nextTitle || nextTitle === document.title.trim()) return;
    onRename(document, nextTitle);
  };

  const renderNode = (node: KnowledgeDocumentTreeNode): ReactNode => {
    const document = node.document;
    const isFolder = document.type === "folder";
    const isExpanded = expandedFolderIds.has(document.id);
    const isActive = document.id === activeDocumentId;
    const isInActivePath = !isActive && activePathIds.has(document.id);
    const isOrphaned = orphanedDocumentIds.has(document.id);
    const title = document.title.trim() || t("notes.knowledgeUntitledDocument");
    const childCount = childCountByParentId.get(document.id) ?? 0;
    const searchPath = normalizedQuery
      ? knowledgeDocumentPath(document, documents, t)
          .slice(1, -1)
          .map((item) => item.title)
          .join(" / ")
      : "";
    const canDelete =
      canDeleteKnowledgeDocument(document) && !(document.type === "folder" && childCount > 0);
    const moveTargets = knowledgeDocumentMoveTargets(document, documents, t);
    const Icon = isFolder ? (isExpanded ? FolderOpen : Folder) : FileText;
    const isRenaming = renamingDocumentId === document.id;

    return (
      <div key={document.id}>
        <div
          role="treeitem"
          aria-level={node.depth + 1}
          aria-selected={isActive}
          aria-expanded={isFolder && !normalizedQuery ? isExpanded : undefined}
          className={cn(
            "group relative flex min-h-8 items-center gap-1 rounded-md border border-transparent pr-1 transition-colors",
            isActive
              ? "border-primary/25 bg-background text-primary shadow-[inset_2px_0_0_var(--primary)]"
              : isInActivePath
                ? "border-border/45 bg-background/85 text-foreground shadow-[inset_2px_0_0_hsl(var(--border))]"
                : "text-foreground hover:border-border/55 hover:bg-background/75",
          )}
          style={{ paddingLeft: `${8 + Math.min(node.depth, 7) * 14}px` }}
        >
          {node.depth > 0 ? (
            <span
              className="pointer-events-none absolute bottom-1 top-1 w-px bg-border/55"
              style={{ left: `${11 + Math.min(node.depth - 1, 6) * 14}px` }}
            />
          ) : null}
          {isFolder ? (
            <button
              type="button"
              className="flex h-6 w-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              onClick={(event) => {
                event.stopPropagation();
                toggleFolder(document.id);
              }}
              aria-label={
                isExpanded ? t("notes.knowledgeCollapseFolder") : t("notes.knowledgeExpandFolder")
              }
              title={
                isExpanded ? t("notes.knowledgeCollapseFolder") : t("notes.knowledgeExpandFolder")
              }
            >
              <ChevronRight
                className={cn("h-3.5 w-3.5 transition-transform", isExpanded && "rotate-90")}
              />
            </button>
          ) : (
            <span className="h-6 w-5 shrink-0" />
          )}

          {isRenaming ? (
            <div className="flex min-w-0 flex-1 items-center gap-2 py-1">
              <Icon
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  isActive
                    ? "text-primary"
                    : isFolder
                      ? "text-foreground/75"
                      : "text-muted-foreground",
                )}
              />
              <KnowledgeInlineRenameField
                value={renameDraft}
                placeholder={t("notes.knowledgeUntitledDocument")}
                onChange={setRenameDraft}
                onCommit={() => commitRename(document)}
                onCancel={cancelRename}
                ariaLabel={t("notes.knowledgeRenameDocument")}
                className="h-6 flex-1"
              />
            </div>
          ) : (
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
              onClick={() => onSelect(document)}
            >
              <Icon
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  isActive
                    ? "text-primary"
                    : isFolder
                      ? "text-foreground/75"
                      : "text-muted-foreground",
                )}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate text-xs font-medium",
                    isActive ? "text-primary" : "text-foreground",
                  )}
                >
                  {title}
                </span>
                {!isFolder || isOrphaned || searchPath ? (
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {searchPath || (!isFolder ? knowledgeDocumentTypeLabel(document, t) : null)}
                    {isOrphaned ? (
                      <span
                        className={cn(
                          "inline-flex items-center gap-0.5 rounded-sm bg-amber-500/10 px-1 text-[10px] font-medium text-amber-700 dark:text-amber-300",
                          !isFolder && "ml-1",
                        )}
                      >
                        <AlertTriangle className="h-2.5 w-2.5" />
                        {t("notes.knowledgeOrphanedDocument", { defaultValue: "Orphaned" })}
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </span>
              {isFolder ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">{childCount}</span>
              ) : null}
            </button>
          )}

          <div className="flex h-6 shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {!isRenaming ? (
              <button
                type="button"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                onClick={(event) => {
                  event.stopPropagation();
                  startRename(document);
                }}
                aria-label={t("notes.knowledgeRenameDocument")}
                title={t("notes.knowledgeRenameDocument")}
              >
                <Edit3 className="h-3.5 w-3.5" />
              </button>
            ) : null}
            {moveTargets.length > 0 ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                    aria-label={t("notes.knowledgeMoveDocument")}
                    title={t("notes.knowledgeMoveDocument")}
                  >
                    <FolderDown className="h-3.5 w-3.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-72 min-w-64 overflow-y-auto">
                  <div className="px-2 py-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {t("notes.knowledgeMoveTo")}
                  </div>
                  {moveTargets.map((target) => (
                    <DropdownMenuItem
                      key={target.id ?? "__root__"}
                      onClick={() => onMove(document, target.id)}
                      className="items-start py-2 text-xs"
                      title={target.path}
                    >
                      <span
                        className="inline-flex min-w-0 items-start gap-2"
                        style={{ paddingLeft: `${Math.min(target.depth, 7) * 10}px` }}
                      >
                        {target.id ? (
                          <Folder className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        ) : (
                          <FolderUp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{target.title}</span>
                          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                            {target.path}
                          </span>
                        </span>
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {canDelete ? (
              <button
                type="button"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                onClick={() => onDelete(document)}
                aria-label={t("notes.knowledgeDeleteDocument")}
                title={t("notes.knowledgeDeleteDocument")}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
        </div>
        {isFolder && isExpanded && node.children.length > 0
          ? node.children.map((child) => renderNode(child))
          : null}
      </div>
    );
  };

  return (
    <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden border-r border-border/35 bg-muted/[0.16]">
      <div className="border-b border-border/35 bg-background/90 px-3 pb-3 pt-3">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary" />
              <p className="min-w-0 truncate text-xs font-semibold text-foreground">
                {t("notes.knowledgeVaultRoot", { defaultValue: "Knowledge base" })}
              </p>
            </div>
            <nav
              className="mt-2 flex min-w-0 items-center gap-x-1 overflow-x-auto whitespace-nowrap text-[10px] font-medium text-muted-foreground"
              title={activePath}
              aria-label={t("notes.knowledgeDocumentPath", { defaultValue: "Document path" })}
            >
              {activePathItems.map((item, index) => {
                const isCurrent = index === activePathItems.length - 1;
                const targetDocument = documents.find((document) => document.id === item.id);
                const isRoot = item.id === "__vault__";

                return (
                  <span
                    key={`${item.id}-${index}`}
                    className="inline-flex min-w-0 items-center gap-1"
                  >
                    {index > 0 ? <span className="text-border">/</span> : null}
                    <button
                      type="button"
                      disabled={(!targetDocument && !isRoot) || isCurrent}
                      onClick={() => {
                        if (isCurrent) return;
                        if (isRoot) {
                          onSelectRoot();
                          return;
                        }
                        if (!targetDocument) return;
                        onSelect(targetDocument);
                      }}
                      className={cn(
                        "inline-flex h-5 max-w-[9.5rem] min-w-0 items-center px-0.5 text-[10px] transition-colors",
                        isCurrent
                          ? "text-primary"
                          : "text-muted-foreground hover:text-foreground",
                        (!targetDocument || isCurrent) && "cursor-default",
                      )}
                    >
                      <span className="truncate">{item.title}</span>
                    </button>
                  </span>
                );
              })}
            </nav>
            <p
              className="mt-1.5 truncate text-[10px] font-medium text-muted-foreground"
              title={createDestinationPath}
            >
              {t("notes.knowledgeCreateIn", { defaultValue: "Create in" })} ·{" "}
              {createDestinationPath}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isCreating}
                aria-label={t("notes.knowledgeNewDocument")}
                title={t("notes.knowledgeNewDocument")}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onCreate("folder", activeCreateParentId)}>
                <Folder className="mr-2 h-4 w-4" />
                {t("notes.knowledgeNewFolder")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onCreate("standalone_note", activeCreateParentId)}>
                <FileText className="mr-2 h-4 w-4" />
                {t("notes.knowledgeNewNote")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCreate("review", activeCreateParentId)}>
                <NotebookPen className="mr-2 h-4 w-4" />
                {t("notes.knowledgeNewReview")}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCreate("summary", activeCreateParentId)}>
                <Sparkles className="mr-2 h-4 w-4" />
                {t("notes.knowledgeNewSummary")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("notes.knowledgeDocumentSearchPlaceholder")}
            className="h-8 border-border/55 bg-card pl-8 text-xs"
          />
        </div>
      </div>

      <div className="flex items-center justify-between border-b border-border/25 bg-background/65 px-3 py-1.5 text-[11px] text-muted-foreground">
        <span>
          {documents.length} {t("notes.knowledgeDocuments")}
        </span>
        <span>
          {folderCount} {t("notes.knowledgeDocumentFolder")}
        </span>
      </div>

      <div
        className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-2.5"
        role="tree"
        aria-label={`${t("notes.knowledgeVaultRoot", {
          defaultValue: "Knowledge base",
        })} ${t("notes.knowledgeDocuments")}`}
      >
        {!normalizedQuery ? (
          <div
            role="treeitem"
            aria-level={1}
            aria-selected={isRootActive}
            className={cn(
              "group relative mb-1 rounded-md border border-transparent transition-colors",
              isRootActive
                ? "border-primary/25 bg-background text-primary shadow-[inset_2px_0_0_var(--primary)]"
                : "text-foreground hover:border-border/55 hover:bg-background/75",
            )}
          >
            <button
              type="button"
              className="flex min-h-8 w-full items-center gap-2 px-2 py-1.5 text-left"
              onClick={onSelectRoot}
            >
              <FolderOpen
                className={cn(
                  "h-3.5 w-3.5 shrink-0",
                  isRootActive ? "text-primary" : "text-foreground/75",
                )}
              />
              <span className="min-w-0 flex-1">
                <span
                  className={cn(
                    "block truncate text-xs font-medium",
                    isRootActive ? "text-primary" : "text-foreground",
                  )}
                >
                  {t("notes.knowledgeVaultRoot", { defaultValue: "Knowledge base" })}
                </span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {t("notes.knowledgeFolderInside")}
                </span>
              </span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{documents.length}</span>
            </button>
          </div>
        ) : null}
        {normalizedQuery ? (
          visibleSearchNodes.length === 0 ? (
            <p className="rounded-md bg-muted/30 px-2.5 py-3 text-xs leading-relaxed text-muted-foreground">
              {t("notes.knowledgeNoDocumentResults")}
            </p>
          ) : (
            visibleSearchNodes.map((node) => renderNode({ ...node, depth: 0 }))
          )
        ) : tree.roots.length === 0 ? (
          <p className="rounded-md bg-muted/30 px-2.5 py-3 text-xs leading-relaxed text-muted-foreground">
            {t("notes.knowledgeNoDocumentResults")}
          </p>
        ) : (
          tree.roots.map((node) => renderNode(node))
        )}
      </div>
    </aside>
  );
}

function KnowledgeFolderOverview({
  folder,
  items,
  documents,
  isCreating,
  isExporting,
  onSelect,
  onCreate,
  onDelete,
  onMove,
  onRename,
  onExport,
  t,
}: {
  folder: KnowledgeDocument;
  items: KnowledgeDocument[];
  documents: KnowledgeDocument[];
  isCreating: boolean;
  isExporting: boolean;
  onSelect: (document: KnowledgeDocument) => void;
  onCreate: (type?: CreatableKnowledgeDocumentType, parentId?: string) => void;
  onDelete: (document: KnowledgeDocument) => void;
  onMove: (document: KnowledgeDocument, parentId?: string | null) => void;
  onRename: (document: KnowledgeDocument, title: string) => void;
  onExport: (document: KnowledgeDocument) => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const orderedChildren = useMemo(() => orderKnowledgeDocuments(items, undefined), [items]);
  const childSections = useMemo(
    () => createKnowledgeFolderDisplaySections(orderedChildren),
    [orderedChildren],
  );
  const folderPathItems = useMemo(
    () => knowledgeDocumentPath(folder, documents, t),
    [folder, documents, t],
  );
  const folderPathLabel = folderPathItems.map((item) => item.title).join(" / ");
  const childCountByParentId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const document of documents) {
      if (!document.parentId) continue;
      counts.set(document.parentId, (counts.get(document.parentId) ?? 0) + 1);
    }
    return counts;
  }, [documents]);

  return (
    <div className="w-full pb-10 pt-1">
      <div className="mb-4 flex items-center justify-between gap-4 border-b border-border/35 pb-3">
        <div className="min-w-0">
          <p className="flex min-w-0 items-center gap-1.5 truncate text-[11px] text-muted-foreground">
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary/80" />
            {folderPathLabel}
          </p>
          <h3 className="mt-1 truncate text-base font-semibold leading-tight text-foreground">
            {folder.title || t("notes.knowledgeUntitledDocument")}
          </h3>
          <p className="mt-1 truncate text-xs text-muted-foreground" title={folderPathLabel}>
            {orderedChildren.length} {t("notes.knowledgeDocuments")}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={isCreating}
            onClick={() => onCreate("folder", folder.id)}
          >
            <Folder className="mr-2 h-3.5 w-3.5" />
            {t("notes.knowledgeNewFolder")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8"
            disabled={isExporting}
            onClick={() => onExport(folder)}
          >
            <FolderUp className="mr-2 h-3.5 w-3.5" />
            {isExporting
              ? t("notes.knowledgeVaultExporting")
              : t("notes.knowledgeExportCurrentFolder")}
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-8"
            disabled={isCreating}
            onClick={() => onCreate("standalone_note", folder.id)}
          >
            <FileText className="mr-2 h-3.5 w-3.5" />
            {t("notes.knowledgeNewNote")}
          </Button>
        </div>
      </div>

      {orderedChildren.length === 0 ? (
        <div className="flex min-h-64 items-center justify-center border border-dashed border-border/55 bg-muted/[0.14] px-6 py-10 text-center">
          <div className="max-w-sm">
            <p className="text-sm font-medium text-foreground">{t("notes.knowledgeFolderEmpty")}</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {t("notes.knowledgeFolderEmptyHint")}
            </p>
            <div className="mt-5 flex items-center justify-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={isCreating}
                onClick={() => onCreate("folder", folder.id)}
              >
                <Folder className="mr-2 h-3.5 w-3.5" />
                {t("notes.knowledgeNewFolder")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={isCreating}
                onClick={() => onCreate("standalone_note", folder.id)}
              >
                <FileText className="mr-2 h-3.5 w-3.5" />
                {t("notes.knowledgeNewNote")}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <KnowledgeFolderBrowserSection
            title={t("notes.knowledgeFolderChildFolders")}
            items={childSections.folders}
            documents={documents}
            childCountByParentId={childCountByParentId}
            onSelect={onSelect}
            onDelete={onDelete}
            onMove={onMove}
            onRename={onRename}
            t={t}
          />
          <KnowledgeFolderBrowserSection
            title={t("notes.knowledgeFolderChildDocuments")}
            items={childSections.documents}
            documents={documents}
            childCountByParentId={childCountByParentId}
            onSelect={onSelect}
            onDelete={onDelete}
            onMove={onMove}
            onRename={onRename}
            t={t}
          />
        </div>
      )}
    </div>
  );
}

function KnowledgeVaultConflictCard({
  notice,
  onDismiss,
  t,
}: {
  notice: KnowledgeVaultConflictNotice;
  onDismiss: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const visiblePaths = notice.paths.slice(0, 4);
  const hiddenCount = Math.max(0, notice.paths.length - visiblePaths.length);
  const firstVisiblePath = visiblePaths[0];
  const firstFileUri = firstVisiblePath
    ? createObsidianVaultFileOpenUri({
        rootPath: notice.rootPath,
        relativePath: firstVisiblePath,
        paneType: "tab",
      })
    : null;
  const searchUri = createObsidianSearchUri({
    vault: inferObsidianVaultNameFromPath(notice.rootPath),
  });

  return (
    <div className="mb-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-sm shadow-sm">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive">
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-foreground">
                {notice.kind === "external_modified"
                  ? t("notes.knowledgeVaultConflictTitle")
                  : t("notes.knowledgeVaultExistingTitle")}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {notice.kind === "external_modified"
                  ? t("notes.knowledgeVaultConflictDescription")
                  : t("notes.knowledgeVaultExistingDescription")}
              </p>
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
              onClick={onDismiss}
              aria-label={t("common.close")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-2 rounded-md border border-border/50 bg-background/70 px-2.5 py-2">
            <p className="truncate text-[11px] text-muted-foreground">{notice.rootPath}</p>
            <div className="mt-1 space-y-1">
              {visiblePaths.map((path) => (
                <p key={path} className="truncate font-mono text-[11px] text-foreground/85">
                  {path}
                </p>
              ))}
              {hiddenCount > 0 ? (
                <p className="text-[11px] text-muted-foreground">
                  {t("notes.knowledgeVaultConflictMore", { count: hiddenCount })}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2">
            {firstFileUri ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 border-destructive/25 bg-background/75 px-2 text-xs text-foreground hover:bg-background"
                onClick={() => void openKnowledgeObsidianUri(firstFileUri, t)}
              >
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                {t("notes.knowledgeObsidianOpenFile")}
              </Button>
            ) : null}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 border-border/60 bg-background/75 px-2 text-xs text-foreground hover:bg-background"
              onClick={() => void openKnowledgeObsidianUri(searchUri, t)}
            >
              <Search className="mr-1.5 h-3.5 w-3.5" />
              {t("notes.knowledgeObsidianSearchVault")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function KnowledgeMarkdownImportReviewCard({
  review,
  documents,
  isApplying,
  onApply,
  onDismiss,
  t,
}: {
  review: KnowledgeMarkdownImportReview;
  documents: KnowledgeDocument[];
  isApplying: boolean;
  onApply: () => void;
  onDismiss: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const visibleItems = review.items.slice(0, 5);
  const hiddenCount = Math.max(0, review.items.length - visibleItems.length);
  const documentById = useMemo(
    () => new Map(documents.map((document) => [document.id, document])),
    [documents],
  );
  const importDestinationLabel = useCallback(
    (proposal: KnowledgeImportWriteProposal): string | null => {
      if (proposal.targetPath) return proposal.targetPath;
      if (proposal.action === "update") return proposal.current?.path ?? null;
      if (proposal.action !== "create") return null;
      const parentId = proposal.draft.parentId;
      const title = proposal.draft.title?.trim() || t("notes.knowledgeUntitledDocument");
      if (!parentId) {
        return [
          t("notes.knowledgeVaultRoot", { defaultValue: "Knowledge base" }),
          title,
        ].join(" / ");
      }
      const parent = documentById.get(parentId);
      if (!parent) return [parentId, title].join(" / ");
      return [
        ...knowledgeDocumentPath(parent, documents, t).map((item) => item.title),
        title,
      ].join(" / ");
    },
    [documentById, documents, t],
  );

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-border/70 bg-card text-sm shadow-sm">
      <div className="border-b border-border/60 bg-muted/25 px-3 py-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <FileText className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <p className="font-medium text-foreground">
                {t("notes.knowledgeMarkdownImportTitle")}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t("notes.knowledgeMarkdownImportDescription", { count: review.items.length })}
              </p>
            </div>
          </div>
          <button
            type="button"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
            onClick={onDismiss}
            aria-label={t("common.close")}
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="space-y-2 p-3">
        {visibleItems.map((item) => {
          const proposal = item.proposal;
          const title =
            proposal.action === "create"
              ? proposal.draft.title
              : (proposal.patch.title ?? proposal.current?.title ?? proposal.documentId);
          const tags =
            proposal.action === "create"
              ? (proposal.draft.tags ?? [])
              : (proposal.patch.tags ?? proposal.current?.tags ?? []);
          const preview =
            proposal.action === "create"
              ? proposal.draft.excerpt || proposal.draft.contentMd
              : proposal.patch.excerpt ||
                proposal.patch.contentMd ||
                proposal.current?.excerpt ||
                "";
          const destinationLabel = importDestinationLabel(proposal);

          return (
            <div
              key={item.path}
              className="rounded-md border border-border/55 bg-background px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-foreground">{title}</p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {desktopFileName(item.path)}
                  </p>
                  <p
                    className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/80"
                    title={item.sourcePath}
                  >
                    {t("notes.knowledgeImportSource", { path: item.sourcePath })}
                  </p>
                  {destinationLabel ? (
                    <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Folder className="h-3 w-3 shrink-0 text-primary/70" />
                      <span className="truncate">
                        {t("notes.knowledgeImportDestination", { path: destinationLabel })}
                      </span>
                    </p>
                  ) : null}
                </div>
                <span className="shrink-0 rounded-md bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
                  {proposal.action === "create"
                    ? t("notes.knowledgeMarkdownImportWillCreate")
                    : t("notes.knowledgeVaultImportWillUpdate")}
                </span>
              </div>

              {preview ? (
                <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {preview}
                </p>
              ) : null}

              {tags.length > 0 || item.warnings.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {tags.slice(0, 5).map((tag) => (
                    <span
                      key={tag}
                      className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                  {tags.length > 5 ? (
                    <span className="rounded-md bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                      +{tags.length - 5}
                    </span>
                  ) : null}
                  {item.warnings.slice(0, 3).map((warning) => (
                    <span
                      key={warning}
                      className="rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300"
                    >
                      {knowledgeMarkdownImportWarningLabel(warning, t)}
                    </span>
                  ))}
                  {item.warnings.length > 3 ? (
                    <span className="rounded-md bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                      {t("notes.knowledgeMarkdownImportWarningCount", {
                        count: item.warnings.length - 3,
                      })}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}

        {hiddenCount > 0 ? (
          <p className="px-1 text-[11px] text-muted-foreground">
            {t("notes.knowledgeMarkdownImportMoreFiles", { count: hiddenCount })}
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3 pt-1">
          <p className="min-w-0 text-xs text-muted-foreground">
            {t("notes.knowledgeMarkdownImportSafeHint")}
          </p>
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" variant="ghost" size="sm" className="h-7" onClick={onDismiss}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-7"
              disabled={isApplying || review.items.length === 0}
              onClick={onApply}
            >
              {isApplying
                ? t("notes.knowledgeMarkdownImportApplying")
                : t("notes.knowledgeMarkdownImportApply")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function KnowledgeVaultImportReviewCard({
  review,
  isApplying,
  onApply,
  onDismiss,
  t,
}: {
  review: KnowledgeVaultImportReview;
  isApplying: boolean;
  onApply: () => void;
  onDismiss: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  const visibleModified = review.plan.modified.slice(0, 4);
  const visibleCardTemplateChanges = review.plan.cardTemplateChanges.slice(0, 3);
  const issueEntries = [
    ...review.plan.conflicts,
    ...review.plan.missing,
    ...review.plan.unreadable,
  ];
  const visibleIssues = issueEntries.slice(0, 3);
  const visibleCardTemplateConflicts = review.plan.cardTemplateConflicts.slice(
    0,
    Math.max(0, 3 - visibleIssues.length),
  );
  const hiddenModifiedCount = Math.max(0, review.plan.modified.length - visibleModified.length);
  const hiddenCardTemplateChangeCount = Math.max(
    0,
    review.plan.cardTemplateChanges.length - visibleCardTemplateChanges.length,
  );
  const hiddenIssueCount = Math.max(0, issueEntries.length - visibleIssues.length);
  const hiddenCardTemplateConflictCount = Math.max(
    0,
    review.plan.cardTemplateConflicts.length - visibleCardTemplateConflicts.length,
  );
  const applicableChangeCount = review.proposals.length + review.plan.cardTemplateChanges.length;
  const proposalByDocumentId = new Map(
    review.proposals.map((proposal) => [proposal.documentId, proposal] as const),
  );
  const searchUri = createObsidianSearchUri({
    vault: inferObsidianVaultNameFromPath(review.rootPath),
  });

  return (
    <div className="mb-3 overflow-hidden rounded-lg border border-primary/20 bg-primary/[0.035] text-sm shadow-sm">
      <div className="flex items-start gap-3 p-3">
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
          <FolderDown className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-foreground">{t("notes.knowledgeVaultImportTitle")}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {t("notes.knowledgeVaultImportDescription")}
              </p>
            </div>
            <button
              type="button"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-background/80 hover:text-foreground"
              onClick={onDismiss}
              aria-label={t("common.close")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-5 gap-2">
            <div className="rounded-md border border-border/45 bg-background/75 px-2.5 py-2">
              <p className="text-base font-semibold text-foreground">
                {review.plan.modified.length}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("notes.knowledgeVaultImportModified")}
              </p>
            </div>
            <div className="rounded-md border border-border/45 bg-background/75 px-2.5 py-2">
              <p className="text-base font-semibold text-foreground">
                {review.plan.conflicts.length}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("notes.knowledgeVaultImportConflicts")}
              </p>
            </div>
            <div className="rounded-md border border-border/45 bg-background/75 px-2.5 py-2">
              <p className="text-base font-semibold text-foreground">
                {review.plan.missing.length}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("notes.knowledgeVaultImportMissing")}
              </p>
            </div>
            <div className="rounded-md border border-border/45 bg-background/75 px-2.5 py-2">
              <p className="text-base font-semibold text-foreground">
                {review.plan.unreadable.length}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("notes.knowledgeVaultImportUnreadable")}
              </p>
            </div>
            <div className="rounded-md border border-border/45 bg-background/75 px-2.5 py-2">
              <p className="text-base font-semibold text-foreground">
                {review.plan.cardTemplateChanges.length +
                  review.plan.cardTemplateConflicts.length}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t("notes.knowledgeVaultImportCardTemplates")}
              </p>
            </div>
          </div>

          <div className="mt-3 rounded-md border border-border/50 bg-background/70 px-2.5 py-2">
            <p className="truncate text-[11px] text-muted-foreground">{review.rootPath}</p>
            {visibleModified.length > 0 ? (
              <div className="mt-2 space-y-1.5">
                {visibleModified.map((entry) => {
                  const proposal = proposalByDocumentId.get(entry.documentId);
                  const title = proposal?.patch.title ?? proposal?.current?.title ?? entry.path;
                  return (
                    <div
                      key={entry.documentId}
                      className="rounded-md border border-border/40 bg-card px-2.5 py-2"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium text-foreground">{title}</p>
                          <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                            {entry.path}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
                          {t("notes.knowledgeVaultImportWillUpdate")}
                        </span>
                      </div>
                      {proposal?.changedFields.length ? (
                        <p className="mt-1.5 text-[11px] text-muted-foreground">
                          {t("notes.knowledgeVaultImportChangedFields", {
                            fields: proposal.changedFields.join(", "),
                          })}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
                {hiddenModifiedCount > 0 ? (
                  <p className="px-1 text-[11px] text-muted-foreground">
                    {t("notes.knowledgeVaultImportMoreModified", { count: hiddenModifiedCount })}
                  </p>
                ) : null}
              </div>
            ) : null}

            {visibleCardTemplateChanges.length > 0 ? (
              <div className="mt-2 space-y-1.5">
                {visibleCardTemplateChanges.map((change) => (
                  <div
                    key={change.template.id}
                    className="rounded-md border border-border/40 bg-card px-2.5 py-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-foreground">
                          {change.template.name}
                        </p>
                        <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                          {change.template.id}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-md bg-primary/10 px-2 py-1 text-[11px] font-medium text-primary">
                        {change.status === "missing"
                          ? t("notes.knowledgeVaultImportWillImportTemplate")
                          : t("notes.knowledgeVaultImportWillUpdateTemplate")}
                      </span>
                    </div>
                  </div>
                ))}
                {hiddenCardTemplateChangeCount > 0 ? (
                  <p className="px-1 text-[11px] text-muted-foreground">
                    {t("notes.knowledgeVaultImportMoreTemplates", {
                      count: hiddenCardTemplateChangeCount,
                    })}
                  </p>
                ) : null}
              </div>
            ) : null}

            {visibleIssues.length > 0 || visibleCardTemplateConflicts.length > 0 ? (
              <div className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-2.5 py-2">
                <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {t("notes.knowledgeVaultImportIssues")}
                </div>
                <div className="space-y-1">
                  {visibleIssues.map((entry) => {
                    const resolutionLabel = knowledgeVaultImportResolutionLabel(
                      entry.resolution,
                      t,
                    );
                    return (
                      <div
                        key={`${entry.status}:${entry.path}`}
                        className="rounded-md border border-border/40 bg-background/70 px-2 py-1.5"
                      >
                        <div className="flex min-w-0 items-center justify-between gap-2">
                          <p className="min-w-0 truncate font-mono text-[11px] text-foreground/80">
                            {entry.path}
                          </p>
                          <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {entry.status === "conflict"
                              ? t("notes.knowledgeVaultImportConflictIssue")
                              : entry.status === "missing"
                                ? t("notes.knowledgeVaultImportMissingIssue")
                                : t("notes.knowledgeVaultImportUnreadableIssue")}
                          </span>
                        </div>
                        {resolutionLabel ? (
                          <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                            {resolutionLabel}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                  {visibleCardTemplateConflicts.map((entry) => (
                    <div
                      key={`card-template:${entry.template.id}`}
                      className="rounded-md border border-border/40 bg-background/70 px-2 py-1.5"
                    >
                      <div className="flex min-w-0 items-center justify-between gap-2">
                        <p className="min-w-0 truncate font-mono text-[11px] text-foreground/80">
                          {entry.template.name}
                        </p>
                        <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                          {t("notes.knowledgeVaultImportTemplateConflictIssue")}
                        </span>
                      </div>
                      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                        {knowledgeVaultImportResolutionLabel(entry.resolution, t)}
                      </p>
                    </div>
                  ))}
                  {hiddenIssueCount + hiddenCardTemplateConflictCount > 0 ? (
                    <p className="text-[11px] text-muted-foreground">
                      {t("notes.knowledgeVaultImportMoreIssues", {
                        count: hiddenIssueCount + hiddenCardTemplateConflictCount,
                      })}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="min-w-0 text-xs text-muted-foreground">
              {review.plan.conflicts.length > 0 || review.plan.cardTemplateConflicts.length > 0
                ? t("notes.knowledgeVaultImportConflictSafeHint")
                : applicableChangeCount > 0
                  ? t("notes.knowledgeVaultImportSafeHint")
                  : t("notes.knowledgeVaultImportNoApplicableChanges")}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7"
                onClick={() => void openKnowledgeObsidianUri(searchUri, t)}
              >
                <Search className="mr-1.5 h-3.5 w-3.5" />
                {t("notes.knowledgeObsidianSearchVault")}
              </Button>
              <Button type="button" variant="ghost" size="sm" className="h-7" onClick={onDismiss}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                className="h-7"
                disabled={isApplying || applicableChangeCount === 0}
                onClick={onApply}
              >
                {isApplying
                  ? t("notes.knowledgeVaultImportApplying")
                  : t("notes.knowledgeVaultImportApply")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KnowledgeExportMenu({
  onExport,
  onImportMarkdown,
  onExportVault,
  onImportVault,
  isMarkdownImporting,
  isVaultExporting,
  isVaultImporting,
  t,
}: {
  onExport: (format: KnowledgeExportFormat) => void;
  onImportMarkdown: () => void;
  onExportVault: () => void;
  onImportVault: () => void;
  isMarkdownImporting: boolean;
  isVaultExporting: boolean;
  isVaultImporting: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
          <Download className="h-3 w-3" />
          {t("notes.export")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => onExport("obsidian")}>
          <FileText className="mr-2 h-4 w-4" />
          {t("notes.exportObsidian")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExport("markdown")}>
          <FileText className="mr-2 h-4 w-4" />
          {t("notes.exportMarkdown")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onImportMarkdown} disabled={isMarkdownImporting}>
          <FileText className="mr-2 h-4 w-4" />
          {isMarkdownImporting
            ? t("notes.knowledgeMarkdownImporting")
            : t("notes.knowledgeImportMarkdown")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onExportVault()} disabled={isVaultExporting}>
          <FolderUp className="mr-2 h-4 w-4" />
          {isVaultExporting ? t("notes.knowledgeVaultExporting") : t("notes.knowledgeExportVault")}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onImportVault} disabled={isVaultImporting}>
          <FolderDown className="mr-2 h-4 w-4" />
          {isVaultImporting ? t("notes.knowledgeVaultImporting") : t("notes.knowledgeImportVault")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// --- Notebook card (BookCard-inspired style) ---

interface NotebookCardProps {
  book: {
    bookId: string;
    title: string;
    author: string;
    coverUrl: string | null;
    highlights: HighlightWithBook[];
    notesCount: number;
    highlightsOnlyCount: number;
  };
  onClick: () => void;
}

function NotebookCard({ book, onClick }: NotebookCardProps) {
  return (
    <button
      type="button"
      className="group flex h-full cursor-pointer flex-col justify-end text-left"
      onClick={onClick}
    >
      {/* Cover — same aspect ratio and shadow as BookCard */}
      <div className="book-cover-shadow relative flex aspect-[28/41] w-full items-end justify-center overflow-hidden rounded transition-all duration-200">
        <CoverImage
          url={book.coverUrl}
          alt=""
          className="absolute inset-0 h-full w-full rounded object-cover"
          loading="lazy"
          fallback={
            <div className="absolute inset-0 flex flex-col items-center rounded bg-gradient-to-b from-stone-100 to-stone-200 p-3">
              <div className="flex flex-1 items-center justify-center">
                <span className="line-clamp-3 text-center font-serif text-base font-medium leading-snug text-stone-500">
                  {book.title}
                </span>
              </div>
              <div className="h-px w-8 bg-stone-300/60" />
              {book.author && (
                <div className="flex h-1/4 items-center justify-center">
                  <span className="line-clamp-1 text-center font-serif text-xs text-stone-400">
                    {book.author}
                  </span>
                </div>
              )}
            </div>
          }
        />

        {/* Spine overlay */}
        {book.coverUrl && <div className="book-spine absolute inset-0 rounded" />}

        {/* Count badge — top right, shows total highlights + notes */}
        <div className="absolute right-1 top-1 z-10 flex items-center gap-1 rounded bg-black/60 px-1.5 py-0.5 backdrop-blur-sm">
          <Highlighter className="h-2.5 w-2.5 text-white/80" />
          <span className="text-[9px] font-medium text-white">{book.highlightsOnlyCount}</span>
          {book.notesCount > 0 && (
            <>
              <NotebookPen className="ml-0.5 h-2.5 w-2.5 text-white/80" />
              <span className="text-[9px] font-medium text-white">{book.notesCount}</span>
            </>
          )}
        </div>
      </div>

      {/* Info area — only book title, no counts */}
      <div className="flex w-full flex-col pt-2">
        <h4 className="truncate text-xs font-semibold leading-tight text-foreground">
          {book.title}
        </h4>
      </div>
    </button>
  );
}

// --- Note detail card (for "Notes" tab) ---

interface NoteDetailCardProps {
  highlight: HighlightWithBook;
  isEditing: boolean;
  editNote: string;
  setEditNote: (note: string) => void;
  onStartEdit: () => void;
  onSaveNote: () => void;
  onCancelEdit: () => void;
  onDeleteNote: () => void;
  onNavigate: () => void;
  t: (key: string) => string;
}

function NoteDetailCard({
  highlight,
  isEditing,
  editNote,
  setEditNote,
  onStartEdit,
  onSaveNote,
  onCancelEdit,
  onDeleteNote,
  onNavigate,
  t,
}: NoteDetailCardProps) {
  return (
    <div className="group rounded-lg border border-border/40 bg-card transition-colors hover:border-border/70">
      <div className="p-3">
        {/* Quoted highlight text */}
        <button
          type="button"
          className="line-clamp-2 cursor-pointer text-left text-xs leading-relaxed text-muted-foreground/80 transition-colors hover:text-primary"
          onClick={onNavigate}
        >
          "{highlight.text}"
        </button>

        {/* Note content */}
        {isEditing ? (
          <div className="mt-2 flex items-start gap-2">
            <MarkdownEditor
              tier="inline_note"
              value={editNote}
              onChange={setEditNote}
              placeholder={t("notebook.addNote")}
              className="flex-1"
              autoFocus
            />
            <div className="flex flex-col gap-1">
              <button
                type="button"
                className="rounded p-1.5 text-primary hover:bg-primary/10"
                onClick={onSaveNote}
              >
                <Check className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="rounded p-1.5 text-muted-foreground hover:bg-muted"
                onClick={onCancelEdit}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="mt-2 block w-full cursor-pointer text-left"
            onClick={onStartEdit}
          >
            <div className="prose prose-sm dark:prose-invert max-w-none text-sm leading-relaxed break-words overflow-hidden [overflow-wrap:anywhere]">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{highlight.note || ""}</ReactMarkdown>
            </div>
          </button>
        )}

        {/* Footer */}
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground/60">
            {new Date(highlight.createdAt).toLocaleDateString()}
          </span>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:text-primary hover:bg-primary/10"
              onClick={onStartEdit}
              title={t("notebook.editNote")}
            >
              <Edit3 className="h-3 w-3" />
            </button>
            <button
              type="button"
              className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={(e) => {
                e.stopPropagation();
                onDeleteNote();
              }}
              title={t("notebook.deleteNote")}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Highlight detail card (for "Highlights" tab) ---

interface HighlightDetailCardProps {
  highlight: HighlightWithBook;
  onDelete: () => void;
  onNavigate: () => void;
  t: (key: string) => string;
}

function HighlightDetailCard({ highlight, onDelete, onNavigate, t }: HighlightDetailCardProps) {
  const hexColor =
    HIGHLIGHT_COLOR_HEX[highlight.color as keyof typeof HIGHLIGHT_COLOR_HEX] ||
    HIGHLIGHT_COLOR_HEX.yellow;

  return (
    <div className="group relative rounded-lg border border-border/40 bg-card transition-colors hover:border-border/70">
      {/* Color bar */}
      <div
        className="absolute left-0 top-3 bottom-3 w-[3px] rounded-full"
        style={{ backgroundColor: hexColor }}
      />

      <div className="pl-4 pr-3 py-3">
        <button
          type="button"
          className="cursor-pointer text-left text-sm leading-relaxed text-foreground/90 transition-colors hover:text-primary"
          onClick={onNavigate}
        >
          "{highlight.text}"
        </button>

        <div className="mt-2 flex items-center justify-between">
          <span className="text-[11px] text-muted-foreground/60">
            {new Date(highlight.createdAt).toLocaleDateString()}
          </span>
          <button
            type="button"
            className="rounded p-1 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            title={t("notebook.deleteHighlight")}
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
