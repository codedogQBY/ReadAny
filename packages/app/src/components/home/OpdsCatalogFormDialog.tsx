import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Switch } from "@/components/ui/switch";
import {
  type OpdsCatalog,
  type OpdsCatalogAuth,
  type OpdsCatalogStore,
  canPreserveOpdsCatalogPassword,
  classifyOpdsUrl,
} from "@readany/core";
import { Loader2, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface OpdsCatalogFormDialogProps {
  open: boolean;
  catalog?: OpdsCatalog;
  store: OpdsCatalogStore;
  onOpenChange(open: boolean): void;
  onSaved(): void;
  onBackgroundSaved?(): void;
}

export function OpdsCatalogFormDialog({
  open,
  catalog,
  store,
  onOpenChange,
  onSaved,
  onBackgroundSaved,
}: OpdsCatalogFormDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [auth, setAuth] = useState<OpdsCatalogAuth>("anonymous");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [renderedOpenGeneration, setRenderedOpenGeneration] = useState(0);
  const [confirmingLocalHttp, setConfirmingLocalHttp] = useState(false);
  const [error, setError] = useState<string>();
  const openGeneration = useRef(0);
  const saveGeneration = useRef(0);
  const wasOpen = useRef(false);
  const openRef = useRef(open);
  const activeSave = useRef<{ saveGeneration: number; openGeneration: number } | undefined>(
    undefined,
  );
  openRef.current = open;

  useEffect(() => {
    const opening = open && !wasOpen.current;
    wasOpen.current = open;
    if (!open) {
      setPassword("");
      return;
    }
    if (!opening) return;
    openGeneration.current += 1;
    setRenderedOpenGeneration(openGeneration.current);
    setName(catalog?.name ?? "");
    setUrl(catalog?.url ?? "");
    setAuth(catalog?.auth ?? "anonymous");
    setUsername(catalog?.username ?? "");
    setPassword("");
    setEnabled(catalog?.enabled ?? true);
    setConfirmingLocalHttp(false);
    setError(undefined);
  }, [catalog, open]);

  const hasPassword = (catalog?.passwordStorage ?? "none") !== "none";
  const preservesPassword = Boolean(
    catalog &&
      canPreserveOpdsCatalogPassword(catalog, {
        url: url.trim(),
        auth,
        username: username.trim(),
      }),
  );
  const canSubmit =
    name.trim().length > 0 &&
    url.trim().length > 0 &&
    (auth === "anonymous" ||
      (username.trim().length > 0 && (password.length > 0 || preservesPassword))) &&
    !submitting;
  const savingCurrentOpen =
    submitting && activeSave.current?.openGeneration === renderedOpenGeneration;

  const persist = async () => {
    if (!canSubmit || activeSave.current) return;
    const saveId = ++saveGeneration.current;
    const saveOpenGeneration = openGeneration.current;
    activeSave.current = {
      saveGeneration: saveId,
      openGeneration: saveOpenGeneration,
    };
    const isCurrentOpenAttempt = () =>
      activeSave.current?.saveGeneration === saveId &&
      activeSave.current.openGeneration === openGeneration.current &&
      openRef.current;
    setSubmitting(true);
    setError(undefined);
    try {
      const input = {
        name: name.trim(),
        url: url.trim(),
        auth,
        enabled,
        ...(auth === "basic"
          ? { username: username.trim(), ...(password ? { password } : {}) }
          : {}),
      };
      if (catalog) await store.updateCatalog(catalog.id, input);
      else await store.addCatalog(input);
      if (!isCurrentOpenAttempt()) {
        onBackgroundSaved?.();
        return;
      }
      setPassword("");
      onSaved();
    } catch {
      if (isCurrentOpenAttempt()) {
        setError(t("library.opds.form.saveFailed"));
      }
    } finally {
      if (activeSave.current?.saveGeneration === saveId) {
        activeSave.current = undefined;
        setSubmitting(false);
      }
    }
  };

  const validateAndSave = () => {
    if (!canSubmit) return;
    const classification = classifyOpdsUrl(url.trim());
    if (!classification.allowed) {
      const key =
        classification.reason === "public-http"
          ? "publicHttpBlocked"
          : classification.reason === "credentials-not-allowed"
            ? "credentialsInUrl"
            : "invalidUrl";
      setError(t(`library.opds.form.${key}`));
      return;
    }
    if (classification.requiresInsecureConfirmation) {
      setConfirmingLocalHttp(true);
      return;
    }
    void persist();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && savingCurrentOpen) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent
        closeLabel={t("library.opds.close")}
        closeDisabled={savingCurrentOpen}
        aria-busy={savingCurrentOpen}
        onEscapeKeyDown={(event) => {
          if (savingCurrentOpen) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (savingCurrentOpen) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (savingCurrentOpen) event.preventDefault();
        }}
        className="max-h-[calc(100vh-32px)] w-[min(92vw,620px)] max-w-none overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>
            {catalog ? t("library.opds.form.editTitle") : t("library.opds.form.addTitle")}
          </DialogTitle>
          <DialogDescription>{t("library.opds.form.subtitle")}</DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            validateAndSave();
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <label htmlFor="opds-catalog-name" className="space-y-2 text-sm font-medium">
              <span>{t("library.opds.form.name")}</span>
              <Input
                id="opds-catalog-name"
                autoFocus
                disabled={savingCurrentOpen}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder={t("library.opds.form.namePlaceholder")}
              />
            </label>
            <label
              htmlFor="opds-catalog-url"
              className="space-y-2 text-sm font-medium sm:col-span-2"
            >
              <span>{t("library.opds.form.url")}</span>
              <Input
                id="opds-catalog-url"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                disabled={savingCurrentOpen}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                placeholder="https://catalog.example.com/opds"
              />
            </label>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("library.opds.form.authentication")}</legend>
            <div className="grid grid-cols-2 rounded-xl bg-muted p-1" role="radiogroup">
              {(["anonymous", "basic"] as const).map((mode) => (
                <label
                  key={mode}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring ${
                    savingCurrentOpen ? "cursor-not-allowed opacity-50" : "cursor-pointer"
                  } ${
                    auth === mode
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  <input
                    className="sr-only"
                    type="radio"
                    name="opds-authentication"
                    value={mode}
                    checked={auth === mode}
                    disabled={savingCurrentOpen}
                    onChange={() => setAuth(mode)}
                  />
                  {t(`library.opds.form.${mode}`)}
                </label>
              ))}
            </div>
          </fieldset>

          {auth === "basic" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label htmlFor="opds-catalog-username" className="space-y-2 text-sm font-medium">
                <span>{t("library.opds.form.username")}</span>
                <Input
                  id="opds-catalog-username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  disabled={savingCurrentOpen}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </label>
              <label htmlFor="opds-catalog-password" className="space-y-2 text-sm font-medium">
                <span>{t("library.opds.form.password")}</span>
                <PasswordInput
                  id="opds-catalog-password"
                  autoComplete="new-password"
                  disabled={savingCurrentOpen}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  showPasswordLabel={t("library.opds.showPassword")}
                  hidePasswordLabel={t("library.opds.hidePassword")}
                  placeholder={
                    catalog && hasPassword
                      ? t(
                          preservesPassword
                            ? "library.opds.form.passwordUnchanged"
                            : "library.opds.form.passwordRequiredForIdentityChange",
                        )
                      : undefined
                  }
                />
              </label>
              {catalog ? (
                <output className="text-xs text-muted-foreground sm:col-span-2">
                  {catalog.passwordStorage === "persistent"
                    ? t("library.opds.form.passwordStoredSecurely")
                    : catalog.passwordStorage === "session-only"
                      ? t("library.opds.form.passwordSessionOnly")
                      : t("library.opds.form.passwordMissing")}
                </output>
              ) : null}
            </div>
          ) : null}

          <div className="flex items-center justify-between gap-4 rounded-xl border bg-card px-4 py-3">
            <div>
              <div className="text-sm font-medium">{t("library.opds.form.enabled")}</div>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {t("library.opds.form.enabledHint")}
              </p>
            </div>
            <Switch
              checked={enabled}
              disabled={savingCurrentOpen}
              onCheckedChange={setEnabled}
              aria-label={t("library.opds.form.enabled")}
            />
          </div>

          {confirmingLocalHttp ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4" role="alert">
              <div className="flex gap-3">
                <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold">{t("library.opds.form.localHttpTitle")}</h3>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {t("library.opds.form.localHttpWarning")}
                  </p>
                  <div className="mt-3 flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={savingCurrentOpen}
                      onClick={() => setConfirmingLocalHttp(false)}
                    >
                      {t("library.opds.cancel")}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void persist()}
                      disabled={savingCurrentOpen}
                    >
                      {t("library.opds.continue")}
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {error ? (
            <div
              className="rounded-xl border border-destructive/25 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={savingCurrentOpen}
            >
              {t("library.opds.cancel")}
            </Button>
            <Button type="submit" disabled={!canSubmit || confirmingLocalHttp}>
              {submitting ? <Loader2 className="size-4 animate-spin" /> : null}
              {t("library.opds.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
