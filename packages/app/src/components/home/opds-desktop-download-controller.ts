import { OpdsError } from "@readany/core";

interface DesktopDownloadControllerOptions<TCredentials> {
  prepare(signal: AbortSignal): Promise<TCredentials>;
}

interface DesktopDownloadOwnership {
  signal: AbortSignal;
  markImportStarted(): void;
}

export function createOpdsDesktopDownloadController<TCredentials>({
  prepare,
}: DesktopDownloadControllerOptions<TCredentials>) {
  let sequence = 0;
  let disposed = false;
  let active: { id: number; controller: AbortController; importStarted: boolean } | undefined;

  const isCurrent = (id: number, controller: AbortController) =>
    active?.id === id && sequence === id && !controller.signal.aborted;

  const cancel = (): boolean => {
    if (!active || active.importStarted) return false;
    sequence += 1;
    active.controller.abort();
    active = undefined;
    return true;
  };

  return {
    async run<TResult>(
      operation: (
        credentials: TCredentials,
        ownership: DesktopDownloadOwnership,
      ) => Promise<TResult>,
    ): Promise<TResult | undefined> {
      if (disposed) return undefined;
      if (active) throw new OpdsError("download-in-progress");
      const id = ++sequence;
      const controller = new AbortController();
      active = { id, controller, importStarted: false };
      try {
        const credentials = await prepare(controller.signal);
        if (!isCurrent(id, controller) || disposed) return undefined;
        const result = await operation(credentials, {
          signal: controller.signal,
          markImportStarted() {
            if (!isCurrent(id, controller)) throw new OpdsError("cancelled");
            if (active?.id === id) active.importStarted = true;
          },
        });
        return isCurrent(id, controller) && !disposed ? result : undefined;
      } catch (error) {
        if (!isCurrent(id, controller) || disposed) return undefined;
        throw error;
      } finally {
        if (active?.id === id) active = undefined;
      }
    },
    cancel,
    dispose(): boolean {
      disposed = true;
      return cancel();
    },
    isActive(): boolean {
      return active !== undefined;
    },
  };
}
