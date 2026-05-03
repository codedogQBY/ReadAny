import type { RootStackParamList } from "@/navigation/RootNavigator";
import { useLibraryStore } from "@/stores/library-store";
import {
  BookOpenIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloudIcon,
  LibraryIcon,
  Loader2Icon,
  SearchIcon,
} from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import {
  fontSize,
  fontWeight,
  radius,
  useColors,
  useTheme,
  withOpacity,
} from "@/styles/theme";
import {
  createImportDuplicateIndex,
  findLikelyDuplicateBook,
  normalizeImportIdentity,
  WebDavImportService,
  type ImportBooksResult,
  type WebDavImportEntry,
  type WebDavImportSource,
  type WebDavImportSourceKind,
} from "@readany/core";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { File, Paths } from "expo-file-system";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type Props = NativeStackScreenProps<RootStackParamList, "WebDavImportBrowser">;
type ImportState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "downloading"; current: number; total: number; currentName: string }
  | { phase: "importing"; total: number };

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
  return name.replace(/[\\/:*?"<>|\[\]{}#%&]/g, "_").trim() || `book-${Date.now()}`;
}

function createTempImportFile(bytes: Uint8Array, originalName: string): { uri: string; name: string } {
  const safeName = sanitizeFilename(originalName);
  const file = new File(Paths.cache, `readany-webdav-${Date.now()}-${safeName}`);
  if (file.exists) {
    file.delete();
  }
  file.write(bytes);
  return { uri: file.uri, name: safeName };
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

export function WebDavImportBrowserScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const { isDark } = useTheme();
  const layout = useResponsiveLayout();
  const source = route.params.source as WebDavImportSource;
  const importBooks = useLibraryStore((state) => state.importBooks);
  const books = useLibraryStore((state) => state.books);
  const service = useMemo(() => new WebDavImportService(source), [source]);
  const duplicateIndex = useMemo(() => createImportDuplicateIndex(books), [books]);

  const [currentPath, setCurrentPath] = useState("/");
  const [entries, setEntries] = useState<WebDavImportEntry[]>([]);
  const [search, setSearch] = useState("");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importState, setImportState] = useState<ImportState>({ phase: "idle" });

  const s = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.background,
        },
        content: {
          flex: 1,
          paddingHorizontal: layout.horizontalPadding,
          alignItems: "center",
        },
        contentInner: {
          flex: 1,
          width: "100%",
          maxWidth: layout.centeredContentWidth,
        },
        header: {
          paddingHorizontal: layout.horizontalPadding,
          paddingTop: 12,
          paddingBottom: 10,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: withOpacity(colors.border, 0.9),
          alignItems: "center",
        },
        headerInner: {
          width: "100%",
          maxWidth: layout.centeredContentWidth,
          gap: 12,
        },
        headerRow: {
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        },
        navBtn: {
          width: 36,
          height: 36,
          borderRadius: radius.full,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.card,
        },
        headerText: {
          flex: 1,
          minWidth: 0,
        },
        title: {
          fontSize: fontSize.xl,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
        subtitle: {
          marginTop: 2,
          fontSize: fontSize.sm,
          color: colors.mutedForeground,
        },
        breadcrumbRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        },
        breadcrumbChip: {
          borderRadius: radius.full,
          backgroundColor: colors.card,
          paddingHorizontal: 12,
          paddingVertical: 7,
        },
        breadcrumbText: {
          fontSize: fontSize.sm,
          color: colors.foreground,
        },
        searchWrap: {
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.92),
          backgroundColor: colors.card,
          paddingHorizontal: 12,
          height: 46,
        },
        searchInput: {
          flex: 1,
          minWidth: 0,
          padding: 0,
          fontSize: fontSize.base,
          color: colors.foreground,
        },
        summaryRow: {
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          paddingVertical: 12,
        },
        summaryText: {
          fontSize: fontSize.sm,
          color: colors.mutedForeground,
        },
        secondaryAction: {
          borderRadius: radius.full,
          backgroundColor: colors.card,
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.9),
        },
        secondaryActionText: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.medium,
          color: colors.foreground,
        },
        listContent: {
          paddingBottom: 112,
        },
        entryCard: {
          borderRadius: radius.xxl,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.92),
          backgroundColor: colors.card,
          paddingHorizontal: 14,
          paddingVertical: 13,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          marginBottom: 10,
        },
        entryIconWrap: {
          width: 40,
          height: 40,
          borderRadius: 14,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: withOpacity(colors.primary, 0.1),
        },
        entryText: {
          flex: 1,
          minWidth: 0,
        },
        entryTitle: {
          fontSize: fontSize.base,
          fontWeight: fontWeight.medium,
          color: colors.foreground,
        },
        entryMeta: {
          marginTop: 3,
          fontSize: fontSize.sm,
          lineHeight: 19,
          color: colors.mutedForeground,
        },
        entryTitleRow: {
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        },
        badge: {
          paddingHorizontal: 8,
          paddingVertical: 3,
          borderRadius: radius.full,
          backgroundColor: withOpacity("#d97706", 0.12),
        },
        badgeText: {
          fontSize: fontSize.xs,
          color: colors.foreground,
          fontWeight: fontWeight.medium,
        },
        checkCircle: {
          width: 22,
          height: 22,
          borderRadius: radius.full,
          borderWidth: 1.5,
          borderColor: withOpacity(colors.mutedForeground, 0.45),
          alignItems: "center",
          justifyContent: "center",
        },
        checkCircleSelected: {
          backgroundColor: colors.primary,
          borderColor: colors.primary,
        },
        disabledHint: {
          fontSize: fontSize.xs,
          color: colors.mutedForeground,
        },
        stateWrap: {
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          paddingHorizontal: 24,
        },
        stateTitle: {
          marginTop: 14,
          fontSize: fontSize.lg,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
        stateDesc: {
          marginTop: 8,
          fontSize: fontSize.sm,
          lineHeight: 21,
          color: colors.mutedForeground,
          textAlign: "center",
        },
        retryBtn: {
          marginTop: 18,
          height: 44,
          borderRadius: radius.full,
          paddingHorizontal: 18,
          backgroundColor: colors.primary,
          alignItems: "center",
          justifyContent: "center",
        },
        retryBtnText: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.semibold,
          color: colors.primaryForeground,
        },
        footerBar: {
          position: "absolute",
          left: layout.horizontalPadding,
          right: layout.horizontalPadding,
          bottom: 16,
          alignItems: "center",
        },
        footerInner: {
          width: "100%",
          maxWidth: layout.centeredContentWidth,
          borderRadius: 24,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.9),
          backgroundColor: isDark
            ? withOpacity(colors.card, 0.98)
            : withOpacity(colors.background, 0.98),
          paddingHorizontal: 14,
          paddingVertical: 12,
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.12,
          shadowRadius: 18,
          elevation: 6,
        },
        footerCopy: {
          flex: 1,
          minWidth: 0,
        },
        footerTitle: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
        footerMeta: {
          marginTop: 2,
          fontSize: fontSize.xs,
          color: colors.mutedForeground,
        },
        footerActions: {
          flexDirection: "row",
          gap: 8,
        },
        footerGhostBtn: {
          height: 40,
          borderRadius: radius.full,
          paddingHorizontal: 12,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.9),
          alignItems: "center",
          justifyContent: "center",
        },
        footerGhostText: {
          fontSize: fontSize.xs,
          fontWeight: fontWeight.medium,
          color: colors.foreground,
        },
        footerPrimaryBtn: {
          height: 40,
          borderRadius: radius.full,
          paddingHorizontal: 16,
          backgroundColor: colors.primary,
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 8,
        },
        footerPrimaryText: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.semibold,
          color: colors.primaryForeground,
        },
      }),
    [colors, isDark, layout.centeredContentWidth, layout.horizontalPadding],
  );

  const loadEntries = useCallback(
    async (nextPath: string) => {
      setLoading(true);
      setError(null);
      try {
        const listing = await service.list(nextPath);
        setCurrentPath(listing.currentPath);
        setEntries(listing.entries);
        setSelectedPaths((current) =>
          current.filter((path) => listing.entries.some((entry) => entry.relativePath === path)),
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    },
    [service],
  );

  useEffect(() => {
    void loadEntries("/");
  }, [loadEntries]);

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

  const importableVisibleEntries = useMemo(
    () => visibleEntries.filter(({ entry }) => entry.importable),
    [visibleEntries],
  );
  const likelyDuplicateVisibleCount = useMemo(
    () => visibleEntries.filter(({ likelyDuplicate }) => likelyDuplicate).length,
    [visibleEntries],
  );

  const selectedCount = selectedPaths.length;

  const toggleSelected = useCallback((relativePath: string) => {
    setSelectedPaths((current) =>
      current.includes(relativePath)
        ? current.filter((path) => path !== relativePath)
        : [...current, relativePath],
    );
  }, []);

  const handleEntryPress = useCallback(
    (entry: WebDavImportEntry) => {
      if (entry.isDirectory) {
        void loadEntries(entry.relativePath);
        return;
      }
      if (!entry.importable) return;
      toggleSelected(entry.relativePath);
    },
    [loadEntries, toggleSelected],
  );

  const handleGoBack = () => {
    if (currentPath !== "/") {
      const parentPath = currentPath.split("/").slice(0, -1).join("/") || "/";
      void loadEntries(parentPath);
      return;
    }
    navigation.goBack();
  };

  const runImport = useCallback(
    async (targets: WebDavImportEntry[]) => {
      if (targets.length === 0) return;

      const tempFiles: Array<{ uri: string; name?: string }> = [];
      try {
        for (let index = 0; index < targets.length; index += 1) {
          const entry = targets[index];
          setImportState({
            phase: "downloading",
            current: index + 1,
            total: targets.length,
            currentName: entry.name,
          });
          const bytes = await service.downloadFile(entry.relativePath);
          tempFiles.push(createTempImportFile(bytes, entry.name));
        }

        setImportState({ phase: "importing", total: tempFiles.length });
        const result = await importBooks(tempFiles);
        setImportState({ phase: "idle" });
        setSelectedPaths([]);
        Alert.alert(
          t("common.success", "成功！"),
          formatImportResultMessage(t, result),
          [
            {
              text: t("library.webdavImportContinue", "继续浏览"),
              style: "cancel",
            },
            {
              text: t("library.webdavImportBackToLibrary", "返回书库"),
              onPress: () => navigation.goBack(),
            },
          ],
        );
      } catch (err) {
        setImportState({ phase: "idle" });
        Alert.alert(
          t("common.failed", "失败"),
          err instanceof Error ? err.message : String(err),
        );
      } finally {
        for (const tempFile of tempFiles) {
          try {
            const file = new File(tempFile.uri);
            if (file.exists) file.delete();
          } catch {
            // Ignore temp cleanup failures.
          }
        }
      }
    },
    [importBooks, navigation, service, t],
  );

  const handleImportSelected = () => {
    const targets = entries.filter((entry) => selectedPaths.includes(entry.relativePath));
    void runImport(targets);
  };

  const handleImportCurrentFolder = () => {
    void (async () => {
      try {
        setImportState({
          phase: "loading",
        });
        const targets = await service.collectImportableFiles(currentPath);
        if (targets.length === 0) {
          setImportState({ phase: "idle" });
          Alert.alert(
            t("library.webdavImportNoImportableTitle", "这个文件夹里还没有可导入的书"),
            t(
              "library.webdavImportNoImportableDesc",
              "换一个文件夹看看，或者继续往更深的目录里找。",
            ),
          );
          return;
        }
        await runImport(targets);
      } catch (err) {
        setImportState({ phase: "idle" });
        Alert.alert(
          t("common.failed", "失败"),
          err instanceof Error ? err.message : String(err),
        );
      }
    })();
  };

  const renderState = () => {
    if (loading) {
      return (
        <View style={s.stateWrap}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={s.stateTitle}>{t("library.webdavImportLoading", "正在读取远端书库...")}</Text>
          <Text style={s.stateDesc}>
            {t("library.webdavImportBrowserSubtitle", "浏览远端目录，挑书导入当前书架。")}
          </Text>
        </View>
      );
    }

    if (error) {
      return (
        <View style={s.stateWrap}>
          <CloudIcon size={28} color={colors.destructive} />
          <Text style={s.stateTitle}>{t("library.webdavImportLoadFailed", "读取书库失败")}</Text>
          <Text style={s.stateDesc}>{error}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => void loadEntries(currentPath)}>
            <Text style={s.retryBtnText}>{t("common.retry", "重试")}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (visibleEntries.length === 0) {
      return (
        <View style={s.stateWrap}>
          <LibraryIcon size={28} color={colors.mutedForeground} />
          <Text style={s.stateTitle}>
            {search.trim()
              ? t("library.webdavImportNoSearchResults", "没找到匹配的文件")
              : t("library.webdavImportEmptyFolder", "这个文件夹目前是空的")}
          </Text>
          <Text style={s.stateDesc}>
            {search.trim()
              ? t(
                  "library.webdavImportNoSearchResultsDesc",
                  "试试换个关键词，或者回到上一级目录看看别的书。",
                )
              : t(
                  "library.webdavImportEmptyFolderDesc",
                  "继续浏览其他目录，或者换一个来源再看看有没有书可以导。",
                )}
          </Text>
        </View>
      );
    }

    return (
      <FlatList
        data={visibleEntries}
        keyExtractor={({ entry }) => entry.relativePath}
        contentContainerStyle={s.listContent}
        renderItem={({ item }) => {
          const { entry, likelyDuplicate } = item;
          const selected = selectedPaths.includes(entry.relativePath);
          return (
            <TouchableOpacity
              style={s.entryCard}
              onPress={() => handleEntryPress(entry)}
              activeOpacity={0.85}
            >
              <View style={s.entryIconWrap}>
                {entry.isDirectory ? (
                  <LibraryIcon size={18} color={colors.primary} />
                ) : (
                  <BookOpenIcon size={18} color={entry.importable ? colors.primary : colors.mutedForeground} />
                )}
              </View>
              <View style={s.entryText}>
                <View style={s.entryTitleRow}>
                  <Text style={s.entryTitle} numberOfLines={1}>
                    {entry.name}
                  </Text>
                  {!entry.isDirectory && likelyDuplicate ? (
                    <View style={s.badge}>
                      <Text style={s.badgeText}>
                        {t("library.webdavImportLikelyDuplicate", "可能重复")}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text style={s.entryMeta} numberOfLines={1}>
                  {entry.isDirectory
                    ? t("library.webdavImportFolderMeta", {
                      defaultValue: "文件夹 · {{date}}",
                        date: entry.lastModified ? formatDate(entry.lastModified) : "—",
                      })
                    : t("library.webdavImportFileMeta", {
                        defaultValue: "{{size}} · {{date}}",
                        size: formatBytes(entry.size),
                        date: entry.lastModified ? formatDate(entry.lastModified) : "—",
                      })}
                </Text>
                {!entry.isDirectory && !entry.importable ? (
                  <Text style={s.disabledHint}>
                    {t("library.webdavImportUnsupported", "暂不支持这个文件格式")}
                  </Text>
                ) : null}
              </View>
              {entry.isDirectory ? (
                <ChevronRightIcon size={16} color={colors.mutedForeground} />
              ) : (
                <View style={[s.checkCircle, selected && s.checkCircleSelected]}>
                  {selected ? <CheckIcon size={12} color={colors.primaryForeground} /> : null}
                </View>
              )}
            </TouchableOpacity>
          );
        }}
      />
    );
  };

  const footerTitle =
    importState.phase === "downloading"
      ? t("library.webdavImportDownloadingProgress", {
          defaultValue: "正在下载 {{current}} / {{total}}",
          current: importState.current,
          total: importState.total,
        })
      : importState.phase === "importing"
        ? t("library.webdavImportImportingProgress", {
            defaultValue: "正在导入 {{total}} 本书",
            total: importState.total,
          })
        : selectedCount > 0
          ? t("library.webdavImportSelectedCount", {
              defaultValue: "已选 {{count}} 本",
              count: selectedCount,
            })
          : t("library.webdavImportReady", "挑几本书带进当前书架");

  const footerMeta =
    importState.phase === "downloading"
      ? importState.currentName
      : selectedCount > 0
        ? t("library.webdavImportSelectionHint", "可以继续多选，或直接导入所选")
        : t("library.webdavImportFolderHint", {
            defaultValue: "本层 {{count}} 本可导入，{{duplicates}} 本可能已在书库",
            count: importableVisibleEntries.length,
            duplicates: likelyDuplicateVisibleCount,
          });

  const importBusy = importState.phase !== "idle";

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <View style={s.headerInner}>
          <View style={s.headerRow}>
            <TouchableOpacity style={s.navBtn} onPress={handleGoBack} activeOpacity={0.8}>
              <ChevronLeftIcon size={18} color={colors.foreground} />
            </TouchableOpacity>
            <View style={s.headerText}>
              <Text style={s.title}>{getSourceLabel(source.kind, t)}</Text>
              <Text style={s.subtitle} numberOfLines={1}>
                {source.url}
              </Text>
            </View>
            <View style={s.navBtn}>
              <CloudIcon size={16} color={colors.primary} />
            </View>
          </View>
          <View style={s.breadcrumbRow}>
            <View style={s.breadcrumbChip}>
              <Text style={s.breadcrumbText} numberOfLines={1}>
                {currentPath === "/"
                  ? t("library.webdavImportRootLabel", "浏览起点")
                  : currentPath}
              </Text>
            </View>
          </View>
          <View style={s.searchWrap}>
            <SearchIcon size={16} color={colors.mutedForeground} />
            <TextInput
              style={s.searchInput}
              value={search}
              onChangeText={setSearch}
              placeholder={t("library.webdavImportSearchPlaceholder", "搜索文件名...")}
              placeholderTextColor={colors.mutedForeground}
            />
          </View>
        </View>
      </View>

      <View style={s.content}>
        <View style={s.contentInner}>
          {!loading && !error ? (
            <View style={s.summaryRow}>
              <Text style={s.summaryText}>
                {t("library.webdavImportSummary", {
                  defaultValue: "当前可见 {{count}} 项，其中 {{books}} 本可导入，{{duplicates}} 本可能重复",
                  count: visibleEntries.length,
                  books: importableVisibleEntries.length,
                  duplicates: likelyDuplicateVisibleCount,
                })}
              </Text>
              {importableVisibleEntries.length > 0 ? (
                <TouchableOpacity
                  style={s.secondaryAction}
                  onPress={handleImportCurrentFolder}
                  activeOpacity={0.85}
                  disabled={importBusy}
                >
                  <Text style={s.secondaryActionText}>
                    {t("library.webdavImportImportFolder", "导入本层书籍")}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}
          {renderState()}
        </View>
      </View>

      {(selectedCount > 0 || importBusy) && (
        <View pointerEvents="box-none" style={s.footerBar}>
          <View style={s.footerInner}>
            <View style={s.footerCopy}>
              <Text style={s.footerTitle}>{footerTitle}</Text>
              <Text style={s.footerMeta} numberOfLines={1}>
                {footerMeta}
              </Text>
            </View>
            <View style={s.footerActions}>
              {selectedCount > 0 ? (
                <TouchableOpacity
                  style={s.footerGhostBtn}
                  onPress={() => setSelectedPaths([])}
                  activeOpacity={0.85}
                  disabled={importBusy}
                >
                  <Text style={s.footerGhostText}>{t("library.webdavImportClearSelection", "清空")}</Text>
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={s.footerPrimaryBtn}
                onPress={handleImportSelected}
                activeOpacity={0.9}
                disabled={selectedCount === 0 || importBusy}
              >
                {importBusy ? <Loader2Icon size={14} color={colors.primaryForeground} /> : null}
                <Text style={s.footerPrimaryText}>
                  {selectedCount > 0
                    ? t("library.webdavImportImportSelectedCount", {
                        count: selectedCount,
                      })
                    : t("library.webdavImportImportSelected", "导入所选")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}
