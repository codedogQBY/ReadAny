import { BookCard } from "@/components/library/BookCard";
import { type ExtractorRef, ExtractorWebView } from "@/components/rag/ExtractorWebView";
import {
  ArrowDownAZIcon,
  ArrowUpAZIcon,
  ClockIcon,
  PlusIcon,
  SearchIcon,
  SortAscIcon,
  XIcon,
} from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import { openMobileBook } from "@/lib/library/open-mobile-book";
import { setCallback, setExtractorRef } from "@/lib/rag/auto-vectorize-service";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { WebDavConnectSheet } from "@/screens/library/WebDavConnectSheet";
import { WebDavImportSourceSheet } from "@/screens/library/WebDavImportSourceSheet";
import { useLibraryStore } from "@/stores/library-store";
import {
  type ThemeColors,
  fontSize,
  fontWeight,
  radius,
  useColors,
  useTheme,
  withOpacity,
} from "@/styles/theme";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  DEFAULT_WEBDAV_IMPORT_REMOTE_ROOT,
  type WebDavImportSource,
  getPlatformService,
} from "@readany/core";
import { onLibraryChanged } from "@readany/core/events/library-events";
import { useSyncStore } from "@readany/core/stores";
import { SYNC_SECRET_KEYS } from "@readany/core/sync/sync-backend";
import type { Book, SortField } from "@readany/core/types";
import * as DocumentPicker from "expo-document-picker";
/**
 * LibraryScreen — matching Tauri mobile LibraryPage exactly.
 * Features: header search/sort/import, tag filter, vectorization progress banner,
 * tag management sheet, book grid (3 cols), empty/loading states.
 */
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { TagManagementSheet } from "./library/TagManagementSheet";
import { useBookDownload } from "./library/useBookDownload";
import { useVectorizationQueue } from "./library/useVectorizationQueue";

const BOOK_PNG = require("../../assets/book.png");
const BOOK_DARK_PNG = require("../../assets/book-dark.png");

type Nav = NativeStackNavigationProp<RootStackParamList>;

const NUM_COLUMNS = 3;
const GRID_GAP = 12;

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

const SORT_OPTIONS: { field: SortField; labelKey: string }[] = [
  { field: "lastOpenedAt", labelKey: "library.sortRecent" },
  { field: "addedAt", labelKey: "library.sortAdded" },
  { field: "title", labelKey: "library.sortTitle" },
  { field: "author", labelKey: "library.sortAuthor" },
  { field: "progress", labelKey: "library.sortProgress" },
];

