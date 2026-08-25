import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  type OpdsAcquisition,
  type OpdsCatalog,
  type OpdsCatalogStore,
  type OpdsClient,
  type OpdsCredentials,
  OpdsError,
  type OpdsErrorCode,
  type OpdsFeed,
  type OpdsPublication,
  createInitialOpdsViewState,
  createOpdsBackController,
  createOpdsCoverCache,
  getOpdsReadySnapshot,
  listSupportedAcquisitions,
  opdsViewReducer,
  readOpdsCover,
  selectOpdsFeed,
} from "@readany/core";
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Download,
  FolderOpen,
  Loader2,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import {
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { OpdsDescription } from "./OpdsDescription";
import { createOpdsDesktopDownloadController } from "./opds-desktop-download-controller";
import { windowOpdsFeedPublications } from "./opds-desktop-feed-window";
import { createOpdsDesktopRequestController } from "./opds-desktop-request-controller";
import { useOpdsDownload } from "./useOpdsDownload";

interface OpdsBrowserProps {
  catalog: OpdsCatalog;
  store: OpdsCatalogStore;
  client: OpdsClient;
  onBack(): void;
  onEditCredentials(): void;
  registerBackHandler(handler: (() => boolean) | undefined): void;
}

type LoadMode = "replace" | "push" | "back" | "refresh";

type DownloadState =
  | { status: "idle" }
  | { status: "downloading"; title: string }
  | { status: "importing"; title: string }
  | { status: "success"; title: string; imported: boolean }
  | { status: "error"; title: string; error: OpdsErrorCode };

interface FormatChoice {
  publication: OpdsPublication;
  acquisitions: ReturnType<typeof listSupportedAcquisitions>;
}

type Operation = (
  credentials: OpdsCredentials | undefined,
  signal: AbortSignal,
) => Promise<OpdsFeed>;

const MAX_COVER_BYTES = 4 * 1024 * 1024;
const MAX_COVER_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_COVER_CACHE_ENTRIES = 12;
const INITIAL_PUBLICATION_WINDOW = 18;

function errorCode(error: unknown, fallback: OpdsErrorCode = "unreachable"): OpdsErrorCode {
  return error instanceof OpdsError ? error.code : fallback;
}

function AuthenticatedCover({
  publication,
  cache,
}: {
  publication: OpdsPublication;
  cache: ReturnType<typeof createOpdsCoverCache>;
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
        if (controller.signal.aborted) lease.release();
        else setUri(lease.uri);
      })
      .catch(() => {});
    return () => {
      controller.abort();
      release?.();
    };
  }, [cache, imageUrl]);

  return uri ? (
    <img className="absolute inset-0 size-full object-cover" src={uri} alt="" />
  ) : (
    <BookOpen className="size-5 text-muted-foreground" aria-hidden="true" />
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mb-2 mt-5 font-serif text-lg font-semibold tracking-tight text-foreground">
      {children}
    </h3>
  );
}

