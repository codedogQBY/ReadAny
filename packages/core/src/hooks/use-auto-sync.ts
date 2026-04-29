/**
 * Shared auto-sync hook — load config, trigger on startup (delayed), and periodically.
 * Used by both desktop (Tauri) and mobile (Expo) apps.
 *
 * @param onSyncComplete Optional callback when a download sync completes (e.g., to reload the library)
 */
import { useEffect, useRef } from "react";
import { useSyncStore } from "../stores/sync-store";

function hasAutoSync(config: unknown): config is { autoSync: boolean; syncIntervalMins?: number } {
  return typeof config === "object" && config !== null && "autoSync" in config;
}

function withJitter(baseMs: number, maxJitterMs: number): number {
  const jitter = Math.floor(Math.random() * maxJitterMs);
  return baseMs + jitter;
}

export function useAutoSync(onSyncComplete?: () => void) {
  const config = useSyncStore((s) => s.config);
  const isConfigured = useSyncStore((s) => s.isConfigured);
  const syncNow = useSyncStore((s) => s.syncNow);
  const loadConfig = useSyncStore((s) => s.loadConfig);
  const status = useSyncStore((s) => s.status);
  const lastResult = useSyncStore((s) => s.lastResult);
  const error = useSyncStore((s) => s.error);
  const statusRef = useRef(status);
  statusRef.current = status;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastErrorRef = useRef<string | null>(null);
  lastErrorRef.current = error;

  // Load config on mount
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // Refresh library after a successful download sync
  useEffect(() => {
    if (
      lastResult?.success &&
      (lastResult.direction === "download" || lastResult.filesDownloaded > 0)
    ) {
      onSyncComplete?.();
    }
  }, [lastResult, onSyncComplete]);

  // Delayed startup sync + periodic sync
  useEffect(() => {
    const autoSyncEnabled = hasAutoSync(config) && config.autoSync;

    if (!isConfigured || !autoSyncEnabled) {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      return;
    }

    // Don't auto-sync if last error was auth-related
    if (
      lastErrorRef.current?.includes("connect") ||
      lastErrorRef.current?.includes("Unauthorized")
    ) {
      console.log("[AutoSync] Skipping auto-sync due to connection/auth error");
      return;
    }

    const intervalMs = (hasAutoSync(config) ? config.syncIntervalMins || 30 : 30) * 60 * 1000;
    let cancelled = false;

    const scheduleNext = (delayMs: number) => {
      timerRef.current = setTimeout(async () => {
        if (cancelled) return;

        if (statusRef.current === "idle" && !lastErrorRef.current) {
          await syncNow();
        }

        if (!cancelled) {
          scheduleNext(withJitter(intervalMs, Math.min(60_000, Math.floor(intervalMs * 0.1))));
        }
      }, delayMs);
    };

    scheduleNext(withJitter(10_000, 10_000));

    return () => {
      cancelled = true;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [isConfigured, config, syncNow]);
}
