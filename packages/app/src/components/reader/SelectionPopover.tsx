/**
 * SelectionPopover — 5-button popover on text selection
 * Buttons: Highlight, Note, Copy, Translate, Ask AI
 */
import { Copy, Highlighter, Languages, Sparkles, StickyNote } from "lucide-react";

interface SelectionPopoverProps {
  position: { x: number; y: number };
  selectedText: string;
  onHighlight: () => void;
  onNote: () => void;
  onCopy: () => void;
  onTranslate: () => void;
  onAskAI: () => void;
  onClose: () => void;
}

export function SelectionPopover({
  position,
  selectedText: _selectedText,
  onHighlight,
  onNote,
  onCopy,
  onTranslate,
  onAskAI,
  onClose: _onClose,
}: SelectionPopoverProps) {
  const buttons = [
    { icon: Highlighter, label: "Highlight", onClick: onHighlight },
    { icon: StickyNote, label: "Note", onClick: onNote },
    { icon: Copy, label: "Copy", onClick: onCopy },
    { icon: Languages, label: "Translate", onClick: onTranslate },
    { icon: Sparkles, label: "Ask AI", onClick: onAskAI },
  ];

  return (
    <div
      className="absolute z-50 flex items-center gap-0.5 rounded-lg border border-border bg-background p-1 shadow-lg"
      style={{ left: position.x, top: position.y }}
    >
      {buttons.map((btn) => (
        <button
          key={btn.label}
          className="flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-muted"
          title={btn.label}
          onClick={btn.onClick}
        >
          <btn.icon className="h-4 w-4" />
        </button>
      ))}
    </div>
  );
}
