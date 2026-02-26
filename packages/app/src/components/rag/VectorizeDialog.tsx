import { Button } from "@/components/ui/button";
/**
 * VectorizeDialog — dialog for starting/monitoring vectorization
 */
import type { VectorizeProgress } from "@/types";
import { useTranslation } from "react-i18next";
import { VectorProgress } from "./VectorProgress";

interface VectorizeDialogProps {
  bookTitle: string;
  progress: VectorizeProgress | null;
  onStart: () => void;
  onClose: () => void;
}

export function VectorizeDialog({ bookTitle, progress, onStart, onClose }: VectorizeDialogProps) {
  const { t } = useTranslation();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-96 rounded-lg border border-border bg-background p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 text-lg font-medium">{t("vectorize.vectorizeBook")}</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          {t("vectorize.indexBook", { title: bookTitle })}
        </p>

        {progress ? (
          <div className="mb-4 space-y-3">
            <VectorProgress progress={progress} />
            <p className="text-center text-sm text-muted-foreground">
              {progress.status === "completed"
                ? t("vectorize.complete")
                : t("vectorize.progress", { status: progress.status, processed: progress.processedChunks, total: progress.totalChunks })}
            </p>
          </div>
        ) : (
          <p className="mb-4 text-sm text-muted-foreground">
            {t("vectorize.description")}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
          {!progress && <Button onClick={onStart}>{t("vectorize.start")}</Button>}
        </div>
      </div>
    </div>
  );
}
