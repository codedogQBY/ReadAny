import {
  BookOpenIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  GlobeIcon,
  Loader2Icon,
  RefreshCwIcon,
  SearchIcon,
  XIcon,
} from "@/components/ui/Icon";
import { useResponsiveLayout } from "@/hooks/use-responsive-layout";
import type { RootStackParamList } from "@/navigation/RootNavigator";
import { fontSize, fontWeight, radius, useColors, withOpacity } from "@/styles/theme";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import {
  type OpdsAcquisition,
  type OpdsCredentials,
  OpdsError,
  type OpdsErrorCode,
  type OpdsFeed,
  type OpdsPublication,
  listSupportedAcquisitions,
  opdsDescriptionToPlainText,
} from "@readany/core";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  findNodeHandle,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { createOpdsBackController } from "./opds-back-controller";
import { createOpdsCoverCache, readOpdsCover } from "./opds-cover-cache";
import {
  createOpdsDownloadController,
  getOpdsDownloadAccessibility,
} from "./opds-download-controller";
import { type OpdsFeedRow, createOpdsFeedRows } from "./opds-feed-rows";
import { opdsMobileRuntime } from "./opds-mobile-runtime";
import {
  type OpdsLoadMode,
  canSearchOpds,
  createInitialOpdsViewState,
  opdsViewReducer,
  selectOpdsFeed,
  shouldEditOpdsCredentials,
} from "./opds-view-state";
import { useOpdsDownload } from "./useOpdsDownload";

type Props = NativeStackScreenProps<RootStackParamList, "OpdsBrowser">;

interface BrowserOperation {
  key: string;
  mode: OpdsLoadMode;
  execute(credentials: OpdsCredentials | undefined, signal: AbortSignal): Promise<OpdsFeed>;
}

interface FormatChoice {
  publication: OpdsPublication;
  acquisitions: ReturnType<typeof listSupportedAcquisitions>;
}

const MAX_COVER_BYTES = 4 * 1024 * 1024;
const MAX_COVER_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_COVER_CACHE_ENTRIES = 12;

function plainDescription(description: string | undefined): string | undefined {
  return description ? opdsDescriptionToPlainText(description) : undefined;
}

function toErrorCode(error: unknown): OpdsErrorCode {
  return error instanceof OpdsError ? error.code : "unreachable";
}

function getContentSnapshot(state: ReturnType<typeof createInitialOpdsViewState>) {
  if (state.content.status === "ready") return state.content;
  if (state.content.status === "loading" || state.content.status === "error") {
    return state.content.previous;
  }
  return undefined;
}

function AuthenticatedCover({
  publication,
  cache,
  style,
}: {
  publication: OpdsPublication;
  cache: ReturnType<typeof createOpdsCoverCache>;
  style: object;
}) {
  const [uri, setUri] = useState<string>();
  const imageUrl = publication.images[0]?.url;

  useEffect(() => {
    setUri(undefined);
    if (!imageUrl) return;
    const controller = new AbortController();
    let release: (() => void) | undefined;
    void cache
      .acquire(imageUrl, controller.signal)
      .then((lease) => {
        release = lease.release;
        if (!controller.signal.aborted) setUri(lease.uri);
        else lease.release();
      })
      .catch(() => {});
    return () => {
      controller.abort();
      release?.();
    };
  }, [cache, imageUrl]);

  return uri ? <Image source={{ uri }} style={style} resizeMode="cover" /> : null;
}

