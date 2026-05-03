/**
 * Desktop auto-sync hook — thin wrapper around the shared core hook.
 * Passes loadBooks as the onSyncComplete callback.
 */
import { useLibraryStore, repairMissingCovers } from "@/stores/library-store";
import { useAutoSync as useAutoSyncCore } from "@readany/core/hooks/use-auto-sync";
import { useCallback } from "react";

export function useAutoSync() {
  const loadBooks = useLibraryStore((s) => s.loadBooks);

  const onSyncComplete = useCallback(async () => {
    await loadBooks();
    repairMissingCovers().then((n) => {
      if (n > 0) loadBooks();
    }).catch(() => {});
  }, [loadBooks]);

  useAutoSyncCore(onSyncComplete);
}
