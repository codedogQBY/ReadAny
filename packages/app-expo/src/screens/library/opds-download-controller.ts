import { OpdsError, type OpdsErrorCode } from "@readany/core";
import type { OpdsDownloadState, OpdsViewAction } from "./opds-view-state";

type DownloadEvent = Extract<OpdsViewAction, { type: `download${string}` }>;
type DownloadPhase = "idle" | "preparing" | "downloading" | "importing";

interface DownloadResult {
  readonly importedCount: number;
}

interface DownloadControllerOptions {
  onEvent(event: DownloadEvent): void;
}

interface DownloadStart<TCredentials> {
  readonly publicationTitle: string;
  prepare(signal: AbortSignal): Promise<TCredentials>;
  execute(options: {
    credentials: TCredentials;
    signal: AbortSignal;
    onProgress(loaded: number, total: number): void;
    onImportStart(): void;
  }): Promise<DownloadResult>;
}

function errorCode(error: unknown): OpdsErrorCode {
  return error instanceof OpdsError ? error.code : "download-failed";
}

export function createOpdsDownloadController<TCredentials>({ onEvent }: DownloadControllerOptions) {
  let sequence = 0;
  let active:
    | { requestId: number; controller: AbortController; phase: Exclude<DownloadPhase, "idle"> }
    | undefined;

  const isCurrent = (requestId: number) =>
    active?.requestId === requestId && !active.controller.signal.aborted;

  return {
    async start(operation: DownloadStart<TCredentials>): Promise<DownloadResult | undefined> {
      if (active) throw new OpdsError("download-in-progress");
      const requestId = ++sequence;
      const controller = new AbortController();
      active = { requestId, controller, phase: "preparing" };
      onEvent({ type: "downloadStarted", requestId, publicationTitle: operation.publicationTitle });

      try {
        const credentials = await operation.prepare(controller.signal);
        if (!isCurrent(requestId)) return undefined;
        active.phase = "downloading";
        const result = await operation.execute({
          credentials,
          signal: controller.signal,
          onProgress: (loaded, total) => {
            if (!isCurrent(requestId) || active?.phase !== "downloading") return;
            onEvent({ type: "downloadProgress", requestId, loaded, total });
          },
          onImportStart: () => {
            if (!isCurrent(requestId) || active?.phase !== "downloading") {
              throw new OpdsError("cancelled");
            }
            active.phase = "importing";
            onEvent({ type: "downloadImporting", requestId });
          },
        });
        if (!isCurrent(requestId)) return undefined;
        onEvent({ type: "downloadSucceeded", requestId, importedCount: result.importedCount });
        return result;
      } catch (error) {
        if (!isCurrent(requestId)) return undefined;
        onEvent({ type: "downloadFailed", requestId, error: errorCode(error) });
        throw error;
      } finally {
        if (active?.requestId === requestId) active = undefined;
      }
    },
    cancel(): boolean {
      if (!active || active.phase === "importing") return false;
      const { requestId, controller } = active;
      active = undefined;
      controller.abort();
      onEvent({ type: "downloadCancelled", requestId });
      return true;
    },
    getPhase(): DownloadPhase {
      return active?.phase ?? "idle";
    },
  };
}

export function getOpdsDownloadAccessibility(state: OpdsDownloadState): {
  role?: "progressbar" | "status" | "alert";
  value?: { min?: number; max?: number; now?: number; text?: string };
  liveRegion?: "polite" | "assertive";
} {
  if (state.status === "downloading") {
    return state.total > 0
      ? {
          role: "progressbar",
          value: { min: 0, max: state.total, now: Math.min(state.loaded, state.total) },
          liveRegion: "polite",
        }
      : { role: "progressbar", value: { text: "downloading" }, liveRegion: "polite" };
  }
  if (state.status === "importing") {
    return { role: "progressbar", value: { text: "importing" }, liveRegion: "polite" };
  }
  if (state.status === "success") return { role: "status", liveRegion: "polite" };
  if (state.status === "error") return { role: "alert", liveRegion: "assertive" };
  return {};
}
