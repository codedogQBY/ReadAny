import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import type { OpdsCatalog } from "@readany/core";
import {
  BookOpen,
  ChevronRight,
  EyeOff,
  Globe2,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { OpdsBrowser } from "./OpdsBrowser";
import { OpdsCatalogFormDialog } from "./OpdsCatalogFormDialog";
import { opdsDesktopRuntime } from "./opds-desktop-runtime";

interface OpdsCatalogsDialogProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function OpdsCatalogsDialog({ open, onOpenChange }: OpdsCatalogsDialogProps) {
  const { t } = useTranslation();
  const store = useMemo(() => opdsDesktopRuntime.getCatalogStore(), []);
  const client = useMemo(() => opdsDesktopRuntime.getClient(), []);
  const [catalogs, setCatalogs] = useState<OpdsCatalog[]>([]);
  const [selected, setSelected] = useState<OpdsCatalog>();
  const [editing, setEditing] = useState<OpdsCatalog>();
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<OpdsCatalog>();
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string>();
  const [error, setError] = useState<string>();
  const backHandler = useRef<(() => boolean) | undefined>(undefined);
  const dialogOrigin = useRef<HTMLElement | undefined>(undefined);
  const returnFocusCatalogId = useRef<string | undefined>(undefined);
  const returnFocusElement = useRef<HTMLButtonElement | undefined>(undefined);

  const syncCatalogs = useCallback(() => {
    const next = store.listCatalogs({ includeHidden: true });
    setCatalogs(next);
    setSelected((current) => (current ? next.find(({ id }) => id === current.id) : undefined));
  }, [store]);

  useEffect(() => {
    if (!open) {
      setSelected(undefined);
      setEditing(undefined);
      setFormOpen(false);
      setDeleting(undefined);
      setError(undefined);
      return;
    }
    let active = true;
    setLoading(true);
    void opdsDesktopRuntime
      .ensureCatalogsLoaded()
      .then(() => {
        if (!active) return;
        syncCatalogs();
        setError(undefined);
      })
      .catch(() => {
        if (active) setError(t("library.opds.catalogsLoadFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open, syncCatalogs, t]);

  useEffect(() => {
    if (open && !selected && returnFocusCatalogId.current) {
      requestAnimationFrame(() => returnFocusElement.current?.focus());
    }
  }, [open, selected]);

  const mutate = async (catalogId: string, operation: () => Promise<unknown>) => {
    setBusyId(catalogId);
    setError(undefined);
    try {
      await operation();
      syncCatalogs();
    } catch {
      setError(t("library.opds.catalogActionFailed"));
    } finally {
      setBusyId(undefined);
    }
  };

  const authenticationLabel = (catalog: OpdsCatalog) => {
    if (catalog.auth === "anonymous") return t("library.opds.authAnonymous");
    if (catalog.passwordStorage === "persistent") return t("library.opds.authSecure");
    if (catalog.passwordStorage === "session-only") return t("library.opds.authSession");
    return t("library.opds.authMissing");
  };

  const visibleCatalogs = catalogs.filter((catalog) => !catalog.hidden);
  const hiddenBuiltIns = catalogs.filter((catalog) => catalog.builtIn && catalog.hidden);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          closeLabel={t("library.opds.close")}
          onOpenAutoFocus={() => {
            if (document.activeElement instanceof HTMLElement) {
              dialogOrigin.current = document.activeElement;
            }
          }}
          onCloseAutoFocus={(event) => {
            const origin = dialogOrigin.current;
            if (!origin?.isConnected) return;
            event.preventDefault();
            origin.focus();
          }}
          className="flex h-[min(88vh,860px)] max-h-[calc(100vh-24px)] w-[min(1080px,calc(100vw-24px))] max-w-none flex-col gap-0 overflow-hidden p-0"
          onEscapeKeyDown={(event) => {
            if (!selected) return;
            event.preventDefault();
            backHandler.current?.();
          }}
        >
          {selected ? (
            <>
              <DialogTitle className="sr-only">{selected.name}</DialogTitle>
              <DialogDescription className="sr-only">
                {t("library.opds.catalogsSubtitle")}
              </DialogDescription>
              <OpdsBrowser
                key={`${selected.id}:${selected.url}`}
                catalog={selected}
                store={store}
                client={client}
                onBack={() => setSelected(undefined)}
                onEditCredentials={() => {
                  if (selected.builtIn) return;
                  setEditing(selected);
                  setFormOpen(true);
                }}
                registerBackHandler={(handler) => {
                  backHandler.current = handler;
                }}
              />
            </>
          ) : (
            <>
              <DialogHeader className="border-b px-5 py-5 pr-14 sm:px-7">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                      <BookOpen className="size-4" />
                      {t("library.opds.readerEyebrow")}
                    </div>
                    <DialogTitle className="font-serif text-2xl tracking-tight">
                      {t("library.opds.catalogsTitle")}
                    </DialogTitle>
                    <DialogDescription className="mt-2 max-w-2xl leading-6">
                      {t("library.opds.catalogsSubtitle")}
                    </DialogDescription>
                  </div>
                  <Button
                    className="shrink-0"
                    onClick={() => {
                      setEditing(undefined);
                      setFormOpen(true);
                    }}
                  >
                    <Plus className="size-4" />
                    <span className="hidden sm:inline">{t("library.opds.form.addTitle")}</span>
                  </Button>
                </div>
              </DialogHeader>

              <div className="min-h-0 flex-1 overflow-y-auto bg-muted/15 px-4 py-5 sm:px-7">
                <div className="mb-5 rounded-2xl border border-primary/15 bg-primary/[0.045] p-4 sm:p-5">
                  <p className="max-w-3xl font-serif text-base leading-7 text-foreground">
                    {t("library.opds.readerIntro")}
                  </p>
                </div>

                {error ? (
                  <div
                    className="mb-4 rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                    role="alert"
                  >
                    {error}
                  </div>
                ) : null}

                {loading ? (
                  <output className="flex min-h-64 flex-col items-center justify-center">
                    <Loader2 className="size-7 animate-spin text-primary" />
                    <p className="mt-3 text-sm text-muted-foreground">
                      {t("library.opds.loadingCatalogs")}
                    </p>
                  </output>
                ) : (
                  <div className="space-y-7">
                    <section aria-labelledby="opds-available-heading">
                      <h2
                        id="opds-available-heading"
                        className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground"
                      >
                        {t("library.opds.available")}
                      </h2>
                      <div className="grid gap-3 lg:grid-cols-2">
                        {visibleCatalogs.map((catalog) => {
                          const busy = busyId === catalog.id;
                          return (
                            <article
                              key={catalog.id}
                              className={`overflow-hidden rounded-2xl border bg-card shadow-sm ${!catalog.enabled ? "opacity-60" : ""}`}
                            >
                              <button
                                ref={(element) => {
                                  if (returnFocusCatalogId.current === catalog.id && element) {
                                    returnFocusElement.current = element;
                                  }
                                }}
                                type="button"
                                className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-not-allowed"
                                disabled={!catalog.enabled || busy}
                                onClick={(event) => {
                                  returnFocusCatalogId.current = catalog.id;
                                  returnFocusElement.current = event.currentTarget;
                                  setSelected(catalog);
                                }}
                                aria-label={t("library.opds.browseCatalog", { name: catalog.name })}
                              >
                                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/8 text-primary">
                                  {busy ? (
                                    <Loader2 className="size-5 animate-spin" />
                                  ) : (
                                    <Globe2 className="size-5" />
                                  )}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center gap-2">
                                    <span className="truncate font-serif text-base font-semibold">
                                      {catalog.name}
                                    </span>
                                    {catalog.builtIn ? (
                                      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                        {t("library.opds.builtIn")}
                                      </span>
                                    ) : null}
                                  </span>
                                  <span className="mt-1 block truncate text-xs text-muted-foreground">
                                    {catalog.url}
                                  </span>
                                  <span className="mt-1 block text-xs text-muted-foreground">
                                    {authenticationLabel(catalog)}
                                  </span>
                                </span>
                                {catalog.enabled ? (
                                  <ChevronRight className="size-4 text-muted-foreground" />
                                ) : null}
                              </button>
                              <div className="flex min-h-12 items-center gap-1 border-t px-3 py-1.5">
                                {catalog.builtIn ? (
                                  <>
                                    <span className="mr-auto pl-1 text-xs text-muted-foreground">
                                      {t("library.opds.builtInLocked")}
                                    </span>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() =>
                                        void mutate(catalog.id, () => store.hideBuiltIn(catalog.id))
                                      }
                                      aria-label={t("library.opds.hideCatalog", {
                                        name: catalog.name,
                                      })}
                                    >
                                      <EyeOff className="size-4" />
                                    </Button>
                                  </>
                                ) : (
                                  <>
                                    <span className="mr-auto pl-1 text-xs text-muted-foreground">
                                      {catalog.enabled
                                        ? t("library.opds.enabled")
                                        : t("library.opds.disabled")}
                                    </span>
                                    <Switch
                                      checked={catalog.enabled}
                                      disabled={busy}
                                      onCheckedChange={(enabled) =>
                                        void mutate(catalog.id, () =>
                                          store.setCatalogEnabled(catalog.id, enabled),
                                        )
                                      }
                                      aria-label={t("library.opds.toggleCatalog", {
                                        name: catalog.name,
                                      })}
                                    />
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      onClick={() => {
                                        setEditing(catalog);
                                        setFormOpen(true);
                                      }}
                                      aria-label={t("library.opds.editCatalog", {
                                        name: catalog.name,
                                      })}
                                    >
                                      <Pencil className="size-4" />
                                    </Button>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="text-destructive hover:text-destructive"
                                      onClick={() => setDeleting(catalog)}
                                      aria-label={t("library.opds.deleteCatalog", {
                                        name: catalog.name,
                                      })}
                                    >
                                      <Trash2 className="size-4" />
                                    </Button>
                                  </>
                                )}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>

                    {hiddenBuiltIns.length ? (
                      <section aria-labelledby="opds-hidden-heading">
                        <h2
                          id="opds-hidden-heading"
                          className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground"
                        >
                          {t("library.opds.hiddenPresets")}
                        </h2>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {hiddenBuiltIns.map((catalog) => (
                            <div
                              key={catalog.id}
                              className="flex items-center gap-3 rounded-xl border bg-card/70 px-4 py-3"
                            >
                              <RotateCcw className="size-4 text-muted-foreground" />
                              <span className="min-w-0 flex-1 truncate text-sm">
                                {catalog.name}
                              </span>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  void mutate(catalog.id, () => store.restoreBuiltIn(catalog.id))
                                }
                                aria-label={t("library.opds.restoreCatalog", {
                                  name: catalog.name,
                                })}
                              >
                                {t("library.opds.restore")}
                              </Button>
                            </div>
                          ))}
                        </div>
                      </section>
                    ) : null}
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <OpdsCatalogFormDialog
        open={formOpen}
        catalog={editing}
        store={store}
        onOpenChange={setFormOpen}
        onSaved={() => {
          setFormOpen(false);
          setEditing(undefined);
          syncCatalogs();
        }}
        onBackgroundSaved={syncCatalogs}
      />

      <Dialog open={!!deleting} onOpenChange={(next) => !next && setDeleting(undefined)}>
        <DialogContent closeLabel={t("library.opds.close")} className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("library.opds.deleteTitle")}</DialogTitle>
            <DialogDescription>{t("library.opds.deleteDescription")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleting(undefined)}>
              {t("library.opds.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                const catalog = deleting;
                setDeleting(undefined);
                if (catalog) void mutate(catalog.id, () => store.removeCatalog(catalog.id));
              }}
            >
              {t("library.opds.delete")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
