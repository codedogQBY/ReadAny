/**
 * ChatInput — message input with Enter to send, Shift+Enter for newline
 */
import { useState, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Send } from "lucide-react";

interface ChatInputProps {
  onSend: (content: string) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [value, setValue] = useState("");

  const handleSend = useCallback(() => {
    const trimmed = value.trim();
    if (trimmed) {
      onSend(trimmed);
      setValue("");
    }
  }, [value, onSend]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  return (
    <div className="flex items-end gap-2 p-3">
      <Textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask about the book..."
        className="min-h-[36px] flex-1 resize-none"
        rows={1}
        disabled={disabled}
      />
      <Button size="icon" className="h-9 w-9 shrink-0" onClick={handleSend} disabled={disabled || !value.trim()}>
        <Send className="h-4 w-4" />
      </Button>
    </div>
  );
}
