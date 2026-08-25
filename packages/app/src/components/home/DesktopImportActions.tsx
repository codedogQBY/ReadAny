import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { useAppStore } from "@/stores/app-store";
import { useLibraryStore } from "@/stores/library-store";
import { useSyncStore } from "@/stores/sync-store";
import { cn } from "@readany/core/utils";
import {
  createImportDuplicateIndex,
  DEFAULT_WEBDAV_IMPORT_REMOTE_ROOT,
  findLikelyDuplicateBook,
  getPlatformService,
  type ImportBooksResult,
  normalizeImportIdentity,
  type PersistedWebDavImportInput,
  WEBDAV_IMPORT_TEMPORARY_CONFIG_KEY,
  WEBDAV_IMPORT_TEMPORARY_SECRET_KEY,
  type WebDavImportEntry,
  WebDavImportService,
  type WebDavImportSource,
  type WebDavImportSourceKind,
} from "@readany/core";
import { SYNC_SECRET_KEYS } from "@readany/core/sync/sync-backend";
import { mkdir, remove, writeFile } from "@tauri-apps/plugin-fs";
import { open } from "@tauri-apps/plugin-dialog";
import { join, tempDir } from "@tauri-apps/api/path";
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  Cloud,
  FolderOpen,
  Globe,
  Loader2,
  LibraryBig,
  Search,
  Upload,
} from "lucide-react";
import {
  type ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { OpdsCatalogsDialog } from "./OpdsCatalogsDialog";

type ImportState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "downloading"; current: number; total: number; currentName: string }
  | { phase: "importing"; total: number };

interface DesktopImportActionsProps {
  children: ReactElement;
  align?: "start" | "center" | "end";
}

function splitUrlPathSegments(pathname: string): string[] {
  return pathname.split("/").filter(Boolean);
}

