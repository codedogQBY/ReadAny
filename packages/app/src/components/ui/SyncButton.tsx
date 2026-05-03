import { useSyncStore } from "@/stores/sync-store";
import { cn } from "@readany/core/utils";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect } from "react";

interface SyncButtonProps {
  className?: string;
  iconSize?: number;
}

export function SyncButton({ className, iconSize = 14 }: SyncButtonProps) {
  const syncNow = useSyncStore((s) => s.syncNow);
  const status = useSyncStore((s) => s.status);
  const backendType = useSyncStore((s) => s.backendType);
  const loadConfig = useSyncStore((s) => s.loadConfig);

  const isBusy = status !== "idle" && status !== "error";

  useEffect(() => {
    if (!backendType) {
      void loadConfig();
    }
  }, [backendType, loadConfig]);

  const handleClick = useCallback(() => {
    if (isBusy) return;
    void syncNow();
  }, [isBusy, syncNow]);

  if (!backendType) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isBusy}
      className={cn(
        "inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50",
        className,
      )}
      title="Sync"
    >
      <RefreshCw className={cn("shrink-0", isBusy && "animate-spin")} style={{ width: iconSize, height: iconSize }} />
    </button>
  );
}
