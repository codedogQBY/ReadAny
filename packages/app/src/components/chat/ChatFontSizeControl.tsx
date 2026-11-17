import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import {
  DEFAULT_CHAT_FONT_SIZE,
  MAX_CHAT_FONT_SIZE,
  MIN_CHAT_FONT_SIZE,
  useChatAppearanceStore,
} from "@/stores/chat-appearance-store";
import { Minus, Plus } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

export function ChatFontSizeControl() {
  const { t } = useTranslation();
  const labelId = useId();
  const fontSize = useChatAppearanceStore((state) => state.fontSize);
  const setFontSize = useChatAppearanceStore((state) => state.setFontSize);
  const buttonClass =
    "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:pointer-events-none";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={t("chat.fontSize")}
          aria-label={t("chat.fontSize")}
          className={`${buttonClass} font-medium text-sm`}
        >
          Aa
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3 rounded-xl">
        <div className="flex items-center justify-between">
          <span id={labelId} className="text-sm font-medium">
            {t("chat.fontSize")}
          </span>
          <output className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {fontSize} px
          </output>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={buttonClass}
            aria-label={t("chat.decreaseFontSize")}
            disabled={fontSize <= MIN_CHAT_FONT_SIZE}
            onClick={() => setFontSize(fontSize - 1)}
          >
            <Minus className="size-4" />
          </button>
          <Slider
            aria-labelledby={labelId}
            min={MIN_CHAT_FONT_SIZE}
            max={MAX_CHAT_FONT_SIZE}
            step={1}
            value={[fontSize]}
            onValueChange={([value]) => setFontSize(value)}
          />
          <button
            type="button"
            className={buttonClass}
            aria-label={t("chat.increaseFontSize")}
            disabled={fontSize >= MAX_CHAT_FONT_SIZE}
            onClick={() => setFontSize(fontSize + 1)}
          >
            <Plus className="size-4" />
          </button>
        </div>
        <div className="flex justify-end border-t pt-2">
          <button
            type="button"
            className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            disabled={fontSize === DEFAULT_CHAT_FONT_SIZE}
            onClick={() => setFontSize(DEFAULT_CHAT_FONT_SIZE)}
          >
            {t("chat.resetFontSize")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