function deriveImportBaseUrl(url: string, remoteRoot?: string): string {
  if (!remoteRoot?.trim()) return url;

  try {
    const parsed = new URL(url);
    const baseSegments = splitUrlPathSegments(parsed.pathname.replace(/\/+$/, ""));
    const rootSegments = splitUrlPathSegments(remoteRoot.trim());

    if (
      rootSegments.length > 0 &&
      baseSegments.length >= rootSegments.length &&
      rootSegments.every(
        (segment, index) =>
          baseSegments[baseSegments.length - rootSegments.length + index] === segment,
      )
    ) {
      const nextSegments = baseSegments.slice(0, baseSegments.length - rootSegments.length);
      parsed.pathname = nextSegments.length > 0 ? `/${nextSegments.join("/")}` : "/";
      return parsed.toString().replace(/\/$/, parsed.pathname === "/" ? "/" : "");
    }
  } catch {
    return url;
  }

  return url;
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 100 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatDate(timestamp: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim() || `book-${Date.now()}`;
}

function getSourceLabel(kind: WebDavImportSourceKind, t: ReturnType<typeof useTranslation>["t"]): string {
  return kind === "saved"
    ? t("library.importSourceSavedWebDav", "我的 WebDAV")
    : t("library.importSourceTemporaryWebDav", "连接其他 WebDAV");
}

function formatImportResultMessage(
  t: ReturnType<typeof useTranslation>["t"],
  result: ImportBooksResult,
): string {
  return t("library.importResultSummary", {
    imported: result.imported.length,
    skipped: result.skippedDuplicates.length,
    failed: result.failures.length,
  });
}

function DesktopWebDavConnectDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (source: WebDavImportSource) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [url, setUrl] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remoteRoot, setRemoteRoot] = useState(DEFAULT_WEBDAV_IMPORT_REMOTE_ROOT);
  const [allowInsecure, setAllowInsecure] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      const platform = getPlatformService();
      try {
        const [rawConfig, savedPassword] = await Promise.all([
          platform.kvGetItem(WEBDAV_IMPORT_TEMPORARY_CONFIG_KEY),
          platform.kvGetItem(WEBDAV_IMPORT_TEMPORARY_SECRET_KEY),
        ]);
        if (cancelled) return;
        if (rawConfig) {
          const parsed = JSON.parse(rawConfig) as PersistedWebDavImportInput;
          setUrl(parsed.url ?? "");
          setUsername(parsed.username ?? "");
          setRemoteRoot(parsed.remoteRoot ?? DEFAULT_WEBDAV_IMPORT_REMOTE_ROOT);
          setAllowInsecure(parsed.allowInsecure ?? false);
        }
        if (savedPassword) {
          setPassword(savedPassword);
        }
      } catch (err) {
        console.warn("[import] failed to load saved WebDAV input", err);
      }
    })();
    setError(null);
    setSubmitting(false);
    return () => {
      cancelled = true;
    };
  }, [open]);

  const canSubmit =
    url.trim().length > 0 && username.trim().length > 0 && password.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        kind: "temporary",
        url: url.trim(),
        username: username.trim(),
        password,
        remoteRoot: remoteRoot.trim(),
        allowInsecure,
      });
      try {
        const platform = getPlatformService();
        const persisted: PersistedWebDavImportInput = {
          url: url.trim(),
          username: username.trim(),
          remoteRoot: remoteRoot.trim(),
          allowInsecure,
        };
        await Promise.all([
          platform.kvSetItem(WEBDAV_IMPORT_TEMPORARY_CONFIG_KEY, JSON.stringify(persisted)),
          platform.kvSetItem(WEBDAV_IMPORT_TEMPORARY_SECRET_KEY, password),
        ]);
      } catch (err) {
        console.warn("[import] failed to persist WebDAV input", err);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>{t("library.importSourceTemporaryWebDav", "连接其他 WebDAV")}</DialogTitle>
          <DialogDescription>
            {t(
              "library.importSourceTemporaryWebDavDesc",
              "临时输入另一个地址、账号和文件夹，这次导完就走，不会改动当前同步配置。",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">{t("settings.webdavUrl", "服务器地址")}</label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://dav.example.com" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("settings.username", "用户名")}</label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">{t("settings.password", "密码")}</label>
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              {t("library.importRootLabel", "浏览起点")}
            </label>
            <Input
              value={remoteRoot}
              onChange={(e) => setRemoteRoot(e.target.value)}
              placeholder={t("library.webdavImportRemoteRootPlaceholder", "留空则从服务器基准目录开始")}
            />
            <p className="text-xs leading-5 text-muted-foreground">
              {t(
                "library.importRemoteRootHint",
                "可以填写任意多级路径；留空时会从当前 WebDAV 服务的基准目录开始浏览。",
              )}
            </p>
          </div>

          <label className="flex items-start gap-3 rounded-xl border border-border bg-muted/30 px-3 py-3">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={allowInsecure}
              onChange={(e) => setAllowInsecure(e.target.checked)}
            />
            <span className="space-y-1">
              <span className="block text-sm font-medium text-foreground">
                {t("settings.webdavAllowInsecure", "允许不安全连接")}
              </span>
              <span className="block text-xs leading-5 text-muted-foreground">
                {t(
                  "library.importAllowInsecureHint",
                  "对自签名证书或纯 HTTP 服务有帮助，生产环境仍建议使用 HTTPS。",
                )}
              </span>
            </span>
          </label>

          {error && (
            <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            {t("common.cancel", "取消")}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!canSubmit}>
            {submitting ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                {t("library.webdavImportConnecting", "连接中...")}
              </>
            ) : (
              t("library.webdavImportConnectAndBrowse", "连接并浏览")
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DesktopWebDavImportBrowserDialog({
  source,
  onClose,
}: {
  source: WebDavImportSource | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const importBooks = useLibraryStore((state) => state.importBooks);
  const books = useLibraryStore((state) => state.books);
  const service = useMemo(() => (source ? new WebDavImportService(source) : null), [source]);
  const duplicateIndex = useMemo(() => createImportDuplicateIndex(books), [books]);

  const [currentPath, setCurrentPath] = useState("/");
  const [entries, setEntries] = useState<WebDavImportEntry[]>([]);
  const [search, setSearch] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [importState, setImportState] = useState<ImportState>({ phase: "idle" });

  const loadListing = useCallback(
    async (path: string) => {
      if (!service) return;
      setLoading(true);
      setError(null);
      try {
        const listing = await service.list(path);
        setCurrentPath(listing.currentPath);
        setEntries(listing.entries);
        setParentPath(listing.parentPath);
        setSelectedPaths([]);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [service],
  );

  useEffect(() => {
    if (!source) return;
    setSearch("");
    setEntries([]);
    setParentPath(null);
    setSelectedPaths([]);
    void loadListing("/");
  }, [loadListing, source]);

  const visibleEntries = useMemo(() => {
    const query = normalizeImportIdentity(search.trim());
    const filteredBySearch = !query
      ? entries
      : entries.filter((entry) => normalizeImportIdentity(entry.name).includes(query));

    const enriched = filteredBySearch.map((entry) => ({
      entry,
      likelyDuplicate:
        !entry.isDirectory && !!findLikelyDuplicateBook(duplicateIndex, { name: entry.name }),
    }));

    return [...enriched].sort((left, right) => {
      if (left.entry.isDirectory !== right.entry.isDirectory) {
        return left.entry.isDirectory ? -1 : 1;
      }

      if (left.entry.importable !== right.entry.importable) {
        return left.entry.importable ? -1 : 1;
      }
      if (left.likelyDuplicate !== right.likelyDuplicate) {
        return left.likelyDuplicate ? 1 : -1;
      }
      return left.entry.name.localeCompare(right.entry.name, undefined, {
        sensitivity: "base",
        numeric: true,
      });
    });
  }, [duplicateIndex, entries, search]);

  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedPaths.includes(entry.relativePath)),
    [entries, selectedPaths],
  );
  const visibleImportableCount = useMemo(
    () => visibleEntries.filter(({ entry }) => entry.importable).length,
    [visibleEntries],
  );
  const visibleLikelyDuplicateCount = useMemo(
    () => visibleEntries.filter(({ likelyDuplicate }) => likelyDuplicate).length,
    [visibleEntries],
  );

  const downloadToTempFiles = useCallback(
    async (items: WebDavImportEntry[]) => {
      if (!service || items.length === 0) return [];
      const tempRoot = await tempDir();
      const workspace = await join(tempRoot, "readany-webdav-import");
      await mkdir(workspace, { recursive: true });
      const tempPaths: string[] = [];

      for (let index = 0; index < items.length; index += 1) {
        const entry = items[index];
        setImportState({
          phase: "downloading",
          current: index + 1,
          total: items.length,
          currentName: entry.name,
        });

        const bytes = await service.downloadFile(entry.relativePath);
        const tempPath = await join(
          workspace,
          `readany-webdav-${Date.now()}-${index}-${sanitizeFilename(entry.name)}`,
        );
        await writeFile(tempPath, bytes);
        tempPaths.push(tempPath);
      }

      return tempPaths;
    },
    [service],
  );

  const cleanupTempFiles = useCallback(async (paths: string[]) => {
    await Promise.all(
      paths.map(async (path) => {
        try {
          await remove(path);
        } catch {
          // best effort cleanup
        }
      }),
    );
  }, []);

  const importEntries = useCallback(
    async (items: WebDavImportEntry[]) => {
      if (!items.length) return;

      try {
        const tempPaths = await downloadToTempFiles(items);
        setImportState({ phase: "importing", total: tempPaths.length });
        const result = await importBooks(tempPaths);
        await cleanupTempFiles(tempPaths);
        setImportState({ phase: "idle" });
        toast.success(formatImportResultMessage(t, result));
      } catch (err) {
        setImportState({ phase: "idle" });
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [cleanupTempFiles, downloadToTempFiles, importBooks, t],
  );

  const handleImportFolder = useCallback(async () => {
    if (!service) return;
    try {
      setImportState({ phase: "loading" });
      const items = await service.collectImportableFiles(currentPath);
      if (items.length === 0) {
        setImportState({ phase: "idle" });
        toast.message(t("library.webdavImportNoImportableTitle", "这个文件夹里还没有可导入的书"));
        return;
      }
      await importEntries(items);
    } catch (err) {
      setImportState({ phase: "idle" });
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }, [currentPath, importEntries, service, t]);

  const footerLabel =
    importState.phase === "downloading"
      ? t("library.webdavImportDownloadingProgress", {
          current: importState.current,
          total: importState.total,
        })
      : importState.phase === "importing"
        ? t("library.webdavImportImportingProgress", { total: importState.total })
        : null;

  return (
    <Dialog open={!!source} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="flex h-[82vh] max-h-[860px] w-[min(92vw,920px)] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 pt-6 pb-4 pr-16">
          <div className="flex items-start justify-between gap-6">
            <div className="min-w-0 flex-1 space-y-1">
              <DialogTitle>{getSourceLabel(source?.kind ?? "saved", t)}</DialogTitle>
              <DialogDescription>
                {t("library.webdavImportBrowserSubtitle", "浏览远端目录，挑书导入当前书架。")}
              </DialogDescription>
            </div>

            <div className="inline-flex max-w-[320px] shrink-0 items-center rounded-full border bg-muted/40 px-3 py-1 text-xs text-muted-foreground">
              <span className="truncate">
                {currentPath === "/"
                  ? t("library.webdavImportRootLabel", "浏览起点")
                  : currentPath}
              </span>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void (parentPath ? loadListing(parentPath) : undefined)}
              disabled={!parentPath || loading || importState.phase !== "idle"}
            >
              <ArrowLeft className="size-4" />
              {t("common.back", "返回")}
            </Button>
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
                placeholder={t("library.webdavImportSearchPlaceholder", "搜索文件名...")}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void handleImportFolder()}
              disabled={loading || importState.phase !== "idle"}
            >
              <FolderOpen className="size-4" />
              {t("library.webdavImportImportFolder", "导入本层书籍")}
            </Button>
          </div>

          <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
            <span>
              {t("library.webdavImportSummary", {
                count: visibleEntries.length,
                books: visibleImportableCount,
                duplicates: visibleLikelyDuplicateCount,
              })}
            </span>
            {selectedPaths.length > 0 && (
              <span>{t("library.webdavImportSelectedCount", { count: selectedPaths.length })}</span>
            )}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="flex h-full min-h-72 flex-col items-center justify-center gap-3 text-muted-foreground">
              <Loader2 className="size-6 animate-spin" />
              <p className="text-sm">{t("library.webdavImportLoading", "正在读取远端书库...")}</p>
            </div>
          ) : error ? (
            <div className="flex h-full min-h-72 flex-col items-center justify-center gap-4 text-center">
              <div>
                <p className="text-lg font-semibold text-foreground">
                  {t("library.webdavImportLoadFailed", "读取书库失败")}
                </p>
                <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">{error}</p>
              </div>
              <Button onClick={() => void loadListing(currentPath)}>
                {t("common.retry", "重试")}
              </Button>
            </div>
          ) : visibleEntries.length === 0 ? (
            <div className="flex h-full min-h-72 flex-col items-center justify-center gap-3 text-center">
              <Cloud className="size-8 text-muted-foreground/50" />
              <p className="text-lg font-semibold text-foreground">
                {search
                  ? t("library.webdavImportNoSearchResults", "没找到匹配的文件")
                  : t("library.webdavImportEmptyFolder", "这个文件夹目前是空的")}
              </p>
              <p className="max-w-md text-sm leading-6 text-muted-foreground">
                {search
                  ? t(
                      "library.webdavImportNoSearchResultsDesc",
                      "试试换个关键词，或者回到上一级目录看看别的书。",
                    )
                  : t(
                      "library.webdavImportEmptyFolderDesc",
                      "继续浏览其他目录，或者换一个来源再看看有没有书可以导。",
                    )}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleEntries.map(({ entry, likelyDuplicate }) => {
                const selected = selectedPaths.includes(entry.relativePath);
                const meta = entry.isDirectory
                  ? t("library.webdavImportFolderMeta", {
                      date: entry.lastModified ? formatDate(entry.lastModified) : "—",
                    })
                  : t("library.webdavImportFileMeta", {
                      size: formatBytes(entry.size),
                      date: entry.lastModified ? formatDate(entry.lastModified) : "—",
                    });

                return (
                  <button
                    key={`${entry.relativePath}-${entry.name}`}
                    type="button"
                    onClick={() => {
                      if (entry.isDirectory) {
                        void loadListing(entry.relativePath);
                        return;
                      }
                      if (!entry.importable) return;
                      setSelectedPaths((prev) =>
                        prev.includes(entry.relativePath)
                          ? prev.filter((path) => path !== entry.relativePath)
                          : [...prev, entry.relativePath],
                      );
                    }}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-2xl border bg-card px-4 py-3 text-left transition-colors",
                      selected ? "border-primary/50 bg-primary/5" : "border-border hover:bg-accent/40",
                      !entry.isDirectory && !entry.importable && "opacity-65",
                    )}
                  >
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      {entry.isDirectory ? <FolderOpen className="size-4" /> : <BookOpen className="size-4" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <div className="truncate text-sm font-medium text-foreground">{entry.name}</div>
                        {!entry.isDirectory && likelyDuplicate && (
                          <span className="shrink-0 rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                            {t("library.webdavImportLikelyDuplicate", "可能重复")}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {meta}
                        {!entry.isDirectory && !entry.importable && (
                          <>
                            {" · "}
                            {t("library.webdavImportUnsupported", "暂不支持这个文件格式")}
                          </>
                        )}
                      </div>
                    </div>
                    {entry.isDirectory ? (
                      <ChevronRight className="size-4 text-muted-foreground" />
                    ) : entry.importable ? (
                      <div
                        className={cn(
                          "flex size-5 items-center justify-center rounded-full border",
                          selected ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/30 text-transparent",
                        )}
                      >
                        <Check className="size-3.5" />
                      </div>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-h-5 text-sm text-muted-foreground">
              {footerLabel ??
                (selectedEntries.length > 0
                  ? t("library.webdavImportSelectionHint", "可以继续多选，或直接导入所选")
                  : t("library.webdavImportReady", "挑几本书带进当前书架"))}
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setSelectedPaths([])}
                disabled={selectedPaths.length === 0 || importState.phase !== "idle"}
              >
                {t("library.webdavImportClearSelection", "清空")}
              </Button>
              <Button
                type="button"
                onClick={() => void importEntries(selectedEntries)}
                disabled={selectedEntries.length === 0 || importState.phase !== "idle"}
              >
              {importState.phase === "idle" ? (
                  <>
                    <Upload className="size-4" />
                    {selectedEntries.length > 0
                      ? t("library.webdavImportImportSelectedCount", {
                          count: selectedEntries.length,
                        })
                      : t("library.webdavImportImportSelected", "导入所选")}
                  </>
                ) : (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    {footerLabel ?? t("library.importing", "导入中...")}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function DesktopImportActions({ children, align = "end" }: DesktopImportActionsProps) {
  const { t } = useTranslation();
  const importBooks = useLibraryStore((state) => state.importBooks);
  const loadSyncConfig = useSyncStore((state) => state.loadConfig);
  const syncConfig = useSyncStore((state) => state.config);
  const syncBackendType = useSyncStore((state) => state.backendType);
  const setShowSettings = useAppStore((state) => state.setShowSettings);

  const [temporaryOpen, setTemporaryOpen] = useState(false);
  const [catalogsOpen, setCatalogsOpen] = useState(false);
  const [browserSource, setBrowserSource] = useState<WebDavImportSource | null>(null);

  useEffect(() => {
    void loadSyncConfig();
  }, [loadSyncConfig]);

  const handleLocalImport = useCallback(async () => {
    try {
      const selected = await open({
        multiple: true,
        filters: [
          {
            name: "Books",
            extensions: ["epub", "EPUB", "pdf", "PDF", "mobi", "MOBI", "azw", "AZW", "azw3", "AZW3", "fb2", "FB2", "fbz", "FBZ", "txt", "TXT", "cbz", "CBZ", "umd", "UMD"],
          },
        ],
      } as const);
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      if (paths.length > 0) {
        const result = await importBooks(paths);
        toast.success(formatImportResultMessage(t, result));
      }
    } catch {
      // user cancelled
    }
  }, [importBooks, t]);

  const handleOpenSavedWebDav = useCallback(async () => {
    if (syncBackendType !== "webdav" || syncConfig?.type !== "webdav") {
      toast.error(
        t(
          "library.importSourceSavedWebDavMissing",
          "还没有可用的 WebDAV 配置，先去同步设置里连上你的书库。",
        ),
        {
          action: {
            label: t("settings.syncTitle", "WebDAV 同步"),
            onClick: () => setShowSettings(true, "sync"),
          },
        },
      );
      return;
    }

    const password = await getPlatformService().kvGetItem(SYNC_SECRET_KEYS.webdav);
    if (!password) {
      toast.error(
        t(
          "library.importSourceSavedWebDavMissingSecret",
          "已经找到 WebDAV 地址，但缺少密码。去同步设置里重新保存一次就能继续。",
        ),
        {
          action: {
            label: t("settings.syncTitle", "WebDAV 同步"),
            onClick: () => setShowSettings(true, "sync"),
          },
        },
      );
      return;
    }

    setBrowserSource({
      kind: "saved",
      url: deriveImportBaseUrl(syncConfig.url, syncConfig.remoteRoot),
      username: syncConfig.username,
      password,
      remoteRoot: DEFAULT_WEBDAV_IMPORT_REMOTE_ROOT,
      allowInsecure: syncConfig.allowInsecure ?? false,
    });
  }, [setShowSettings, syncBackendType, syncConfig, t]);

  const handleConnectTemporaryWebDav = useCallback(async (source: WebDavImportSource) => {
    const service = new WebDavImportService(source);
    await service.testConnection();
    setTemporaryOpen(false);
    setBrowserSource(source);
  }, []);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent
          align={align}
          sideOffset={8}
          className="w-[320px] rounded-2xl border-border/80 p-1.5 shadow-xl"
        >
          <DropdownMenuItem
            className="items-center gap-3 rounded-xl px-3 py-2.5"
            onSelect={(event) => {
              event.preventDefault();
              void handleLocalImport();
            }}
          >
            <div className="flex size-7 shrink-0 items-center justify-center text-primary">
              <BookOpen className="size-4.5" />
            </div>
            <div className="min-w-0 flex-1 whitespace-nowrap text-sm font-medium text-foreground">
              {t("library.importSourceLocal", "本地文件")}
            </div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </DropdownMenuItem>
          <DropdownMenuSeparator className="mx-2" />

          <DropdownMenuItem
            className="items-center gap-3 rounded-xl px-3 py-2.5"
            onSelect={(event) => {
              event.preventDefault();
              setCatalogsOpen(true);
            }}
          >
            <div className="flex size-7 shrink-0 items-center justify-center text-primary">
              <LibraryBig className="size-4.5" />
            </div>
            <div className="min-w-0 flex-1 whitespace-nowrap text-sm font-medium text-foreground">
              {t("library.opds.catalogsTitle")}
            </div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </DropdownMenuItem>
          <DropdownMenuSeparator className="mx-2" />

          <DropdownMenuItem
            className="items-center gap-3 rounded-xl px-3 py-2.5"
            onSelect={(event) => {
              event.preventDefault();
              void handleOpenSavedWebDav();
            }}
          >
            <div className="flex size-7 shrink-0 items-center justify-center text-primary">
              <Cloud className="size-4.5" />
            </div>
            <div className="min-w-0 flex-1 whitespace-nowrap text-sm font-medium text-foreground">
              {t("library.importSourceSavedWebDav", "我的 WebDAV")}
            </div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </DropdownMenuItem>
          <DropdownMenuSeparator className="mx-2" />

          <DropdownMenuItem
            className="items-center gap-3 rounded-xl px-3 py-2.5"
            onSelect={(event) => {
              event.preventDefault();
              setTemporaryOpen(true);
            }}
          >
            <div className="flex size-7 shrink-0 items-center justify-center text-primary">
              <Globe className="size-4.5" />
            </div>
            <div className="min-w-0 flex-1 whitespace-nowrap text-sm font-medium text-foreground">
              {t("library.importSourceTemporaryWebDav", "连接其他 WebDAV")}
            </div>
            <ChevronRight className="size-4 text-muted-foreground" />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <DesktopWebDavConnectDialog
        open={temporaryOpen}
        onClose={() => setTemporaryOpen(false)}
        onSubmit={handleConnectTemporaryWebDav}
      />
      <OpdsCatalogsDialog open={catalogsOpen} onOpenChange={setCatalogsOpen} />
      <DesktopWebDavImportBrowserDialog
        source={browserSource}
        onClose={() => setBrowserSource(null)}
      />
    </>
  );
}