export function OpdsBrowser({
  catalog,
  store,
  client,
  onBack,
  onEditCredentials,
  registerBackHandler,
}: OpdsBrowserProps) {
  const { t } = useTranslation();
  const [viewState, dispatch] = useReducer(opdsViewReducer, undefined, createInitialOpdsViewState);
  const content = viewState.content;
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string>();
  const [formatChoice, setFormatChoice] = useState<FormatChoice>();
  const [downloadState, setDownloadState] = useState<DownloadState>({ status: "idle" });
  const [publicationLimit, setPublicationLimit] = useState(INITIAL_PUBLICATION_WINDOW);
  const [lastDownload, setLastDownload] = useState<{
    publication: OpdsPublication;
    acquisition: OpdsAcquisition;
  }>();
  const mounted = useRef(true);
  const viewStateRef = useRef(viewState);
  viewStateRef.current = viewState;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const requestSequence = useRef(0);
  const operations = useRef(new Map<string, Operation>());
  const lastOperation = useRef<{ key: string; mode: LoadMode; execute: Operation } | undefined>(
    undefined,
  );
  const { download, cancel, progress } = useOpdsDownload();
  const catalogOrigin = new URL(catalog.url).origin;
  const requestController = useMemo(
    () =>
      createOpdsDesktopRequestController({
        prepare: () => store.getCredentials(catalog.id),
      }),
    [catalog.id, store],
  );
  const downloadController = useMemo(
    () =>
      createOpdsDesktopDownloadController({
        prepare: () => store.getCredentials(catalog.id),
      }),
    [catalog.id, store],
  );

  const coverCache = useMemo(
    () =>
      createOpdsCoverCache({
        maxEntries: MAX_COVER_CACHE_ENTRIES,
        maxBytes: MAX_COVER_CACHE_BYTES,
        maxLoadBytes: MAX_COVER_BYTES,
        load: async (url, signal) => {
          const credentials = await store.getCredentials(catalog.id);
          if (signal.aborted) throw new Error("cancelled");
          const response = await client.fetchAsset(url, catalogOrigin, credentials, signal);
          return readOpdsCover(response, signal, MAX_COVER_BYTES);
        },
      }),
    [catalog.id, catalogOrigin, client, store],
  );

  const startOperation = useCallback(
    async (key: string, mode: LoadMode, execute: Operation) => {
      operations.current.set(key, execute);
      lastOperation.current = { key, mode, execute };
      const requestId = ++requestSequence.current;
      dispatch({ type: "loadStarted", requestId, url: key, mode });
      try {
        const feed = await requestController.run(execute);
        if (!feed || !mounted.current) return;
        if (mode !== "refresh") setPublicationLimit(INITIAL_PUBLICATION_WINDOW);
        dispatch({ type: "loadSucceeded", requestId, feed });
      } catch (error) {
        if (!mounted.current) return;
        dispatch({ type: "loadFailed", requestId, error: errorCode(error) });
      }
    },
    [requestController],
  );

  const openUrl = useCallback(
    (url: string, mode: LoadMode) => {
      void startOperation(url, mode, (credentials, signal) =>
        client.open(url, credentials, signal, catalogOrigin),
      );
    },
    [catalogOrigin, client, startOperation],
  );

  useEffect(() => {
    mounted.current = true;
    headingRef.current?.focus();
    openUrl(catalog.url, "replace");
    return () => {
      mounted.current = false;
      requestController.dispose();
      coverCache.clear();
      if (downloadController.dispose()) cancel();
    };
  }, [cancel, catalog.url, coverCache, downloadController, openUrl, requestController]);

  const handleBack = useCallback((): boolean => {
    let exited = false;
    createOpdsBackController({
      getState: () => viewStateRef.current,
      cancelRequest: requestController.cancel,
      dispatch,
      startBack: (target) => {
        const operation = operations.current.get(target);
        if (operation) void startOperation(target, "back", operation);
        else openUrl(target, "back");
      },
      exit: () => {
        exited = true;
        onBack();
      },
    }).handleHeaderBack();
    return !exited;
  }, [onBack, openUrl, requestController.cancel, startOperation]);

  useEffect(() => {
    registerBackHandler(handleBack);
    return () => registerBackHandler(undefined);
  }, [handleBack, registerBackHandler]);

  const feed = selectOpdsFeed(viewState);
  const windowedFeed = useMemo(
    () => (feed ? windowOpdsFeedPublications(feed, publicationLimit) : undefined),
    [feed, publicationLimit],
  );

  const runSearch = (event: FormEvent) => {
    event.preventDefault();
    const descriptor = feed?.search;
    const trimmed = query.trim();
    if (!descriptor || !trimmed) return;
    const key = `opds-search:${encodeURIComponent(trimmed)}`;
    void startOperation(key, "push", (credentials, signal) =>
      client.search(descriptor, trimmed, credentials, signal, catalogOrigin),
    );
  };

  const refresh = () => {
    const current = getOpdsReadySnapshot(content);
    if (!current) return;
    const operation = operations.current.get(current.currentUrl);
    if (operation) void startOperation(current.currentUrl, "refresh", operation);
  };

  const retry = () => {
    const operation = lastOperation.current;
    if (!operation || content.status !== "error") return;
    const requestId = ++requestSequence.current;
    dispatch({ type: "retryStarted", requestId });
    void requestController
      .run(operation.execute)
      .then((feed) => {
        if (feed && mounted.current) {
          if (operation.mode !== "refresh") setPublicationLimit(INITIAL_PUBLICATION_WINDOW);
          dispatch({ type: "loadSucceeded", requestId, feed });
        }
      })
      .catch((error) => {
        if (mounted.current) dispatch({ type: "loadFailed", requestId, error: errorCode(error) });
      });
  };

  const runDownload = useCallback(
    async (publication: OpdsPublication, acquisition: OpdsAcquisition) => {
      setLastDownload({ publication, acquisition });
      setDownloadState({ status: "downloading", title: publication.title });
      try {
        const result = await downloadController.run(async (credentials, ownership) =>
          download({
            publication,
            acquisition,
            catalogOrigin,
            credentials,
            onImportStart: () => {
              ownership.markImportStarted();
              if (mounted.current)
                setDownloadState({ status: "importing", title: publication.title });
            },
          }),
        );
        if (result && mounted.current) {
          setDownloadState({
            status: "success",
            title: publication.title,
            imported: result.importResult.imported.length > 0,
          });
        }
      } catch (error) {
        if (!mounted.current || errorCode(error) === "download-in-progress") return;
        setDownloadState({
          status: "error",
          title: publication.title,
          error: errorCode(error, "download-failed"),
        });
      }
    },
    [catalogOrigin, download, downloadController],
  );

  const chooseDownload = (publication: OpdsPublication) => {
    const acquisitions = listSupportedAcquisitions(publication);
    if (acquisitions.length === 1) void runDownload(publication, acquisitions[0]);
    else if (acquisitions.length > 1) setFormatChoice({ publication, acquisitions });
  };

  const cancelDownload = () => {
    if (downloadState.status !== "downloading") return;
    if (!downloadController.cancel()) return;
    cancel();
    setDownloadState({ status: "idle" });
  };

  const renderPublication = (publication: OpdsPublication, prefix: string) => {
    const key = `${prefix}:${publication.id ?? publication.title}`;
    const isExpanded = expanded === key;
    const formats = listSupportedAcquisitions(publication);
    const description = publication.description;
    return (
      <article key={key} className="overflow-hidden rounded-xl border bg-card shadow-sm">
        <button
          type="button"
          className="flex w-full gap-4 p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          aria-expanded={isExpanded}
          aria-label={t("library.opds.publicationDetails", { title: publication.title })}
          onClick={() => setExpanded(isExpanded ? undefined : key)}
        >
          <span className="relative flex h-[88px] w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted/60 shadow-sm">
            <AuthenticatedCover publication={publication} cache={coverCache} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-serif text-base font-semibold leading-snug">
              {publication.title}
            </span>
            <span className="mt-1 block text-sm text-muted-foreground">
              {publication.authors.join(", ") || t("library.opds.unknownAuthor")}
            </span>
            <span className="mt-3 block text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
              {formats.length
                ? formats.map((item) => item.format.toUpperCase()).join(" · ")
                : t("library.opds.noCompatibleFormat")}
            </span>
          </span>
          <ChevronRight
            className={`mt-1 size-4 shrink-0 text-muted-foreground transition-transform ${isExpanded ? "rotate-90" : ""}`}
          />
        </button>
        {isExpanded ? (
          <div className="border-t bg-muted/15 px-4 py-4">
            {description ? (
              <OpdsDescription
                description={description}
                documentUrl={getOpdsReadySnapshot(content)?.currentUrl ?? catalog.url}
              />
            ) : null}
            {publication.subjects.length ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {publication.subjects.slice(0, 8).map((subject) => (
                  <span
                    key={subject}
                    className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground"
                  >
                    {subject}
                  </span>
                ))}
              </div>
            ) : null}
            {formats.length ? (
              <Button
                className="mt-4"
                size="sm"
                onClick={() => chooseDownload(publication)}
                disabled={
                  downloadState.status === "downloading" || downloadState.status === "importing"
                }
              >
                <Download className="size-4" />
                {formats.length > 1
                  ? t("library.opds.chooseFormat")
                  : t("library.opds.downloadAndImport")}
              </Button>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                {t("library.opds.unsupportedExplanation")}
              </p>
            )}
          </div>
        ) : null}
      </article>
    );
  };

  const initialLoading = content.status === "idle" || (content.status === "loading" && !feed);
  const showError = content.status === "error";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b bg-background/95 px-4 py-3 backdrop-blur sm:px-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={handleBack}
            aria-label={t("library.opds.back")}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {catalog.name}
            </div>
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="truncate font-serif text-xl font-semibold tracking-tight focus:outline-none"
            >
              {feed?.title ?? t("library.opds.catalog")}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={refresh}
            disabled={
              !feed ||
              content.status === "loading" ||
              (content.status === "ready" && content.refreshing)
            }
            aria-label={t("library.opds.refresh")}
          >
            <RefreshCw
              className={`size-4 ${content.status === "loading" || (content.status === "ready" && content.refreshing) ? "animate-spin" : ""}`}
            />
          </Button>
        </div>
        {feed?.search ? (
          <form className="mt-3 flex gap-2" onSubmit={runSearch}>
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("library.opds.searchPlaceholder")}
              aria-label={t("library.opds.searchPlaceholder")}
            />
            <Button
              type="submit"
              variant="outline"
              disabled={!query.trim()}
              aria-label={t("library.opds.search")}
            >
              <Search className="size-4" />
            </Button>
          </form>
        ) : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {initialLoading ? (
          <output className="flex min-h-64 flex-col items-center justify-center text-center">
            <Loader2 className="size-7 animate-spin text-primary" />
            <h3 className="mt-4 font-serif text-lg font-semibold">{t("library.opds.loading")}</h3>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              {t("library.opds.loadingHint")}
            </p>
          </output>
        ) : null}

        {showError ? (
          <div
            className="mb-4 flex gap-3 rounded-xl border border-destructive/25 bg-destructive/10 p-4"
            role="alert"
          >
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold">{t("library.opds.loadFailed")}</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {t(`library.opds.errors.${content.error}`)}
              </p>
              <div className="mt-3 flex gap-2">
                <Button size="sm" variant="outline" onClick={retry}>
                  {t("library.opds.retry")}
                </Button>
                {content.error === "unauthorized" ? (
                  <Button size="sm" onClick={onEditCredentials}>
                    {t("library.opds.editCredentials")}
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}

        {feed ? (
          <div
            className={
              content.status === "loading" || (content.status === "ready" && content.refreshing)
                ? "opacity-60"
                : ""
            }
            aria-busy={
              content.status === "loading" || (content.status === "ready" && content.refreshing)
            }
          >
            {feed.subtitle ? (
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">{feed.subtitle}</p>
            ) : null}

            {feed.navigation.length ? (
              <section>
                <SectionTitle>{t("library.opds.collections")}</SectionTitle>
                <div className="grid gap-2 sm:grid-cols-2">
                  {feed.navigation.map((item) => (
                    <button
                      type="button"
                      key={item.url}
                      className="flex min-h-12 items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left text-sm font-medium shadow-sm transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => openUrl(item.url, "push")}
                    >
                      <FolderOpen className="size-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      <ChevronRight className="size-4 text-muted-foreground" />
                    </button>
                  ))}
                </div>
              </section>
            ) : null}

            {feed.facets.map((facet, index) => (
              <section key={`${facet.title}:${index}`}>
                <SectionTitle>{facet.title}</SectionTitle>
                <div className="flex flex-wrap gap-2">
                  {facet.links.map((link) => (
                    <Button
                      key={link.url}
                      variant="outline"
                      size="sm"
                      onClick={() => openUrl(link.url, "push")}
                    >
                      {link.title ?? link.url}
                    </Button>
                  ))}
                </div>
              </section>
            ))}

            {windowedFeed?.publications.length ? (
              <section>
                <SectionTitle>{t("library.opds.books")}</SectionTitle>
                <div className="grid gap-3 lg:grid-cols-2">
                  {windowedFeed.publications.map((publication) =>
                    renderPublication(publication, "publication"),
                  )}
                </div>
              </section>
            ) : null}

            {windowedFeed?.groups.map((group, groupIndex) => (
              <section key={`${group.title}:${groupIndex}`}>
                <SectionTitle>{group.title}</SectionTitle>
                {group.navigation.length ? (
                  <div className="mb-3 flex flex-wrap gap-2">
                    {group.navigation.map((item) => (
                      <Button
                        key={item.url}
                        size="sm"
                        variant="outline"
                        onClick={() => openUrl(item.url, "push")}
                      >
                        {item.title}
                      </Button>
                    ))}
                  </div>
                ) : null}
                <div className="grid gap-3 lg:grid-cols-2">
                  {group.publications.map((publication) =>
                    renderPublication(publication, `group-${groupIndex}`),
                  )}
                </div>
              </section>
            ))}

            {windowedFeed?.hasMore ? (
              <div className="mt-5 flex justify-center">
                <Button
                  variant="outline"
                  onClick={() =>
                    setPublicationLimit((current) => current + INITIAL_PUBLICATION_WINDOW)
                  }
                >
                  {t("library.opds.showMore")}
                </Button>
              </div>
            ) : null}

            {!feed.navigation.length && !feed.publications.length && !feed.groups.length ? (
              <div className="flex min-h-52 flex-col items-center justify-center text-center">
                <BookOpen className="size-8 text-muted-foreground" />
                <h3 className="mt-4 font-serif text-lg font-semibold">{t("library.opds.empty")}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t("library.opds.emptyHint")}</p>
              </div>
            ) : null}

            {feed.previousUrl || feed.nextUrl ? (
              <nav
                className="mt-6 flex items-center justify-between border-t pt-4"
                aria-label={t("library.opds.catalog")}
              >
                {feed.previousUrl ? (
                  <Button
                    variant="outline"
                    onClick={() => openUrl(feed.previousUrl as string, "push")}
                  >
                    <ChevronLeft className="size-4" />
                    {t("library.opds.previous")}
                  </Button>
                ) : (
                  <span />
                )}
                {feed.nextUrl ? (
                  <Button variant="outline" onClick={() => openUrl(feed.nextUrl as string, "push")}>
                    {t("library.opds.next")}
                    <ChevronRight className="size-4" />
                  </Button>
                ) : null}
              </nav>
            ) : null}
          </div>
        ) : null}
      </div>

      {downloadState.status !== "idle" ? (
        <div
          className={`border-t px-4 py-3 sm:px-6 ${downloadState.status === "error" ? "bg-destructive/5" : "bg-muted/35"}`}
          role={downloadState.status === "error" ? "alert" : "status"}
          aria-live="polite"
        >
          <div className="flex items-center gap-3">
            {downloadState.status === "downloading" || downloadState.status === "importing" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : downloadState.status === "success" ? (
              <BookOpen className="size-4 text-primary" />
            ) : (
              <CircleAlert className="size-4 text-destructive" />
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{downloadState.title}</div>
              <div className="text-xs text-muted-foreground">
                {downloadState.status === "downloading"
                  ? progress?.total
                    ? t("library.opds.downloadingProgress", {
                        percent: Math.round((progress.loaded / progress.total) * 100),
                      })
                    : t("library.opds.downloading")
                  : downloadState.status === "importing"
                    ? t("library.opds.importing")
                    : downloadState.status === "success"
                      ? downloadState.imported
                        ? t("library.opds.imported")
                        : t("library.opds.alreadyImported")
                      : t(`library.opds.errors.${downloadState.error}`)}
              </div>
            </div>
            {downloadState.status === "downloading" ? (
              <Button variant="ghost" size="sm" onClick={cancelDownload}>
                <X className="size-4" />
                {t("library.opds.cancel")}
              </Button>
            ) : downloadState.status === "error" && lastDownload ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void runDownload(lastDownload.publication, lastDownload.acquisition)}
              >
                {t("library.opds.retry")}
              </Button>
            ) : downloadState.status === "success" ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDownloadState({ status: "idle" })}
              >
                {t("library.opds.done")}
              </Button>
            ) : null}
          </div>
          {downloadState.status === "downloading" || downloadState.status === "importing" ? (
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              tabIndex={0}
              aria-valuemin={0}
              aria-valuemax={progress?.total || undefined}
              aria-valuenow={
                progress?.total ? Math.min(progress.loaded, progress.total) : undefined
              }
            >
              <div
                className={`h-full rounded-full bg-primary transition-[width] ${!progress?.total || downloadState.status === "importing" ? "animate-pulse" : ""}`}
                style={{
                  width:
                    progress?.total && downloadState.status === "downloading"
                      ? `${Math.min(100, (progress.loaded / progress.total) * 100)}%`
                      : "12%",
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <Dialog open={!!formatChoice} onOpenChange={(open) => !open && setFormatChoice(undefined)}>
        <DialogContent closeLabel={t("library.opds.close")} className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("library.opds.chooseFormat")}</DialogTitle>
            <DialogDescription>{formatChoice?.publication.title}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {formatChoice?.acquisitions.map((acquisition) => (
              <Button
                key={`${acquisition.format}:${acquisition.url}`}
                variant="outline"
                className="justify-between"
                onClick={() => {
                  const publication = formatChoice.publication;
                  setFormatChoice(undefined);
                  void runDownload(publication, acquisition);
                }}
                aria-label={t("library.opds.downloadFormat", {
                  format: acquisition.format.toUpperCase(),
                })}
              >
                <span>{acquisition.format.toUpperCase()}</span>
                <Download className="size-4" />
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
