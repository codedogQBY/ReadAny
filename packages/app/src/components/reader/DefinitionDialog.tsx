import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { useDictionaryStore } from "@/stores/dictionary-store";
import {
  DefinitionController,
  type DefinitionState,
} from "@readany/core/dictionary/definition-controller";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function DefinitionDialog({
  text,
  onClose,
  onManageDictionaries,
  controller: suppliedController,
}: {
  text: string;
  onClose(): void;
  onManageDictionaries(): void;
  controller?: DefinitionController;
}) {
  const { t } = useTranslation();
  const [controller] = useState(
    () =>
      suppliedController ??
      new DefinitionController({
        lookup: (text) => useDictionaryStore.getState().lookup(text),
        getDescriptor: (language) => useDictionaryStore.getState().manifest?.packs[language],
        install: async (descriptor, onProgress, onVerifying) => {
          const unsubscribe = useDictionaryStore.subscribe((state) => {
            const status = state.packs[descriptor.language];
            if (status.state === "downloading") onProgress(status.progress);
            if (status.state === "verifying") onVerifying?.();
          });
          try {
            await useDictionaryStore.getState().install(descriptor.language);
          } finally {
            unsubscribe();
          }
        },
      }),
  );
  const [state, setState] = useState<DefinitionState>(controller.state);
  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    void controller.open(text);
    return () => {
      unsubscribe();
      controller.close();
    };
  }, [controller, text]);
  const language =
    state.kind === "missing-pack" || state.kind === "downloading"
      ? t(`dictionary.${state.language === "en" ? "english" : "chinese"}`)
      : "";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-lg" aria-describedby={undefined}>
        <DialogTitle>{t("dictionary.title")}</DialogTitle>
        <div className="max-h-[55vh] space-y-4 overflow-y-auto text-sm" aria-live="polite">
          {state.kind === "loading" && <output>{t("dictionary.loadingDefinition")}</output>}
          {state.kind === "verifying" && <output>{t("dictionary.verifying")}</output>}
          {state.kind === "unsupported" && <p>{t("dictionary.unsupportedSelection")}</p>}
          {state.kind === "no-match" && <p>{t("dictionary.noDefinitionFound")}</p>}
          {state.kind === "error" && (
            <div className="space-y-3">
              <p role="alert">{t("dictionary.lookupError")}</p>
              <Button onClick={() => void controller.retry()}>{t("dictionary.retry")}</Button>
            </div>
          )}
          {state.kind === "missing-pack" && (
            <div className="space-y-3">
              <p>
                {t("dictionary.downloadDefinition", {
                  language,
                  size: `${(state.descriptor.sizeBytes / 1024 / 1024).toFixed(1)} MB`,
                })}
              </p>
              <Button onClick={() => void controller.download()}>{t("dictionary.download")}</Button>
            </div>
          )}
          {state.kind === "downloading" && (
            <div className="space-y-2">
              <output>
                {t("dictionary.downloadingDefinition", {
                  language,
                  progress: Math.round(state.progress * 100),
                })}
              </output>
              <Progress
                value={state.progress * 100}
                aria-label={t("dictionary.downloadingAccessibility", { language })}
              />
            </div>
          )}
          {state.kind === "result" && (
            <>
              <p className="text-muted-foreground">{state.displayText}</p>
              {state.entries.map((entry) => (
                <article
                  key={entry.id}
                  className="space-y-2 border-b border-border pb-4 last:border-0"
                >
                  <h3 className="text-lg font-semibold">
                    {[
                      ...new Set(
                        [entry.headword, entry.simplified, entry.traditional].filter(Boolean),
                      ),
                    ].join(" / ")}
                  </h3>
                  {entry.pronunciation && (
                    <p className="text-muted-foreground">{entry.pronunciation}</p>
                  )}
                  {entry.partOfSpeech && (
                    <p className="italic text-muted-foreground">{entry.partOfSpeech}</p>
                  )}
                  <ol className="list-decimal space-y-2 pl-5">
                    {entry.senses.map((sense) => (
                      <li key={`${sense.order}:${sense.definition}`}>{sense.definition}</li>
                    ))}
                  </ol>
                </article>
              ))}
            </>
          )}
        </div>
        <div className="flex justify-end border-t border-border pt-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onClose();
              onManageDictionaries();
            }}
          >
            {t("dictionary.manageDictionaries")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
