/**
 * ChatInput — sageread-style rounded card input with deep thinking option
 */
import { Button } from "@/components/ui/button";
import { ArrowUp, Brain, Paperclip } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

interface ChatInputProps {
  onSend: (content: string, deepThinking?: boolean) => void;
  disabled?: boolean;
  placeholder?: string;
  showDeepThinking?: boolean;
}

export function ChatInput({ onSend, disabled, placeholder, showDeepThinking = true }: ChatInputProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState("");
  const [deepThinking, setDeepThinking] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const resolvedPlaceholder = placeholder || t("chat.askPlaceholder");

  const handleSend = useCallback(
    (useDeepThinking: boolean = deepThinking) => {
      const trimmed = value.trim();
      if (trimmed) {
        onSend(trimmed, useDeepThinking);
        setValue("");
        setDeepThinking(false);
        if (textareaRef.current) textareaRef.current.style.height = "auto";
      }
    },
    [value, deepThinking, onSend],
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
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            handleInput();
          }}
          onKeyDown={handleKeyDown}
          placeholder={resolvedPlaceholder}
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
            disabled={disabled || !value.trim()}
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
