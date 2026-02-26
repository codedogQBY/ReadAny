import { Button } from "@/components/ui/button";
/**
 * VectorizeDialog — dialog for starting/monitoring vectorization
 */
import type { VectorizeProgress } from "@/types";
import { VectorProgress } from "./VectorProgress";

interface VectorizeDialogProps {
  bookTitle: string;
  progress: VectorizeProgress | null;
  onStart: () => void;
  onClose: () => void;
}

export function VectorizeDialog({ bookTitle, progress, onStart, onClose }: VectorizeDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-96 rounded-lg border border-border bg-background p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2 text-lg font-medium">Vectorize Book</h3>
        <p className="mb-4 text-sm text-muted-foreground">
          Index "{bookTitle}" for AI-powered search and analysis.
        </p>

        {progress ? (
          <div className="mb-4 space-y-3">
            <VectorProgress progress={progress} />
            <p className="text-center text-sm text-muted-foreground">
              {progress.status === "completed"
                ? "Vectorization complete!"
                : `${progress.status}... ${progress.processedChunks}/${progress.totalChunks} chunks`}
            </p>
          </div>
        ) : (
          <p className="mb-4 text-sm text-muted-foreground">
            This will split the book into chunks and generate embeddings for semantic search.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          {!progress && <Button onClick={onStart}>Start Vectorization</Button>}
        </div>
      </div>
    </div>
  );
}
