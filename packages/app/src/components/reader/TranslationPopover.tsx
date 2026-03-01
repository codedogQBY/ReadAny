/**
 * TranslationPopover — compact floating popover for translation
 * Robust positioning: always stays within viewport
 */
import { useSettingsStore } from "@/stores/settings-store";
import { useTranslator } from "@/hooks/useTranslator";
import { Check, ChevronDown, Copy, Loader2, Languages, X } from "lucide-react";
import { useEffect, useState, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { TRANSLATOR_LANGS, TranslationTargetLang } from "@/types/translation";

interface TranslationPopoverProps {
  text: string;
  position: { x: number; y: number };
  onClose: () => void;
}

const POPOVER_WIDTH = 288; // w-72 = 18rem = 288px
const POPOVER_MIN_HEIGHT = 100; // header + content min height
const POPOVER_MAX_HEIGHT = 200; // max total height
const PADDING = 16;
const GAP = 8;

export function TranslationPopover({ text, position, onClose }: TranslationPopoverProps) {
  const { t } = useTranslation();
  const translationConfig = useSettingsStore((s) => s.translationConfig);
  const updateTranslationConfig = useSettingsStore((s) => s.updateTranslationConfig);

  // Local state
  const [targetLang, setTargetLang] = useState<TranslationTargetLang>(translationConfig.targetLang);
  const [translation, setTranslation] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [langOpen, setLangOpen] = useState(false);

  const { translate, loading, error, provider } = useTranslator({ targetLang });

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const langRef = useRef<HTMLDivElement>(null);

  // Calculate safe position that stays within viewport
  const calculatePosition = useCallback(() => {
    const popoverHeight = Math.min(
      containerRef.current?.offsetHeight || POPOVER_MIN_HEIGHT,
      POPOVER_MAX_HEIGHT
    );
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Calculate X: center on selection point, but clamp to viewport
    let x = position.x;
    const halfWidth = POPOVER_WIDTH / 2;
    
    // Clamp left edge
    if (x - halfWidth < PADDING) {
      x = halfWidth + PADDING;
    }
    // Clamp right edge
    if (x + halfWidth > viewportWidth - PADDING) {
      x = viewportWidth - halfWidth - PADDING;
    }

    // Calculate Y: prefer above selection, fallback to below
    const spaceAbove = position.y - GAP;
    const spaceBelow = viewportHeight - position.y - GAP;
    
    let y: number;
    let showAbove: boolean;

    if (spaceAbove >= popoverHeight) {
      // Enough space above - show above
      y = position.y - GAP;
      showAbove = true;
    } else if (spaceBelow >= popoverHeight) {
      // Not enough above, but enough below - show below
      y = position.y + GAP;
      showAbove = false;
    } else {
      // Not enough space either way - use the side with more space
      if (spaceAbove > spaceBelow) {
        y = PADDING + popoverHeight;
        showAbove = true;
      } else {
        y = position.y + GAP;
        // Clamp to bottom
        y = Math.min(y, viewportHeight - popoverHeight - PADDING);
        showAbove = false;
      }
    }

    return { x, y, showAbove };
  }, [position]);

  const [pos, setPos] = useState(() => calculatePosition());

  // Update position when content changes
  useEffect(() => {
    setPos(calculatePosition());
  }, [calculatePosition, translation, loading]);

  // Update position on resize
  useEffect(() => {
    const handleResize = () => setPos(calculatePosition());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [calculatePosition]);

  // Click outside to close
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", handler), 50);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Fetch translation
  useEffect(() => {
    let cancelled = false;
    setTranslation(null);

    const fetch = async () => {
      try {
        const input = text.split("\n").join(" ").trim();
        const results = await translate([input]);
        if (!cancelled && results[0]) {
          setTranslation(results[0]);
        }
      } catch (err) {
        console.error("Translation error:", err);
      }
    };

    fetch();
    return () => { cancelled = true; };
  }, [text, targetLang, translate]);

  const handleLangChange = (lang: TranslationTargetLang) => {
    setTargetLang(lang);
    updateTranslationConfig({ targetLang: lang });
    setLangOpen(false);
  };

  const handleCopy = async () => {
    if (translation) {
      await navigator.clipboard.writeText(translation);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Get provider display name
  const aiConfig = useSettingsStore((s) => s.aiConfig);
  const endpointId = translationConfig.provider.endpointId || aiConfig.activeEndpointId;
  const endpoint = aiConfig.endpoints.find((e) => e.id === endpointId);
  const providerName = provider === "ai" ? (endpoint?.name || "AI") : "DeepL";

  return (
    <div
      ref={containerRef}
      className="fixed z-50"
      style={{
        width: POPOVER_WIDTH,
        left: pos.x,
        top: pos.y,
        transform: pos.showAbove ? "translate(-50%, -100%)" : "translate(-50%, 0)",
      }}
    >
      <div className="rounded-lg border border-border bg-background shadow-lg">
        {/* Header: Language selector + Close */}
        <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
          <div className="relative" ref={langRef}>
            <button
              type="button"
              onClick={() => setLangOpen(!langOpen)}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Languages className="h-3.5 w-3.5" />
              <span>{TRANSLATOR_LANGS[targetLang]}</span>
              <ChevronDown className="h-3 w-3" />
            </button>
            
            {langOpen && (
              <div className="absolute left-0 top-full z-50 mt-1 w-36 rounded-md border bg-background p-1 shadow-lg">
                <div className="max-h-48 overflow-y-auto">
                  {Object.entries(TRANSLATOR_LANGS).map(([code, name]) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => handleLangChange(code as TranslationTargetLang)}
                      className={`flex w-full items-center justify-between rounded-sm px-2 py-1 text-left text-xs ${
                        code === targetLang ? "bg-primary/10 text-primary" : "hover:bg-muted"
                      }`}
                    >
                      <span>{name}</span>
                      {code === targetLang && <Check className="h-3 w-3" />}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          
          <button
            type="button"
            onClick={onClose}
            className="flex h-5 w-5 items-center justify-center rounded-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Translation content */}
        <div className="p-3">
          {loading && (
            <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>{t("translation.translating", "翻译中...")}</span>
            </div>
          )}

          {error && !loading && (
            <div className="py-1 text-sm text-destructive">{error}</div>
          )}

          {!loading && !error && translation && (
            <>
              <p className="max-h-32 overflow-y-auto text-sm leading-relaxed">{translation}</p>
              <div className="flex items-center justify-end gap-2 pt-1">
                <span className="text-[10px] text-muted-foreground">{providerName}</span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {copied ? (
                    <>
                      <Check className="h-3 w-3" />
                      <span>{t("common.copied", "已复制")}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>{t("common.copy", "复制")}</span>
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}