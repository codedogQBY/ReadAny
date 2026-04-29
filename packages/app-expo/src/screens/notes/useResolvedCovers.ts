/**
 * useResolvedCovers — resolves relative book cover paths to absolute platform paths.
 * Shared between NotesView and StatsScreen.
 */
import { getPlatformService } from "@readany/core/services";
import { useEffect, useState } from "react";

const EMPTY_ITEMS: readonly [] = [];

export function useResolvedCovers<
  T extends { bookId?: string; id?: string; coverUrl?: string | null },
>(items?: T[]): Map<string, string> {
  const [resolvedCovers, setResolvedCovers] = useState<Map<string, string>>(new Map());
  const safeItems = items ?? EMPTY_ITEMS;

  useEffect(() => {
    if (safeItems.length === 0) {
      setResolvedCovers((prev) => (prev.size === 0 ? prev : new Map()));
      return;
    }
    const resolve = async () => {
      const newMap = new Map<string, string>();
      try {
        const platform = getPlatformService();
        const appData = await platform.getAppDataDir();
        for (const item of safeItems) {
          const key = item.bookId || item.id;
          if (!key || !item.coverUrl) continue;
          if (
            item.coverUrl.startsWith("http") ||
            item.coverUrl.startsWith("blob") ||
            item.coverUrl.startsWith("file")
          ) {
            newMap.set(key, item.coverUrl);
            continue;
          }
          try {
            const absPath = await platform.joinPath(appData, item.coverUrl);
            newMap.set(key, absPath);
          } catch {}
        }
        setResolvedCovers((prev) => {
          if (prev.size !== newMap.size) return newMap;
          for (const [key, value] of newMap) {
            if (prev.get(key) !== value) return newMap;
          }
          return prev;
        });
      } catch (err) {
        console.error("Failed to resolve cover URLs:", err);
      }
    };
    resolve();
  }, [safeItems]);

  return resolvedCovers;
}
