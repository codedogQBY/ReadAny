/**
 * ChatInput — sageread-style rounded card input with deep thinking option
 * Supports attached context quotes that display as chips above the textarea.
 */
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useChatTypography } from "@/stores/chat-appearance-store";
import type { AttachedQuote } from "@readany/core/types";
import { Brain, EyeOff, Quote, Send, Square, X } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
export type { AttachedQuote };

interface ChatInputProps {
  onSend: (
    content: string,
    deepThinking?: boolean,
    spoilerFree?: boolean,
    quotes?: AttachedQuote[],
  ) => void;
  onStop?: () => void;
  isStreaming?: boolean;
  disabled?: boolean;
  placeholder?: string;
  showDeepThinking?: boolean;
  quotes?: AttachedQuote[];
  onRemoveQuote?: (id: string) => void;
}

export function ChatInput({
  onSend,
  onStop,
  isStreaming,
  disabled,
  placeholder,
  showDeepThinking = true,
  quotes = [],
  onRemoveQuote,
}: ChatInputProps) {
  const { t } = useTranslation();
  const typography = useChatTypography();
  const [value, setValue] = useState("");
  const [deepThinking, setDeepThinking] = useState(false);
  const [spoilerFree, setSpoilerFree] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resolvedPlaceholder = placeholder || t("chat.askPlaceholder");

  const handleSend = useCallback(
    (useDeepThinking: boolean = deepThinking) => {
      const trimmed = value.trim();
      if (trimmed || quotes.length > 0) {
        onSend(trimmed, useDeepThinking, spoilerFree, quotes.length > 0 ? quotes : undefined);
        setValue("");
        if (textareaRef.current) textareaRef.current.style.height = "auto";
      }
    },
    [value, deepThinking, spoilerFree, onSend, quotes],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
  }, []);

  const toggleDeepThinking = useCallback(() => {
    setDeepThinking((prev) => !prev);
  }, []);

  // Recalculate wrapping even when only the font size changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: font changes alter textarea wrapping.
  useLayoutEffect(() => handleInput(), [handleInput, typography]);

  const toggleSpoilerFree = useCallback(() => {
    setSpoilerFree((prev) => !prev);
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="relative rounded-2xl border bg-background shadow-around">
        {/* Attached quotes chips */}
        {quotes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5" style={typography}>
            <TooltipProvider delayDuration={300}>
              {quotes.map((q) => (
                <Tooltip key={q.id}>
                  <TooltipTrigger asChild>
                    <span className="group inline-flex max-w-[200px] items-center gap-1 rounded-md border border-primary/20 bg-primary/5 px-2 py-0.5 text-xs text-primary">
                      <Quote className="size-3 shrink-0 opacity-60" />
                      <span className="truncate">{q.text}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemoveQuote?.(q.id);
                        }}
                        className="ml-0.5 shrink-0 rounded-full p-0.5 opacity-0 transition-opacity hover:bg-primary/10 group-hover:opacity-100"
                      >
                        <X className="size-2.5" />
                      </button>
                    </span>
                  </TooltipTrigger>
                  <TooltipContent
                    style={typography}
                    side="top"
                    className="max-w-xs whitespace-pre-wrap bg-popover text-popover-foreground border shadow-md"
                  >
                    <p className="text-xs leading-relaxed">
                      {q.text.length > 300 ? `${q.text.slice(0, 300)}...` : q.text}
                    </p>
                    {q.source && (
                      <p
                        className="mt-1 text-muted-foreground"
                        style={{ fontSize: "calc(var(--chat-font-size) * 0.714286)" }}
                      >
                        — {q.source}
                      </p>
                    )}
                  </TooltipContent>
                </Tooltip>
              ))}
            </TooltipProvider>
          </div>
        )}

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          placeholder={quotes.length > 0 ? t("chat.askAboutQuote") : resolvedPlaceholder}
          disabled={disabled}
          rows={1}
          className="w-full resize-none bg-transparent px-4 pb-1 pt-3 text-sm leading-relaxed placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          style={{ ...typography, minHeight: 36, maxHeight: 160 }}
        />
        <div className="flex items-center justify-between px-3 pb-2">
          <div className="flex items-center gap-1">
            {showDeepThinking && (
              <button
                type="button"
                onClick={toggleDeepThinking}
                className={`flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors ${
                  deepThinking
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Brain className="size-3" />
                <span>{t("chat.deepThinking")}</span>
              </button>
            )}
            {showDeepThinking && (
              <button
                type="button"
                onClick={toggleSpoilerFree}
                className={`flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors ${
                  spoilerFree
                    ? "border-primary/50 bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <EyeOff className="size-3" />
                <span>{t("chat.spoilerFree")}</span>
              </button>
            )}
          </div>
          {isStreaming ? (
            <button
              type="button"
              onClick={onStop}
              className="flex size-7 items-center justify-center rounded-full border border-destructive/20 bg-destructive text-destructive-foreground shadow-sm transition-colors hover:bg-destructive/90"
            >
              <Square className="size-3" />
            </button>
          ) : (
            <button
              type="button"
              disabled={disabled || (!value.trim() && quotes.length === 0)}
              onClick={() => handleSend()}
              className={`flex size-7 items-center justify-center rounded-full transition-colors ${
                value.trim() || quotes.length > 0
                  ? "border border-primary/20 bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
                  : "border border-border bg-background text-muted-foreground hover:bg-muted"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <Send className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      {deepThinking && (
        <p className="mt-1.5 text-center text-xs text-muted-foreground">
          {t("chat.deepThinkingHint")}
        </p>
      )}
      {spoilerFree && (
        <p className="mt-1.5 text-center text-xs text-muted-foreground">
          {t("chat.spoilerFreeHint")}
        </p>
      )}
    </div>
  );
}
