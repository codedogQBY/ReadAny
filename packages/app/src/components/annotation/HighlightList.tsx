/**
 * HighlightList — list of highlights for the current book
 */
import { useAnnotationStore } from "@/stores/annotation-store";
import type { HighlightColor } from "@/types";
import { Highlighter } from "lucide-react";
import { useTranslation } from "react-i18next";

const COLOR_CLASSES: Record<HighlightColor, string> = {
  red: "bg-highlight-red",
  yellow: "bg-highlight-yellow",
  green: "bg-highlight-green",
  blue: "bg-highlight-blue",
  pink: "bg-highlight-pink",
  purple: "bg-highlight-purple",
  violet: "bg-highlight-violet",
};

export function HighlightList() {
  const { t } = useTranslation();
  const highlights = useAnnotationStore((s) => s.highlights);

  if (highlights.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-4 text-center text-sm text-muted-foreground">
        <Highlighter className="mb-2 h-8 w-8" />
        <p>{t("highlights.noHighlights")}</p>
        <p className="text-xs">{t("highlights.selectToHighlight")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1 overflow-y-auto p-2">
      {highlights.map((h) => (
        <div
          key={h.id}
          className="cursor-pointer rounded-md p-2.5 transition-colors hover:bg-muted"
        >
          <div className="flex items-start gap-2">
            <div className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${COLOR_CLASSES[h.color]}`} />
            <div className="min-w-0">
              <p className="line-clamp-3 text-sm">{h.text}</p>
              {h.note && <p className="mt-1 text-xs text-muted-foreground">{h.note}</p>}
              {h.chapterTitle && (
                <p className="mt-1 text-xs text-muted-foreground/70">{h.chapterTitle}</p>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
