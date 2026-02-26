import { getLanguageNativeName, translate } from "@/lib/translation/translator";
import { useSettingsStore } from "@/stores/settings-store";
import { Check, Copy, Loader2, X } from "lucide-react";
/**
 * TranslationPopover — floating popover showing translated text
 */
import { useEffect, useState } from "react";

interface TranslationPopoverProps {
  text: string;
  position: { x: number; y: number };
  onClose: () => void;
}

export function TranslationPopover({ text, position, onClose }: TranslationPopoverProps) {
  const [translatedText, setTranslatedText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const translationConfig = useSettingsStore((s) => s.translationConfig);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(null);

    translate(text, translationConfig)
      .then((result) => {
        if (!cancelled) {
          setTranslatedText(result.translatedText);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Translation failed");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [text, translationConfig]);

  const handleCopy = async () => {
    if (translatedText) {
      await navigator.clipboard.writeText(translatedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Clamp position to keep popover on screen
  const left = Math.max(16, Math.min(position.x - 160, window.innerWidth - 336));
  const top = Math.max(16, position.y + 8);

  return (
    <div
      className="absolute z-50 w-80 rounded-lg border border-border bg-popover shadow-lg"
      style={{ left, top }}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          Translate to {getLanguageNativeName(translationConfig.targetLang)}
        </span>
        <button
          className="flex h-5 w-5 items-center justify-center rounded-sm transition-colors hover:bg-muted"
          onClick={onClose}
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Original text */}
      <div className="border-b border-border px-3 py-2">
        <div className="mb-1 text-[10px] font-medium uppercase text-muted-foreground">Original</div>
        <div className="max-h-20 overflow-y-auto text-sm leading-relaxed">
          {text.length > 200 ? `${text.slice(0, 200)}...` : text}
        </div>
      </div>

      {/* Translation */}
      <div className="px-3 py-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-medium uppercase text-muted-foreground">
            Translation
          </span>
          {translatedText && (
            <button
              className="flex h-5 items-center gap-1 rounded-sm px-1 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              onClick={handleCopy}
            >
              {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
              {copied ? "Copied" : "Copy"}
            </button>
          )}
        </div>

        {loading && (
          <div className="flex items-center gap-2 py-2">
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Translating...</span>
          </div>
        )}

        {error && <div className="py-2 text-sm text-destructive">{error}</div>}

        {!loading && !error && (
          <div className="max-h-32 overflow-y-auto text-sm leading-relaxed">
            {translatedText || (
              <span className="text-muted-foreground">No translation available</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
