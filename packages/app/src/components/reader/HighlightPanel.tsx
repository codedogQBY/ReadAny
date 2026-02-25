/**
 * HighlightPanel — color picker for highlights
 */
import type { HighlightColor } from "@/types";

interface HighlightPanelProps {
  selectedColor: HighlightColor;
  onColorChange: (color: HighlightColor) => void;
  onDelete?: () => void;
}

const COLORS: Array<{ value: HighlightColor; label: string; className: string }> = [
  { value: "yellow", label: "Yellow", className: "bg-highlight-yellow" },
  { value: "green", label: "Green", className: "bg-highlight-green" },
  { value: "blue", label: "Blue", className: "bg-highlight-blue" },
  { value: "pink", label: "Pink", className: "bg-highlight-pink" },
  { value: "purple", label: "Purple", className: "bg-highlight-purple" },
];

export function HighlightPanel({ selectedColor, onColorChange, onDelete }: HighlightPanelProps) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-background p-2 shadow-lg">
      {COLORS.map((color) => (
        <button
          key={color.value}
          className={`h-6 w-6 rounded-full ${color.className} ring-offset-2 transition-all ${
            selectedColor === color.value ? "ring-2 ring-primary" : ""
          }`}
          title={color.label}
          onClick={() => onColorChange(color.value)}
        />
      ))}
      {onDelete && (
        <button
          className="ml-2 text-xs text-destructive hover:underline"
          onClick={onDelete}
        >
          Remove
        </button>
      )}
    </div>
  );
}
