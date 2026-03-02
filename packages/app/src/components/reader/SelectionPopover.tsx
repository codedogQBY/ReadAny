/**
 * SelectionPopover — popover on text selection with highlight colors
 */
import { useState } from "react";
import { Check, Copy, Highlighter, Languages, Sparkles, StickyNote, Trash2, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { HighlightColor } from "@/types";
import { HIGHLIGHT_COLORS, HIGHLIGHT_COLOR_HEX } from "@/types";

interface SelectionPopoverProps {
  position: { x: number; y: number };
  selectedText: string;
  annotated?: boolean; // true if this is an existing annotation
  currentColor?: HighlightColor; // current highlight color (for existing annotations)
  isPdf?: boolean; // true if viewing a PDF (highlight disabled)
  onHighlight: (color: HighlightColor) => void;
  onRemoveHighlight: () => void;
  onNote: () => void;
  onCopy: () => void;
  onTranslate: () => void;
  onAskAI: () => void;
  onSpeak: () => void;
  onClose: () => void;
}

export function SelectionPopover({
  position,
  selectedText: _selectedText,
  annotated = false,
  currentColor,
  isPdf = false,
  onHighlight,
  onRemoveHighlight,
  onNote,
  onCopy,
  onTranslate,
  onAskAI,
  onSpeak,
  onClose: _onClose,
}: SelectionPopoverProps) {
  const { t } = useTranslation();
  const [showColors, setShowColors] = useState(annotated); // Show colors immediately for existing annotations
  const [selectedColor, setSelectedColor] = useState<HighlightColor>(currentColor || "yellow");

  const handleHighlightClick = () => {
    // PDF doesn't support highlighting
    if (isPdf) return;
    
    if (annotated) {
      // For existing annotation, toggle color picker
      setShowColors(!showColors);
    } else if (showColors) {
      // If colors are already shown, apply highlight with selected color
      onHighlight(selectedColor);
    } else {
      // Show color picker
      setShowColors(true);
    }
  };

  const handleColorSelect = (color: HighlightColor) => {
    setSelectedColor(color);
    onHighlight(color);
  };

  const buttons = [
    { 
      icon: Highlighter, 
      label: isPdf ? t("reader.highlightNotSupportedPdf") : t("reader.highlight"), 
      onClick: handleHighlightClick, 
      isHighlight: true,
      disabled: isPdf,
    },
    { icon: StickyNote, label: t("reader.note"), onClick: onNote, disabled: isPdf },
    { icon: Copy, label: t("common.copy"), onClick: onCopy },
    { icon: Languages, label: t("reader.translate"), onClick: onTranslate },
    { icon: Sparkles, label: t("reader.askAI"), onClick: onAskAI },
    { icon: Volume2, label: t("tts.speakSelection"), onClick: onSpeak },
  ];

  // For existing annotations, add delete button
  if (annotated) {
    buttons.push({ icon: Trash2, label: t("common.delete"), onClick: onRemoveHighlight, isHighlight: false, disabled: false });
  }

  return (
    <div
      className="absolute z-50 flex flex-col items-center gap-1"
      style={{ left: position.x, top: position.y }}
    >
      {/* Color picker row */}
      {showColors && !isPdf && (
        <div className="flex items-center gap-1 rounded-lg border border-border bg-background p-1.5 shadow-lg">
          {HIGHLIGHT_COLORS.map((color) => (
            <button
              key={color}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full transition-transform hover:scale-110",
              )}
              style={{ backgroundColor: HIGHLIGHT_COLOR_HEX[color] }}
              title={t(`reader.color.${color}`)}
              onClick={() => handleColorSelect(color)}
            >
              {selectedColor === color && (
                <Check className="h-3.5 w-3.5 text-white drop-shadow-md" />
              )}
            </button>
          ))}
        </div>
      )}
      
      {/* Main action buttons */}
      <div className="flex items-center gap-0.5 rounded-lg border border-border bg-background p-1 shadow-lg">
        {buttons.map((btn) => (
          <button
            key={btn.label}
            className={cn(
              "flex h-8 w-8 items-center justify-center rounded-md transition-colors",
              btn.disabled 
                ? "cursor-not-allowed opacity-40" 
                : "hover:bg-muted",
              btn.isHighlight && showColors && !isPdf && "bg-muted",
              btn.icon === Trash2 && !btn.disabled && "hover:bg-destructive/10 hover:text-destructive",
            )}
            title={btn.label}
            onClick={btn.disabled ? undefined : btn.onClick}
            disabled={btn.disabled}
          >
            <btn.icon className="h-4 w-4" />
          </button>
        ))}
      </div>
    </div>
  );
}
