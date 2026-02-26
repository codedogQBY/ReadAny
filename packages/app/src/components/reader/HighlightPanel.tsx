/**
 * HighlightPanel — color picker for highlights
 */
import type { HighlightColor } from "@/types";
import { useTranslation } from "react-i18next";

interface HighlightPanelProps {
  selectedColor: HighlightColor;
  onColorChange: (color: HighlightColor) => void;
  onDelete?: () => void;
}

const COLORS: Array<{ value: HighlightColor; labelKey: string; className: string }> = [
  { value: "yellow", labelKey: "highlights.yellow", className: "bg-highlight-yellow" },
  { value: "green", labelKey: "highlights.green", className: "bg-highlight-green" },
  { value: "blue", labelKey: "highlights.blue", className: "bg-highlight-blue" },
  { value: "pink", labelKey: "highlights.pink", className: "bg-highlight-pink" },
  { value: "purple", labelKey: "highlights.purple", className: "bg-highlight-purple" },
];

export function HighlightPanel({ selectedColor, onColorChange, onDelete }: HighlightPanelProps) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-background p-2 shadow-lg">
      {COLORS.map((color) => (
        <button
          key={color.value}
          className={`h-6 w-6 rounded-full ${color.className} ring-offset-2 transition-all ${selectedColor === color.value ? "ring-2 ring-primary" : ""}`}
          title={t(color.labelKey)}
          onClick={() => onColorChange(color.value)}
        />
      ))}
      {onDelete && (
        <button className="ml-2 text-xs text-destructive hover:underline" onClick={onDelete}>
          {t("common.remove")}
        </button>
      )}
    </div>
  );
}
