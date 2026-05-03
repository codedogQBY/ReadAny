import { resolveFileSrc } from "@/stores/library-store";
import { eventBus } from "@readany/core/utils/event-bus";
import { useEffect, useState } from "react";

let globalSyncVersion = 0;

export function useSyncVersion(): number {
  const [version, setVersion] = useState(globalSyncVersion);
  useEffect(() => {
    return eventBus.on("sync:completed", () => {
      globalSyncVersion++;
      setVersion(globalSyncVersion);
    });
  }, []);
  return version;
}

export function useResolvedSrc(path: string | undefined): string {
  const [resolved, setResolved] = useState("");

  useEffect(() => {
    if (!path) {
      setResolved("");
      return;
    }

    if (path.startsWith("asset://") || path.startsWith("http")) {
      setResolved(path);
      return;
    }

    resolveFileSrc(path)
      .then(setResolved)
      .catch((err) => {
        console.warn("[useResolvedSrc] Failed to resolve path:", path, err);
        setResolved("");
      });
  }, [path]);

  return resolved;
}