export function LibraryScreen() {
  const colors = useColors();
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const nav = useNavigation<Nav>();
  const layout = useResponsiveLayout();
  const gridGap = layout.isTablet ? 16 : GRID_GAP;
  const columnCount = layout.isTabletLandscape ? 5 : layout.isTablet ? 4 : NUM_COLUMNS;
  const contentWidth = layout.centeredContentWidth;
  const gridItemWidth = Math.floor((contentWidth - gridGap * (columnCount - 1)) / columnCount);
  const searchExpandedWidth = Math.min(
    layout.isTabletLandscape ? 420 : layout.isTablet ? 360 : layout.width - 210,
    Math.max(180, contentWidth - 220),
  );
  const s = useMemo(
    () =>
      makeStyles(colors, {
        horizontalPadding: layout.horizontalPadding,
        contentWidth,
        gridGap,
        gridItemWidth,
      }),
    [colors, contentWidth, gridGap, gridItemWidth, layout.horizontalPadding],
  );
  const [showSearch, setShowSearch] = useState(false);
  const [showSort, setShowSort] = useState(false);
  const searchAnim = useRef(new Animated.Value(0)).current;
  const searchInputRef = useRef<TextInput>(null);

  const [tagSheetOpen, setTagSheetOpen] = useState(false);
  const [tagSheetBook, setTagSheetBook] = useState<Book | null>(null);
  const [sourceSheetOpen, setSourceSheetOpen] = useState(false);
  const [sourceSheetAnchor, setSourceSheetAnchor] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const [temporaryWebDavOpen, setTemporaryWebDavOpen] = useState(false);
  const [isPickingImport, setIsPickingImport] = useState(false);
  const [pendingLocalImport, setPendingLocalImport] = useState(false);
  const importButtonAnchorRef = useRef<View>(null);
  const emptyImportAnchorRef = useRef<View>(null);
  const localImportInFlightRef = useRef(false);

  const extractorRef = useRef<ExtractorRef>(null);
  const loadSyncConfig = useSyncStore((state) => state.loadConfig);
  const syncConfig = useSyncStore((state) => state.config);
  const syncBackendType = useSyncStore((state) => state.backendType);

  const {
    books,
    isLoaded,
    isImporting,
    filter,
    allTags,
    activeTag,
    loadBooks,
    importBooks,
    removeBook,
    setFilter,
    setActiveTag,
    addTag,
    addTagToBook,
    removeTagFromBook,
    removeTag,
    renameTag,
  } = useLibraryStore();

  const { downloadingBookId, downloadingBookTitle, downloadBook } = useBookDownload({
    loadBooks,
    onSuccess: (bookId) => {
      void openMobileBook({ bookId, navigation: nav, t });
    },
  });

  const { vectorQueue, vectorizingBookId, vectorProgress, handleVectorize } = useVectorizationQueue(
    { extractorRef, nav },
  );

  const openSearch = useCallback(() => {
    setShowSearch(true);
    Animated.timing(searchAnim, { toValue: 1, duration: 300, useNativeDriver: false }).start(() => {
      searchInputRef.current?.focus();
    });
  }, [searchAnim]);

  const closeSearch = useCallback(() => {
    Animated.timing(searchAnim, { toValue: 0, duration: 250, useNativeDriver: false }).start(() => {
      setShowSearch(false);
      setFilter({ search: "" });
    });
  }, [searchAnim, setFilter]);

  useEffect(() => {
    loadBooks();
  }, [loadBooks]);
  useEffect(() => {
    void loadSyncConfig();
  }, [loadSyncConfig]);

  useEffect(() => {
    setExtractorRef(extractorRef.current);
    setCallback((bookId, progress) => {
      console.log(
        `[AutoVectorize] Book ${bookId}: ${progress.status} (${Math.round(progress.progress * 100)}%)`,
      );
    });
    return () => {
      setExtractorRef(null);
      setCallback(null);
    };
  }, []);

  useEffect(() => {
    return onLibraryChanged((deletedTags) => loadBooks(deletedTags));
  }, [loadBooks]);

  const filteredBooks = useMemo(() => {
    let result = [...books];
    if (activeTag === "__uncategorized__") {
      result = result.filter((b) => b.tags.length === 0);
    } else if (activeTag) {
      result = result.filter((b) => b.tags.includes(activeTag));
    }
    const search = filter.search.toLowerCase().trim();
    if (search) {
      result = result.filter(
        (b) =>
          b.meta.title.toLowerCase().includes(search) ||
          b.meta.author?.toLowerCase().includes(search) ||
          b.tags.some((tag) => tag.toLowerCase().includes(search)),
      );
    }
    const { sortField, sortOrder } = filter;
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "title":
          cmp = a.meta.title.localeCompare(b.meta.title);
          break;
        case "author":
          cmp = (a.meta.author || "").localeCompare(b.meta.author || "");
          break;
        case "addedAt":
          cmp = (a.addedAt || 0) - (b.addedAt || 0);
          break;
        case "lastOpenedAt":
          cmp = (a.lastOpenedAt || 0) - (b.lastOpenedAt || 0);
          break;
        case "progress":
          cmp = a.progress - b.progress;
          break;
      }
      return sortOrder === "desc" ? -cmp : cmp;
    });
    return result;
  }, [books, filter, activeTag]);

  const handleLocalImport = useCallback(async () => {
    if (localImportInFlightRef.current) return;
    localImportInFlightRef.current = true;
    setIsPickingImport(true);

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "application/epub+zip",
          "application/pdf",
          "application/x-mobipocket-ebook",
          "application/vnd.amazon.ebook",
          "application/vnd.comicbook+zip",
          "application/x-fictionbook+xml",
          "text/plain",
          "application/octet-stream",
        ],
        multiple: true,
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) return;
      const files = result.assets.map((a) => ({ uri: a.uri, name: a.name }));
      const summary = await importBooks(files);
      Alert.alert(
        t("common.success", "成功！"),
        t("library.importResultSummary", {
          imported: summary.imported.length,
          skipped: summary.skippedDuplicates.length,
          failed: summary.failures.length,
        }),
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("Different document picking in progress")) {
        console.error("Import failed:", err);
      }
    } finally {
      localImportInFlightRef.current = false;
      setIsPickingImport(false);
    }
  }, [importBooks]);

  const handlePickLocalFromSourceMenu = useCallback(() => {
    if (localImportInFlightRef.current || pendingLocalImport) return;
    setPendingLocalImport(true);
    setSourceSheetOpen(false);
  }, [pendingLocalImport]);

  useEffect(() => {
    if (Platform.OS === "ios" || !pendingLocalImport || sourceSheetOpen) return;

    const timer = setTimeout(() => {
      setPendingLocalImport(false);
      void handleLocalImport();
    }, 180);

    return () => clearTimeout(timer);
  }, [handleLocalImport, pendingLocalImport, sourceSheetOpen]);

  const handleSourceSheetDismiss = useCallback(() => {
    if (!pendingLocalImport || Platform.OS !== "ios") return;

    requestAnimationFrame(() => {
      setPendingLocalImport(false);
      void handleLocalImport();
    });
  }, [handleLocalImport, pendingLocalImport]);

  const handleOpenImportSources = useCallback((anchorRef?: RefObject<View | null>) => {
    const openWithFallback = () => {
      setSourceSheetAnchor(null);
      setSourceSheetOpen(true);
    };

    if (!anchorRef?.current || typeof anchorRef.current.measureInWindow !== "function") {
      openWithFallback();
      return;
    }

    anchorRef.current.measureInWindow((x, y, width, height) => {
      if ([x, y, width, height].some((value) => Number.isNaN(value) || value <= 0)) {
        openWithFallback();
        return;
      }

      setSourceSheetAnchor({ x, y, width, height });
      setSourceSheetOpen(true);
    });
  }, []);

  const handleOpenSavedWebDav = useCallback(async () => {
    setSourceSheetOpen(false);

    if (syncBackendType !== "webdav" || syncConfig?.type !== "webdav") {
      Alert.alert(
        t("library.importSourceSavedWebDavMissingTitle", "还没有可用的 WebDAV 书库"),
        t(
          "library.importSourceSavedWebDavMissing",
          "还没有可用的 WebDAV 配置，先去同步设置里连上你的书库。",
        ),
        [
          { text: t("common.cancel", "取消"), style: "cancel" },
          {
            text: t("settings.syncTitle", "WebDAV 同步"),
            onPress: () => nav.navigate("SyncSettings"),
          },
        ],
      );
      return;
    }

    const platform = getPlatformService();
    const password = await platform.kvGetItem(SYNC_SECRET_KEYS.webdav);
    if (!password) {
      Alert.alert(
        t("library.importSourceSavedWebDavMissingTitle", "还没有可用的 WebDAV 书库"),
        t(
          "library.importSourceSavedWebDavMissingSecret",
          "已经找到 WebDAV 地址，但缺少密码。去同步设置里重新保存一次就能继续。",
        ),
        [
          { text: t("common.cancel", "取消"), style: "cancel" },
          {
            text: t("settings.syncTitle", "WebDAV 同步"),
            onPress: () => nav.navigate("SyncSettings"),
          },
        ],
      );
      return;
    }

    const source: WebDavImportSource = {
      kind: "saved",
      url: deriveImportBaseUrl(syncConfig.url, syncConfig.remoteRoot),
      username: syncConfig.username,
      password,
      remoteRoot: DEFAULT_WEBDAV_IMPORT_REMOTE_ROOT,
      allowInsecure: syncConfig.allowInsecure ?? false,
    };
    nav.navigate("WebDavImportBrowser", { source });
  }, [nav, syncBackendType, syncConfig, t]);

  const handleOpenTemporaryWebDav = useCallback(() => {
    setSourceSheetOpen(false);
    setTemporaryWebDavOpen(true);
  }, []);

  const handleConnectTemporaryWebDav = useCallback(
    async (source: WebDavImportSource) => {
      const { WebDavImportService } = await import("@readany/core");
      const service = new WebDavImportService(source);
      await service.testConnection();
      setTemporaryWebDavOpen(false);
      nav.navigate("WebDavImportBrowser", { source });
    },
    [nav],
  );

  const handleOpen = useCallback(
    async (book: Book) => {
      if (book.syncStatus === "remote") {
        await downloadBook(book);
        return;
      }
      await openMobileBook({ bookId: book.id, navigation: nav, t });
    },
    [downloadBook, nav, t],
  );

  const handleManageTags = useCallback((book: Book) => {
    setTagSheetBook(book);
    setTagSheetOpen(true);
  }, []);

  const handleSortChange = useCallback(
    (field: SortField) => {
      if (filter.sortField === field) {
        setFilter({ sortOrder: filter.sortOrder === "asc" ? "desc" : "asc" });
      } else {
        setFilter({
          sortField: field,
          sortOrder: field === "title" || field === "author" ? "asc" : "desc",
        });
      }
      setShowSort(false);
    },
    [filter, setFilter],
  );

  const isEmpty = filteredBooks.length === 0;
  const hasBooks = books.length > 0;

  const renderBookCard = useCallback(
    ({ item }: { item: Book }) => (
      <View style={s.gridItem}>
        <BookCard
          book={item}
          cardWidth={gridItemWidth}
          onOpen={handleOpen}
          onDelete={removeBook}
          onManageTags={handleManageTags}
          onVectorize={handleVectorize}
          isVectorizing={vectorizingBookId === item.id}
          isQueued={vectorQueue.some((b) => b.id === item.id)}
          vectorProgress={vectorizingBookId === item.id ? vectorProgress : null}
        />
      </View>
    ),
    [
      gridItemWidth,
      handleOpen,
      removeBook,
      handleManageTags,
      handleVectorize,
      vectorizingBookId,
      vectorQueue,
      vectorProgress,
    ],
  );

  return (
    <SafeAreaView style={[s.container, { backgroundColor: colors.background }]} edges={["top"]}>
      {showSearch && (
        <Pressable
          style={[StyleSheet.absoluteFill, { zIndex: 10 }]}
          onPress={() => {
            Keyboard.dismiss();
            if (!filter.search.trim()) closeSearch();
          }}
        />
      )}

      <ExtractorWebView ref={extractorRef} />

      {/* Header */}
      <View style={[s.header, { zIndex: 20 }]}>
        <View style={s.headerInner}>
          <View style={s.headerRow}>
            <Text style={s.headerTitle}>{t("sidebar.library", "书库")}</Text>
            <View style={s.headerActions}>
              {hasBooks && (
                <Animated.View
                  style={[
                    s.animatedSearchWrap,
                    {
                      width: searchAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [36, searchExpandedWidth],
                      }),
                      borderBottomColor: searchAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: ["transparent", colors.primary],
                      }),
                      borderBottomWidth: searchAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0, 1],
                      }),
                    },
                  ]}
                >
                  <TouchableOpacity
                    style={s.headerBtn}
                    onPress={() => {
                      if (showSearch) {
                        if (!filter.search.trim()) {
                          closeSearch();
                          Keyboard.dismiss();
                        }
                      } else {
                        openSearch();
                      }
                    }}
                    activeOpacity={0.7}
                  >
                    <SearchIcon
                      size={18}
                      color={showSearch ? colors.primary : colors.mutedForeground}
                    />
                  </TouchableOpacity>
                  <Animated.View
                    style={{
                      flex: 1,
                      opacity: searchAnim,
                      flexDirection: "row",
                      alignItems: "center",
                    }}
                  >
                    <TextInput
                      ref={searchInputRef}
                      style={s.searchInputInline}
                      placeholder={t("library.searchPlaceholder", "搜索...")}
                      placeholderTextColor={colors.mutedForeground}
                      value={filter.search}
                      onChangeText={(text) => setFilter({ search: text })}
                      onBlur={() => {
                        if (!filter.search.trim()) closeSearch();
                      }}
                      returnKeyType="search"
                    />
                    {filter.search.length > 0 && showSearch && (
                      <TouchableOpacity
                        style={s.clearSearchBtn}
                        onPress={() => {
                          setFilter({ search: "" });
                          searchInputRef.current?.focus();
                        }}
                      >
                        <XIcon size={14} color={colors.mutedForeground} />
                      </TouchableOpacity>
                    )}
                  </Animated.View>
                </Animated.View>
              )}
              {hasBooks && (
                <TouchableOpacity style={s.headerBtn} onPress={() => setShowSort(!showSort)}>
                  <SortAscIcon size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}
              <View ref={importButtonAnchorRef} collapsable={false}>
                <TouchableOpacity
                  style={s.importBtn}
                  onPress={() => handleOpenImportSources(importButtonAnchorRef)}
                  disabled={isImporting || isPickingImport}
                  activeOpacity={0.8}
                >
                  {isImporting || isPickingImport ? (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  ) : (
                    <PlusIcon size={18} color={colors.primaryForeground} />
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {hasBooks && allTags.length > 0 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={s.tagScroll}
              contentContainerStyle={s.tagScrollContent}
            >
              <TouchableOpacity
                style={[s.tagChip, !activeTag && s.tagChipActive]}
                onPress={() => setActiveTag("")}
              >
                <Text style={[s.tagChipText, !activeTag && s.tagChipTextActive]}>
                  {t("library.all", "全部")}
                </Text>
              </TouchableOpacity>
              {allTags.map((tag) => (
                <TouchableOpacity
                  key={tag}
                  style={[s.tagChip, activeTag === tag && s.tagChipActive]}
                  onPress={() => setActiveTag(activeTag === tag ? "" : tag)}
                >
                  <Text style={[s.tagChipText, activeTag === tag && s.tagChipTextActive]}>
                    {tag}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                style={[s.tagChip, activeTag === "__uncategorized__" && s.tagChipActive]}
                onPress={() =>
                  setActiveTag(activeTag === "__uncategorized__" ? "" : "__uncategorized__")
                }
              >
                <Text
                  style={[s.tagChipText, activeTag === "__uncategorized__" && s.tagChipTextActive]}
                >
                  {t("sidebar.uncategorized", "未分类")}
                </Text>
              </TouchableOpacity>
            </ScrollView>
          )}
        </View>
      </View>

      {/* Sort dropdown */}
      <Modal
        visible={showSort}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSort(false)}
      >
        <Pressable style={s.sortOverlay} onPress={() => setShowSort(false)} />
        <View style={s.sortDropdown}>
          {SORT_OPTIONS.map(({ field, labelKey }) => (
            <TouchableOpacity
              key={field}
              style={[s.sortItem, filter.sortField === field && s.sortItemActive]}
              onPress={() => handleSortChange(field)}
            >
              {field === "lastOpenedAt" ? (
                <ClockIcon size={14} color={colors.mutedForeground} />
              ) : filter.sortField === field && filter.sortOrder === "asc" ? (
                <ArrowUpAZIcon size={14} color={colors.mutedForeground} />
              ) : (
                <ArrowDownAZIcon size={14} color={colors.mutedForeground} />
              )}
              <Text style={[s.sortText, filter.sortField === field && s.sortTextActive]}>
                {t(labelKey)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </Modal>

      {/* Content */}
      <View style={s.content}>
        <View style={s.contentInner}>
          {!isLoaded && (
            <View style={s.loadingWrap}>
              <ActivityIndicator size="large" color={colors.mutedForeground} />
            </View>
          )}
          {isImporting && (
            <View style={s.importBanner}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={s.importBannerText}>{t("library.importing", "正在导入...")}</Text>
            </View>
          )}
          {downloadingBookId && (
            <View style={s.downloadBanner}>
              <ActivityIndicator size="small" color={colors.primary} />
              <View style={s.downloadBannerInfo}>
                <Text style={s.downloadBannerStatus}>{t("library.downloading", "下载中")}</Text>
                <Text style={s.downloadBannerTitle} numberOfLines={1}>
                  {downloadingBookTitle}
                </Text>
              </View>
            </View>
          )}
          {isLoaded && books.length === 0 && (
            <View style={s.emptyWrap}>
              <Image
                source={isDark ? BOOK_DARK_PNG : BOOK_PNG}
                style={{ width: 160, height: 160 }}
              />
              <Text style={s.emptyTitle}>{t("library.empty", "暂无书籍")}</Text>
              <Text style={s.emptyHint}>{t("library.emptyHint", "导入电子书开始阅读之旅")}</Text>
              <View ref={emptyImportAnchorRef} collapsable={false}>
                <TouchableOpacity
                  style={s.emptyImportBtn}
                  onPress={() => handleOpenImportSources(emptyImportAnchorRef)}
                  disabled={isPickingImport}
                  activeOpacity={0.8}
                >
                  <Text style={s.emptyImportText}>{t("library.importFirst", "导入书籍")}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
          {isLoaded && hasBooks && isEmpty && (
            <View style={s.noResultsWrap}>
              <SearchIcon size={40} color={withOpacity(colors.mutedForeground, 0.3)} />
              <Text style={s.noResultsText}>{t("library.noResults", "没有找到匹配的书籍")}</Text>
            </View>
          )}
          {isLoaded && hasBooks && filter.search && !isEmpty && (
            <Text style={s.resultsCount}>
              {t("library.resultsCount", { count: filteredBooks.length })}
            </Text>
          )}
          {isLoaded && !isEmpty && (
            <FlatList
              data={filteredBooks}
              renderItem={renderBookCard}
              keyExtractor={(item) => item.id}
              key={`library-grid-${columnCount}`}
              numColumns={columnCount}
              columnWrapperStyle={s.gridRow}
              contentContainerStyle={s.gridContent}
              showsVerticalScrollIndicator={false}
            />
          )}
        </View>
      </View>

      <TagManagementSheet
        visible={tagSheetOpen}
        book={tagSheetBook}
        allTags={allTags}
        onClose={() => setTagSheetOpen(false)}
        onAddTag={addTag}
        onAddTagToBook={addTagToBook}
        onRemoveTagFromBook={removeTagFromBook}
        onRemoveTag={removeTag}
        onRenameTag={renameTag}
      />
      <WebDavImportSourceSheet
        visible={sourceSheetOpen}
        hasSavedWebDav={syncBackendType === "webdav" && syncConfig?.type === "webdav"}
        anchor={sourceSheetAnchor}
        localImportBusy={isPickingImport}
        onClose={() => setSourceSheetOpen(false)}
        onDismiss={handleSourceSheetDismiss}
        onPickLocal={handlePickLocalFromSourceMenu}
        onPickSavedWebDav={() => void handleOpenSavedWebDav()}
        onPickTemporaryWebDav={handleOpenTemporaryWebDav}
      />
      <WebDavConnectSheet
        visible={temporaryWebDavOpen}
        onClose={() => setTemporaryWebDavOpen(false)}
        onSubmit={handleConnectTemporaryWebDav}
      />
    </SafeAreaView>
  );
}

const makeStyles = (
  colors: ThemeColors,
  layout: {
    horizontalPadding: number;
    contentWidth: number;
    gridGap: number;
    gridItemWidth: number;
  },
) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingHorizontal: layout.horizontalPadding,
      paddingTop: 12,
      paddingBottom: 8,
      alignItems: "center",
    },
    headerInner: { width: "100%", maxWidth: layout.contentWidth },
    headerRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8,
    },
    headerTitle: {
      fontSize: fontSize["2xl"],
      fontWeight: fontWeight.bold,
      color: colors.foreground,
    },
    headerActions: { flexDirection: "row", alignItems: "center", gap: 4 },
    headerBtn: {
      width: 36,
      height: 36,
      borderRadius: radius.full,
      alignItems: "center",
      justifyContent: "center",
    },
    importBtn: {
      width: 36,
      height: 36,
      borderRadius: radius.full,
      backgroundColor: colors.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    animatedSearchWrap: {
      flexDirection: "row",
      alignItems: "center",
      height: 36,
      overflow: "hidden",
    },
    searchInputInline: {
      flex: 1,
      fontSize: fontSize.sm,
      color: colors.foreground,
      padding: 0,
      minWidth: 50,
    },
    clearSearchBtn: { width: 24, height: 36, alignItems: "center", justifyContent: "center" },
    tagScroll: { marginBottom: 4 },
    tagScrollContent: { gap: 6, paddingRight: 8 },
    tagChip: {
      paddingHorizontal: 12,
      paddingVertical: 5,
      borderRadius: radius.full,
      backgroundColor: colors.muted,
    },
    tagChipActive: { backgroundColor: colors.primary },
    tagChipText: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.mutedForeground,
    },
    tagChipTextActive: { color: colors.primaryForeground },
    sortOverlay: { flex: 1 },
    sortDropdown: {
      position: "absolute",
      top: 110,
      right: layout.horizontalPadding,
      minWidth: 180,
      backgroundColor: colors.card,
      borderRadius: radius.xl,
      borderWidth: 0.5,
      borderColor: colors.border,
      padding: 4,
      elevation: 5,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.3,
      shadowRadius: 8,
    },
    sortItem: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.lg,
    },
    sortItemActive: { backgroundColor: colors.muted },
    sortText: { fontSize: fontSize.xs, color: colors.foreground },
    sortTextActive: { fontWeight: fontWeight.medium },
    content: { flex: 1, paddingHorizontal: layout.horizontalPadding, alignItems: "center" },
    contentInner: { flex: 1, width: "100%", maxWidth: layout.contentWidth },
    loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
    importBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: colors.muted + "0D",
      borderRadius: radius.lg,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginBottom: 12,
    },
    importBannerText: { fontSize: fontSize.xs, color: colors.primary },
    downloadBanner: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      backgroundColor: colors.muted + "0D",
      borderRadius: radius.lg,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 12,
    },
    downloadBannerInfo: { flex: 1, minWidth: 0 },
    downloadBannerStatus: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.primary,
    },
    downloadBannerTitle: { fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
    vecBanner: {
      backgroundColor: colors.muted + "0D",
      borderRadius: radius.lg,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 12,
    },
    vecBannerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
    vecBannerInfo: { flex: 1, minWidth: 0 },
    vecBannerStatusRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    vecBannerStatus: {
      fontSize: fontSize.xs,
      fontWeight: fontWeight.medium,
      color: colors.primary,
    },
    vecBannerTitle: { fontSize: 12, color: colors.mutedForeground, marginTop: 2 },
    vecProgressBg: {
      height: 4,
      backgroundColor: colors.muted + "1A",
      borderRadius: radius.full,
      marginTop: 8,
      overflow: "hidden",
    },
    vecProgressFill: { height: 4, backgroundColor: colors.primary, borderRadius: radius.full },
    emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center" },
    emptyIconWrap: {
      width: 80,
      height: 80,
      borderRadius: radius.full,
      backgroundColor: colors.muted,
      alignItems: "center",
      justifyContent: "center",
      marginBottom: 16,
    },
    emptyTitle: {
      fontSize: fontSize.lg,
      fontWeight: fontWeight.semibold,
      color: colors.foreground,
      marginBottom: 8,
    },
    emptyHint: {
      fontSize: fontSize.sm,
      color: colors.mutedForeground,
      textAlign: "center",
      maxWidth: 240,
      marginBottom: 24,
    },
    emptyImportBtn: {
      backgroundColor: colors.primary,
      borderRadius: radius.full,
      paddingHorizontal: 24,
      paddingVertical: 10,
    },
    emptyImportText: {
      fontSize: fontSize.sm,
      fontWeight: fontWeight.medium,
      color: colors.primaryForeground,
    },
    noResultsWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingVertical: 80 },
    noResultsText: { fontSize: fontSize.sm, color: colors.mutedForeground, marginTop: 12 },
    resultsCount: { fontSize: fontSize.xs, color: colors.mutedForeground, marginBottom: 8 },
    gridRow: { gap: layout.gridGap, justifyContent: "flex-start" },
    gridContent: { paddingBottom: 24, paddingTop: 4, width: "100%" },
    gridItem: { width: layout.gridItemWidth, marginBottom: layout.gridGap },
  });
