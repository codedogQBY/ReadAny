/**
 * ChatInput — sageread-style rounded card input with deep thinking option
 * Supports attached context quotes that display as chips above the textarea.
 */
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ArrowUp, Brain, Paperclip, Quote, X } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

/** A piece of selected text attached as context to the chat input */
export interface AttachedQuote {
  id: string;
  text: string;
  /** Optional source info, e.g. chapter title */
  source?: string;
}

interface ChatInputProps {
  onSend: (content: string, deepThinking?: boolean, quotes?: AttachedQuote[]) => void;
  disabled?: boolean;
  placeholder?: string;
  showDeepThinking?: boolean;
  /** Externally controlled attached quotes */
  quotes?: AttachedQuote[];
  /** Callback when a quote is removed */
  onRemoveQuote?: (id: string) => void;
}

export function ChatInput({
  onSend,
  disabled,
  placeholder,
  showDeepThinking = true,
  quotes = [],
  onRemoveQuote,
}: ChatInputProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [deepThinking, setDeepThinking] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resolvedPlaceholder = placeholder || t("chat.askPlaceholder");

  const handleSend = useCallback(
    (useDeepThinking: boolean = deepThinking) => {
      const trimmed = value.trim();
      // Allow sending if there's text OR if there are quotes attached
      if (trimmed || quotes.length > 0) {
        onSend(trimmed, useDeepThinking, quotes.length > 0 ? quotes : undefined);
        setValue("");
        setDeepThinking(false);
        if (textareaRef.current) textareaRef.current.style.height = "auto";
      }
    },
    [value, deepThinking, onSend, quotes],
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

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div className="relative rounded-2xl border bg-background shadow-around">
        {/* Attached quotes chips */}
        {quotes.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-2.5">
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
                    side="top"
                    className="max-w-xs whitespace-pre-wrap bg-popover text-popover-foreground border shadow-md"
                  >
                    <p className="text-xs leading-relaxed">
                      {q.text.length > 300 ? `${q.text.slice(0, 300)}...` : q.text}
                    </p>
                    {q.source && (
                      <p className="mt-1 text-[10px] text-muted-foreground">— {q.source}</p>
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
          style={{ minHeight: 36, maxHeight: 160 }}
        />
        <div className="flex items-center justify-between px-3 pb-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded-full border p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Paperclip className="size-3.5" />
            </button>
            {showDeepThinking && (
              <button
                type="button"
                onClick={toggleDeepThinking}
                className={`flex items-center gap-1 rounded-full border px-2 py-1 text-xs transition-colors ${
                  deepThinking
                    ? "border-violet-300 bg-violet-50 text-violet-600"
                    : "border-neutral-200 text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Brain className="size-3" />
                <span>{t("chat.deepThinking")}</span>
              </button>
            )}
          </div>
          <Button
            size="icon"
            disabled={disabled || (!value.trim() && quotes.length === 0)}
            onClick={() => handleSend()}
            className="size-7 rounded-full"
          >
            <ArrowUp className="size-3.5" />
          </Button>
        </div>
      </div>
      {deepThinking && (
        <p className="mt-1.5 text-center text-xs text-muted-foreground">
          {t("chat.deepThinkingHint")}
        </p>
      )}
    </div>
  );
}
