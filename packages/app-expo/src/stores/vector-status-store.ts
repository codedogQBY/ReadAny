/**
 * Vector Status Store — progress of unfinished vectorizations.
 *
 * A book that was interrupted (app closed, error, killed in the background) keeps the
 * embeddings it already computed in a local checkpoint; this store mirrors that so the
 * library can show "63% indexed" and offer to continue. Books without a checkpoint are
 * either fully indexed (`book.isVectorized`) or not started.
 */
import { listVectorCheckpoints } from "@readany/core/db/database";
import { create } from "zustand";

export interface VectorCheckpointState {
  doneChunks: number;
  totalChunks: number;
}

interface VectorStatusState {
  checkpoints: Record<string, VectorCheckpointState>;
  /** Set a book's checkpoint, or clear it with `null`. */
  setCheckpoint: (bookId: string, state: VectorCheckpointState | null) => void;
  /** Reload every book's checkpoint from the local database. */
  refresh: () => Promise<void>;
}

/** Whole-number percent for display; an unfinished book never reads as 100%. */
export function checkpointPercent(state: VectorCheckpointState | undefined | null): number {
  if (!state || state.totalChunks <= 0) return 0;
  return Math.max(0, Math.min(99, Math.floor((state.doneChunks / state.totalChunks) * 100)));
}

export const useVectorStatusStore = create<VectorStatusState>()((set) => ({
  checkpoints: {},

  setCheckpoint: (bookId, state) =>
    set((current) => {
      const next = { ...current.checkpoints };
      if (state) next[bookId] = state;
      else delete next[bookId];
      return { checkpoints: next };
    }),

  refresh: async () => {
    try {
      const rows = await listVectorCheckpoints();
      const checkpoints: Record<string, VectorCheckpointState> = {};
      for (const row of rows) {
        if (row.doneChunks > 0) {
          checkpoints[row.bookId] = { doneChunks: row.doneChunks, totalChunks: row.totalChunks };
        }
      }
      set({ checkpoints });
    } catch (err) {
      console.warn("[VectorStatus] Could not load vectorization checkpoints:", err);
    }
  },
}));