export function OpdsBrowserScreen({ navigation, route }: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const layout = useResponsiveLayout();
  const insets = useSafeAreaInsets();
  const catalogId = route.params.catalogId;
  const store = useMemo(() => opdsMobileRuntime.getCatalogStore(), []);
  const client = useMemo(() => opdsMobileRuntime.getClient(), []);
  const [state, dispatch] = useReducer(opdsViewReducer, undefined, createInitialOpdsViewState);
  const [catalogName, setCatalogName] = useState("");
  const [catalogUrl, setCatalogUrl] = useState("");
  const [query, setQuery] = useState("");
  const [expandedPublication, setExpandedPublication] = useState<string>();
  const [formatChoice, setFormatChoice] = useState<FormatChoice>();
  const formatHeadingRef = useRef<View>(null);
  const requestSequence = useRef(0);
  const catalogOrigin = useRef<string | undefined>(undefined);
  const mounted = useRef(true);
  const lifecycleGeneration = useRef(0);
  const requestController = useRef<AbortController | undefined>(undefined);
  const stateRef = useRef(state);
  stateRef.current = state;
  const operations = useRef(new Map<string, BrowserOperation>());
  const lastOperation = useRef<BrowserOperation | undefined>(undefined);
  const lastDownload = useRef<
    { publication: OpdsPublication; acquisition: OpdsAcquisition } | undefined
  >(undefined);
  const { download } = useOpdsDownload();
  const feed = selectOpdsFeed(state);

  const executeOperation = useCallback(
    async (operation: BrowserOperation, requestId: number) => {
      requestController.current?.abort();
      const controller = new AbortController();
      requestController.current = controller;
      lastOperation.current = operation;
      operations.current.set(operation.key, operation);
      try {
        const credentials = await store.getCredentials(catalogId);
        if (controller.signal.aborted) return;
        const nextFeed = await operation.execute(credentials, controller.signal);
        if (!controller.signal.aborted && mounted.current) {
          dispatch({ type: "loadSucceeded", requestId, feed: nextFeed });
        }
      } catch (error) {
        if (!controller.signal.aborted && mounted.current) {
          dispatch({ type: "loadFailed", requestId, error: toErrorCode(error) });
        }
      }
    },
    [catalogId, store],
  );

  const startOperation = useCallback(
    (operation: BrowserOperation) => {
      const requestId = ++requestSequence.current;
      dispatch({
        type: "loadStarted",
        requestId,
        url: operation.key,
        mode: operation.mode,
      });
      void executeOperation(operation, requestId);
    },
    [executeOperation],
  );

  const openUrl = useCallback(
    (url: string, mode: OpdsLoadMode) => {
      startOperation({
        key: url,
        mode,
        execute: (credentials, signal) =>
          client.open(url, credentials, signal, catalogOrigin.current),
      });
    },
    [client, startOperation],
  );

  const initializeCatalog = useCallback(
    async (generation: number) => {
      try {
        await opdsMobileRuntime.ensureCatalogsLoaded();
        if (!mounted.current || lifecycleGeneration.current !== generation) return;
        const catalog = store.getCatalog(catalogId);
        if (!catalog || !catalog.enabled) throw new Error("catalog-unavailable");
        catalogOrigin.current = new URL(catalog.url).origin;
        setCatalogName(catalog.name);
        setCatalogUrl(catalog.url);
        openUrl(catalog.url, "replace");
      } catch (error) {
        if (!mounted.current || lifecycleGeneration.current !== generation) return;
        const requestId = ++requestSequence.current;
        dispatch({ type: "loadStarted", requestId, url: "catalog", mode: "replace" });
        dispatch({ type: "loadFailed", requestId, error: toErrorCode(error) });
      }
    },
    [catalogId, openUrl, store],
  );

  useEffect(() => {
    const generation = ++lifecycleGeneration.current;
    mounted.current = true;
    void initializeCatalog(generation);
    return () => {
      mounted.current = false;
      if (lifecycleGeneration.current === generation) lifecycleGeneration.current += 1;
      requestController.current?.abort();
    };
  }, [initializeCatalog]);

  const feedScope = getContentSnapshot(state)?.currentUrl ?? catalogUrl;
  const coverCache = useMemo(() => {
    const cacheScope = feedScope;
    return createOpdsCoverCache({
      maxEntries: MAX_COVER_CACHE_ENTRIES,
      maxBytes: MAX_COVER_CACHE_BYTES,
      maxLoadBytes: MAX_COVER_BYTES,
      load: async (url, signal) => {
        // Capturing the feed scope makes navigation create a fresh cache and release the old feed.
        void cacheScope;
        const credentials = await store.getCredentials(catalogId);
        if (signal.aborted) throw new Error("cancelled");
        const response = await client.fetchAsset(
          url,
          new URL(catalogUrl).origin,
          credentials,
          signal,
        );
        if (signal.aborted) {
          await response.cancel("cancelled");
          throw new Error("cancelled");
        }
        return readOpdsCover(response, signal, MAX_COVER_BYTES);
      },
    });
  }, [catalogId, catalogUrl, client, feedScope, store]);
  useEffect(() => () => coverCache.clear(), [coverCache]);

  const downloadController = useMemo(
    () =>
      createOpdsDownloadController<OpdsCredentials | undefined>({
        onEvent: (event) => {
          if (mounted.current) dispatch(event);
        },
      }),
    [],
  );
  useEffect(() => () => void downloadController.cancel(), [downloadController]);

  useEffect(() => {
    if (!formatChoice) return;
    const focusTimer = setTimeout(() => {
      const node = findNodeHandle(formatHeadingRef.current);
      if (node) AccessibilityInfo.setAccessibilityFocus(node);
    }, 100);
    return () => clearTimeout(focusTimer);
  }, [formatChoice]);

  const runDownload = useCallback(
    async (publication: OpdsPublication, acquisition: OpdsAcquisition) => {
      lastDownload.current = { publication, acquisition };
      try {
        await downloadController.start({
          publicationTitle: publication.title,
          prepare: () => store.getCredentials(catalogId),
          execute: async ({ credentials, signal, onProgress, onImportStart }) => {
            const result = await download({
              publication,
              acquisition,
              catalogOrigin: new URL(catalogUrl).origin,
              credentials,
              signal,
              onProgress: (progress) => onProgress(progress.loaded, progress.total),
              onImportStart,
            });
            return { importedCount: result.importResult.imported.length };
          },
        });
      } catch {
        // The controller owns the stable, sanitized error state.
      }
    },
    [catalogId, catalogUrl, download, downloadController, store],
  );

  const chooseDownload = (publication: OpdsPublication) => {
    const acquisitions = listSupportedAcquisitions(publication);
    if (acquisitions.length === 0) return;
    if (acquisitions.length === 1) {
      void runDownload(publication, acquisitions[0]);
      return;
    }
    setFormatChoice({ publication, acquisitions });
  };

  const handleSearch = () => {
    const descriptor = feed?.search;
    const trimmed = query.trim();
    if (!descriptor || !trimmed) return;
    const key = `opds-search:${encodeURIComponent(trimmed)}`;
    startOperation({
      key,
      mode: "push",
      execute: (credentials, signal) =>
        client.search(descriptor, trimmed, credentials, signal, catalogOrigin.current),
    });
  };

  const backController = useMemo(
    () =>
      createOpdsBackController({
        getState: () => stateRef.current,
        cancelRequest: () => requestController.current?.abort(),
        dispatch,
        startBack: (target) => {
          const operation = operations.current.get(target);
          if (operation) startOperation({ ...operation, mode: "back" });
          else openUrl(target, "back");
        },
        exit: navigation.goBack,
      }),
    [navigation.goBack, openUrl, startOperation],
  );
  useEffect(
    () => navigation.addListener("beforeRemove", backController.handleBeforeRemove),
    [backController, navigation],
  );

  const handleRefresh = () => {
    const snapshot = getContentSnapshot(state);
    const operation = snapshot ? operations.current.get(snapshot.currentUrl) : undefined;
    if (operation) startOperation({ ...operation, mode: "refresh" });
  };

  const handleRetry = () => {
    const operation = lastOperation.current;
    if (state.content.status !== "error") return;
    if (!operation) {
      void initializeCatalog(lifecycleGeneration.current);
      return;
    }
    const requestId = ++requestSequence.current;
    dispatch({ type: "retryStarted", requestId });
    void executeOperation(operation, requestId);
  };

  const cancelDownload = () => {
    downloadController.cancel();
  };

  const retryDownload = () => {
    const retry = lastDownload.current;
    if (retry) void runDownload(retry.publication, retry.acquisition);
  };

  const errorMessage = (code: OpdsErrorCode) => t(`library.opds.errors.${code}`);

  const s = useMemo(
    () =>
      StyleSheet.create({
        container: { flex: 1, backgroundColor: colors.background },
        header: {
          paddingHorizontal: layout.horizontalPadding,
          paddingTop: 12,
          paddingBottom: 10,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: withOpacity(colors.border, 0.9),
          alignItems: "center",
        },
        headerInner: { width: "100%", maxWidth: layout.centeredContentWidth, gap: 12 },
        headerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
        iconButton: {
          width: 44,
          height: 44,
          borderRadius: radius.full,
          backgroundColor: colors.card,
          alignItems: "center",
          justifyContent: "center",
        },
        headerCopy: { flex: 1, minWidth: 0 },
        eyebrow: {
          fontSize: fontSize.xs,
          fontWeight: fontWeight.semibold,
          color: colors.mutedForeground,
          textTransform: "uppercase",
          letterSpacing: 0.7,
        },
        title: {
          marginTop: 2,
          fontSize: fontSize.xl,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
        searchRow: {
          minHeight: 46,
          paddingHorizontal: 12,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.92),
          backgroundColor: colors.card,
          flexDirection: "row",
          alignItems: "center",
          gap: 9,
        },
        searchInput: {
          flex: 1,
          minWidth: 0,
          padding: 0,
          fontSize: fontSize.base,
          color: colors.foreground,
        },
        searchButton: {
          minWidth: 44,
          minHeight: 44,
          alignItems: "center",
          justifyContent: "center",
        },
        scrollContent: {
          width: "100%",
          maxWidth: layout.centeredContentWidth,
          alignSelf: "center",
          paddingHorizontal: layout.horizontalPadding,
          paddingTop: 16,
          paddingBottom: 130,
          gap: 16,
        },
        listRow: { marginBottom: 10 },
        feedIntro: { paddingHorizontal: 2 },
        feedTitle: {
          fontSize: fontSize.lg,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
        feedSubtitle: {
          marginTop: 4,
          fontSize: fontSize.sm,
          lineHeight: 21,
          color: colors.mutedForeground,
        },
        errorBox: {
          padding: 14,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: withOpacity(colors.destructive, 0.22),
          backgroundColor: withOpacity(colors.destructive, 0.08),
          gap: 10,
        },
        errorText: { fontSize: fontSize.sm, lineHeight: 20, color: colors.foreground },
        errorActions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
        smallButton: {
          minHeight: 44,
          paddingHorizontal: 14,
          borderRadius: radius.full,
          backgroundColor: colors.card,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.9),
        },
        smallButtonText: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.medium,
          color: colors.foreground,
        },
        section: { gap: 9 },
        sectionTitle: {
          fontSize: fontSize.xs,
          fontWeight: fontWeight.semibold,
          color: colors.mutedForeground,
          textTransform: "uppercase",
          letterSpacing: 0.8,
          paddingHorizontal: 2,
        },
        linkCard: {
          minHeight: 54,
          paddingHorizontal: 14,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.9),
          backgroundColor: colors.card,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        },
        linkText: {
          flex: 1,
          fontSize: fontSize.sm,
          fontWeight: fontWeight.medium,
          color: colors.foreground,
        },
        publication: {
          borderRadius: radius.xxl,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.92),
          backgroundColor: colors.card,
          overflow: "hidden",
        },
        publicationMain: { minHeight: 94, padding: 14, flexDirection: "row", gap: 13 },
        cover: {
          width: 56,
          height: 78,
          borderRadius: radius.md,
          backgroundColor: withOpacity(colors.primary, 0.08),
          overflow: "hidden",
          alignItems: "center",
          justifyContent: "center",
        },
        coverImage: { position: "absolute", top: 0, left: 0, width: 56, height: 78 },
        publicationCopy: { flex: 1, minWidth: 0 },
        publicationTitle: {
          fontSize: fontSize.base,
          lineHeight: 21,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
        publicationAuthor: { marginTop: 4, fontSize: fontSize.sm, color: colors.mutedForeground },
        publicationMeta: { marginTop: 7, fontSize: fontSize.xs, color: colors.mutedForeground },
        details: {
          paddingHorizontal: 14,
          paddingBottom: 14,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: withOpacity(colors.border, 0.82),
          gap: 12,
        },
        description: {
          paddingTop: 12,
          fontSize: fontSize.sm,
          lineHeight: 21,
          color: colors.foreground,
        },
        subjectRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
        subject: {
          paddingHorizontal: 8,
          paddingVertical: 4,
          borderRadius: radius.full,
          backgroundColor: colors.muted,
        },
        subjectText: { fontSize: fontSize.xs, color: colors.mutedForeground },
        downloadButton: {
          minHeight: 46,
          borderRadius: radius.xl,
          backgroundColor: colors.primary,
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
        },
        downloadText: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.semibold,
          color: colors.primaryForeground,
        },
        unsupported: { fontSize: fontSize.sm, lineHeight: 20, color: colors.mutedForeground },
        pagination: { flexDirection: "row", gap: 10 },
        pageButton: {
          flex: 1,
          minHeight: 46,
          borderRadius: radius.xl,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.9),
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
        },
        pageText: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.medium,
          color: colors.foreground,
        },
        centerState: {
          minHeight: 360,
          alignItems: "center",
          justifyContent: "center",
          padding: 28,
        },
        centerTitle: {
          marginTop: 14,
          fontSize: fontSize.lg,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
        centerText: {
          marginTop: 7,
          fontSize: fontSize.sm,
          lineHeight: 21,
          textAlign: "center",
          color: colors.mutedForeground,
        },
        downloadPanel: {
          position: "absolute",
          left: layout.horizontalPadding,
          right: layout.horizontalPadding,
          bottom: 16,
          alignItems: "center",
        },
        downloadInner: {
          width: "100%",
          maxWidth: layout.centeredContentWidth,
          padding: 14,
          borderRadius: 22,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.92),
          backgroundColor: colors.card,
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 8 },
          shadowOpacity: 0.14,
          shadowRadius: 18,
          elevation: 7,
          gap: 9,
        },
        downloadRow: { flexDirection: "row", alignItems: "center", gap: 10 },
        downloadCopy: { flex: 1, minWidth: 0 },
        downloadTitle: {
          fontSize: fontSize.sm,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
        downloadMeta: { marginTop: 2, fontSize: fontSize.xs, color: colors.mutedForeground },
        progressTrack: {
          height: 4,
          borderRadius: radius.full,
          backgroundColor: colors.muted,
          overflow: "hidden",
        },
        progressFill: {
          height: "100%",
          borderRadius: radius.full,
          backgroundColor: colors.primary,
        },
        overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", justifyContent: "flex-end" },
        picker: {
          maxHeight: "88%",
          paddingHorizontal: 20,
          paddingTop: 12,
          paddingBottom: Math.max(20, insets.bottom + 12),
          borderTopLeftRadius: 26,
          borderTopRightRadius: 26,
          backgroundColor: colors.background,
          gap: 12,
        },
        pickerHandle: {
          alignSelf: "center",
          width: 38,
          height: 4,
          borderRadius: radius.full,
          backgroundColor: colors.border,
        },
        pickerTitle: {
          fontSize: fontSize.xl,
          fontWeight: fontWeight.semibold,
          color: colors.foreground,
        },
        pickerSubtitle: { fontSize: fontSize.sm, color: colors.mutedForeground },
        formatButton: {
          minHeight: 52,
          paddingHorizontal: 14,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: withOpacity(colors.border, 0.9),
          backgroundColor: colors.card,
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
        },
        formatText: {
          flex: 1,
          fontSize: fontSize.base,
          fontWeight: fontWeight.medium,
          color: colors.foreground,
          textTransform: "uppercase",
        },
        formatList: { flexGrow: 0 },
        formatListContent: { gap: 10 },
      }),
    [colors, insets.bottom, layout.centeredContentWidth, layout.horizontalPadding],
  );

  const renderPublication = (publication: OpdsPublication, keyPrefix = "publication") => {
    const key = `${keyPrefix}:${publication.id ?? publication.title}`;
    const expanded = expandedPublication === key;
    const formats = listSupportedAcquisitions(publication);
    const description = plainDescription(publication.description);
    return (
      <View key={key} style={s.publication}>
        <TouchableOpacity
          style={s.publicationMain}
          onPress={() => setExpandedPublication(expanded ? undefined : key)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={t("library.opds.publicationDetails", {
            title: publication.title,
          })}
        >
          <View style={s.cover}>
            <BookOpenIcon size={21} color={colors.mutedForeground} />
            <AuthenticatedCover publication={publication} cache={coverCache} style={s.coverImage} />
          </View>
          <View style={s.publicationCopy}>
            <Text style={s.publicationTitle}>{publication.title}</Text>
            <Text style={s.publicationAuthor} numberOfLines={2}>
              {publication.authors.join(", ") || t("library.opds.unknownAuthor")}
            </Text>
            <Text style={s.publicationMeta} numberOfLines={1}>
              {formats.length > 0
                ? formats.map((item) => item.format.toUpperCase()).join(" · ")
                : t("library.opds.noCompatibleFormat")}
            </Text>
          </View>
          <ChevronRightIcon size={17} color={colors.mutedForeground} />
        </TouchableOpacity>
        {expanded ? (
          <View style={s.details}>
            {description ? <Text style={s.description}>{description}</Text> : null}
            {publication.subjects.length > 0 ? (
              <View style={s.subjectRow}>
                {publication.subjects.slice(0, 8).map((subject) => (
                  <View key={subject} style={s.subject}>
                    <Text style={s.subjectText}>{subject}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {formats.length > 0 ? (
              <TouchableOpacity
                style={s.downloadButton}
                onPress={() => chooseDownload(publication)}
                disabled={
                  state.download.status === "downloading" || state.download.status === "importing"
                }
                accessibilityRole="button"
                accessibilityState={{
                  disabled:
                    state.download.status === "downloading" ||
                    state.download.status === "importing",
                }}
                accessibilityLabel={t("library.opds.downloadTitle", {
                  title: publication.title,
                })}
              >
                <BookOpenIcon size={18} color={colors.primaryForeground} />
                <Text style={s.downloadText}>
                  {formats.length > 1
                    ? t("library.opds.chooseFormat")
                    : t("library.opds.downloadAndImport")}
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={s.unsupported}>{t("library.opds.unsupportedExplanation")}</Text>
            )}
          </View>
        ) : null}
      </View>
    );
  };

  const contentError = state.content.status === "error" ? state.content.error : undefined;
  const initialLoading =
    state.content.status === "idle" || (state.content.status === "loading" && !feed);
  const feedRows = useMemo(() => (feed ? createOpdsFeedRows(feed) : []), [feed]);
  const downloadAccessibility = getOpdsDownloadAccessibility(state.download);

  const renderFeedRow = ({ item }: { item: OpdsFeedRow }) => {
    if (item.kind === "intro") {
      return (
        <View style={[s.feedIntro, s.listRow]}>
          <Text style={s.feedTitle}>{item.feed.title}</Text>
          {item.feed.subtitle ? <Text style={s.feedSubtitle}>{item.feed.subtitle}</Text> : null}
        </View>
      );
    }
    if (item.kind === "section") {
      const title =
        item.title === "collections"
          ? t("library.opds.collections")
          : item.title === "books"
            ? t("library.opds.books")
            : item.title;
      return <Text style={[s.sectionTitle, s.listRow]}>{title}</Text>;
    }
    if (item.kind === "link") {
      return (
        <TouchableOpacity
          style={[s.linkCard, s.listRow]}
          onPress={() => openUrl(item.url, "push")}
          accessibilityRole="button"
          accessibilityLabel={item.title}
        >
          {item.icon ? <GlobeIcon size={18} color={colors.primary} /> : null}
          <Text style={s.linkText}>{item.title}</Text>
          <ChevronRightIcon size={17} color={colors.mutedForeground} />
        </TouchableOpacity>
      );
    }
    if (item.kind === "publication") {
      return <View style={s.listRow}>{renderPublication(item.publication, item.keyPrefix)}</View>;
    }
    if (item.kind === "empty") {
      return (
        <View style={s.centerState}>
          <BookOpenIcon size={30} color={colors.mutedForeground} />
          <Text style={s.centerTitle}>{t("library.opds.empty")}</Text>
          <Text style={s.centerText}>{t("library.opds.emptyHint")}</Text>
        </View>
      );
    }
    return (
      <View style={[s.pagination, s.listRow]}>
        {item.previousUrl ? (
          <TouchableOpacity
            style={s.pageButton}
            onPress={() => openUrl(item.previousUrl as string, "push")}
            accessibilityRole="button"
            accessibilityState={{ disabled: false }}
            accessibilityLabel={t("library.opds.previous")}
          >
            <ChevronLeftIcon size={17} color={colors.foreground} />
            <Text style={s.pageText}>{t("library.opds.previous")}</Text>
          </TouchableOpacity>
        ) : null}
        {item.nextUrl ? (
          <TouchableOpacity
            style={s.pageButton}
            onPress={() => openUrl(item.nextUrl as string, "push")}
            accessibilityRole="button"
            accessibilityState={{ disabled: false }}
            accessibilityLabel={t("library.opds.next")}
          >
            <Text style={s.pageText}>{t("library.opds.next")}</Text>
            <ChevronRightIcon size={17} color={colors.foreground} />
          </TouchableOpacity>
        ) : null}
      </View>
    );
  };

  return (
    <SafeAreaView style={s.container}>
      <View style={s.header}>
        <View style={s.headerInner}>
          <View style={s.headerRow}>
            <TouchableOpacity
              style={s.iconButton}
              onPress={backController.handleHeaderBack}
              accessibilityRole="button"
              accessibilityState={{ disabled: false }}
              accessibilityLabel={t("library.opds.back")}
            >
              <ChevronLeftIcon size={20} color={colors.foreground} />
            </TouchableOpacity>
            <View style={s.headerCopy}>
              <Text style={s.eyebrow} numberOfLines={1}>
                {catalogName || t("library.opds.catalog")}
              </Text>
              <Text style={s.title} numberOfLines={1}>
                {feed?.title ?? t("library.opds.loading")}
              </Text>
            </View>
            <TouchableOpacity
              style={s.iconButton}
              onPress={handleRefresh}
              disabled={!feed || state.content.status === "loading"}
              accessibilityRole="button"
              accessibilityState={{
                disabled: !feed,
                busy: state.content.status === "ready" && state.content.refreshing,
              }}
              accessibilityLabel={t("library.opds.refresh")}
            >
              {state.content.status === "ready" && state.content.refreshing ? (
                <ActivityIndicator size="small" color={colors.foreground} />
              ) : (
                <RefreshCwIcon size={18} color={colors.foreground} />
              )}
            </TouchableOpacity>
          </View>
          {canSearchOpds(state) ? (
            <View style={s.searchRow}>
              <SearchIcon size={18} color={colors.mutedForeground} />
              <TextInput
                style={s.searchInput}
                value={query}
                onChangeText={setQuery}
                onSubmitEditing={handleSearch}
                returnKeyType="search"
                placeholder={t("library.opds.searchPlaceholder")}
                placeholderTextColor={colors.mutedForeground}
                accessibilityLabel={t("library.opds.searchPlaceholder")}
              />
              <TouchableOpacity
                style={s.searchButton}
                onPress={handleSearch}
                disabled={!query.trim()}
                accessibilityRole="button"
                accessibilityState={{ disabled: !query.trim() }}
                accessibilityLabel={t("library.opds.search")}
              >
                <ChevronRightIcon
                  size={18}
                  color={query.trim() ? colors.foreground : colors.mutedForeground}
                />
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </View>

      {initialLoading ? (
        <View style={s.centerState}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={s.centerTitle}>{t("library.opds.loading")}</Text>
          <Text style={s.centerText}>{t("library.opds.loadingHint")}</Text>
        </View>
      ) : !feed && contentError ? (
        <View style={s.centerState}>
          <GlobeIcon size={30} color={colors.destructive} />
          <Text style={s.centerTitle}>{t("library.opds.loadFailed")}</Text>
          <Text style={s.centerText}>{errorMessage(contentError)}</Text>
          <View style={s.errorActions}>
            <TouchableOpacity
              style={s.smallButton}
              onPress={handleRetry}
              accessibilityRole="button"
              accessibilityState={{ disabled: false }}
              accessibilityLabel={t("library.opds.retry")}
            >
              <Text style={s.smallButtonText}>{t("library.opds.retry")}</Text>
            </TouchableOpacity>
            {shouldEditOpdsCredentials(state) ? (
              <TouchableOpacity
                style={s.smallButton}
                onPress={() => navigation.navigate("OpdsCatalogs", { editCatalogId: catalogId })}
                accessibilityRole="button"
                accessibilityState={{ disabled: false }}
                accessibilityLabel={t("library.opds.editCredentials")}
              >
                <Text style={s.smallButtonText}>{t("library.opds.editCredentials")}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : (
        <FlatList
          data={feedRows}
          keyExtractor={(item) => item.key}
          renderItem={renderFeedRow}
          contentContainerStyle={s.scrollContent}
          showsVerticalScrollIndicator={false}
          initialNumToRender={8}
          maxToRenderPerBatch={8}
          windowSize={7}
          removeClippedSubviews
          ListHeaderComponent={
            contentError ? (
              <View style={[s.errorBox, s.listRow]} accessibilityRole="alert">
                <Text style={s.errorText}>{errorMessage(contentError)}</Text>
                <View style={s.errorActions}>
                  <TouchableOpacity
                    style={s.smallButton}
                    onPress={handleRetry}
                    accessibilityRole="button"
                    accessibilityLabel={t("library.opds.retry")}
                  >
                    <Text style={s.smallButtonText}>{t("library.opds.retry")}</Text>
                  </TouchableOpacity>
                  {shouldEditOpdsCredentials(state) ? (
                    <TouchableOpacity
                      style={s.smallButton}
                      onPress={() =>
                        navigation.navigate("OpdsCatalogs", { editCatalogId: catalogId })
                      }
                      accessibilityRole="button"
                      accessibilityLabel={t("library.opds.editCredentials")}
                    >
                      <Text style={s.smallButtonText}>{t("library.opds.editCredentials")}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              </View>
            ) : null
          }
        />
      )}

      {state.download.status !== "idle" ? (
        <View style={s.downloadPanel}>
          <View
            style={s.downloadInner}
            accessibilityRole={state.download.status === "error" ? "alert" : undefined}
          >
            <View style={s.downloadRow}>
              {state.download.status === "downloading" || state.download.status === "importing" ? (
                <Loader2Icon size={20} color={colors.primary} />
              ) : state.download.status === "success" ? (
                <BookOpenIcon size={20} color={colors.emerald} />
              ) : (
                <XIcon size={20} color={colors.destructive} />
              )}
              <View style={s.downloadCopy}>
                <Text style={s.downloadTitle} numberOfLines={1}>
                  {state.download.publicationTitle}
                </Text>
                <Text
                  style={s.downloadMeta}
                  accessibilityLiveRegion={downloadAccessibility.liveRegion}
                >
                  {state.download.status === "downloading"
                    ? state.download.total > 0
                      ? t("library.opds.downloadingProgress", {
                          percent: Math.round((state.download.loaded / state.download.total) * 100),
                        })
                      : t("library.opds.downloading")
                    : state.download.status === "importing"
                      ? t("library.opds.importing")
                      : state.download.status === "success"
                        ? state.download.importedCount > 0
                          ? t("library.opds.imported")
                          : t("library.opds.alreadyImported")
                        : errorMessage(state.download.error)}
                </Text>
              </View>
              {state.download.status === "downloading" ? (
                <TouchableOpacity
                  style={s.smallButton}
                  onPress={cancelDownload}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: false }}
                  accessibilityLabel={t("library.opds.cancel")}
                >
                  <Text style={s.smallButtonText}>{t("library.opds.cancel")}</Text>
                </TouchableOpacity>
              ) : state.download.status === "error" && lastDownload.current ? (
                <TouchableOpacity
                  style={s.smallButton}
                  onPress={retryDownload}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: false }}
                  accessibilityLabel={t("library.opds.retry")}
                >
                  <Text style={s.smallButtonText}>{t("library.opds.retry")}</Text>
                </TouchableOpacity>
              ) : state.download.status === "success" ? (
                <TouchableOpacity
                  style={s.smallButton}
                  onPress={() => dispatch({ type: "downloadReset" })}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: false }}
                  accessibilityLabel={t("library.opds.done")}
                >
                  <Text style={s.smallButtonText}>{t("library.opds.done")}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {state.download.status === "downloading" || state.download.status === "importing" ? (
              <View
                style={s.progressTrack}
                accessibilityRole="progressbar"
                accessibilityValue={
                  state.download.status === "downloading" && state.download.total > 0
                    ? downloadAccessibility.value
                    : {
                        text:
                          state.download.status === "importing"
                            ? t("library.opds.importing")
                            : t("library.opds.downloading"),
                      }
                }
              >
                <View
                  style={[
                    s.progressFill,
                    {
                      width: `${state.download.status === "downloading" && state.download.total > 0 ? Math.min(100, (state.download.loaded / state.download.total) * 100) : 8}%`,
                    },
                  ]}
                />
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      <Modal
        visible={!!formatChoice}
        transparent
        animationType="slide"
        onRequestClose={() => setFormatChoice(undefined)}
      >
        <Pressable style={s.overlay} onPress={() => setFormatChoice(undefined)}>
          <Pressable
            style={s.picker}
            onPress={(event) => event.stopPropagation()}
            accessibilityViewIsModal
          >
            <View style={s.pickerHandle} />
            <View ref={formatHeadingRef} accessible accessibilityRole="header">
              <Text style={s.pickerTitle}>{t("library.opds.chooseFormat")}</Text>
            </View>
            <Text style={s.pickerSubtitle} numberOfLines={2}>
              {formatChoice?.publication.title}
            </Text>
            <FlatList
              style={s.formatList}
              contentContainerStyle={s.formatListContent}
              data={formatChoice?.acquisitions ?? []}
              keyExtractor={(acquisition) => `${acquisition.format}:${acquisition.url}`}
              initialNumToRender={8}
              renderItem={({ item: acquisition }) => (
                <TouchableOpacity
                  style={s.formatButton}
                  onPress={() => {
                    const publication = formatChoice?.publication;
                    setFormatChoice(undefined);
                    if (publication) void runDownload(publication, acquisition);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: false }}
                  accessibilityLabel={t("library.opds.downloadFormat", {
                    format: acquisition.format.toUpperCase(),
                  })}
                >
                  <BookOpenIcon size={19} color={colors.primary} />
                  <Text style={s.formatText}>{acquisition.format}</Text>
                  <ChevronRightIcon size={17} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}
            />
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}
