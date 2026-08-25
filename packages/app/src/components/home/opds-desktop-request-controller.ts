interface DesktopRequestControllerOptions<TCredentials> {
  prepare(signal: AbortSignal): Promise<TCredentials>;
}

export function createOpdsDesktopRequestController<TCredentials>({
  prepare,
}: DesktopRequestControllerOptions<TCredentials>) {
  let sequence = 0;
  let active: { id: number; controller: AbortController } | undefined;
  let disposed = false;

  const cancel = () => {
    sequence += 1;
    active?.controller.abort();
    active = undefined;
  };

  return {
    async run<TResult>(
      operation: (credentials: TCredentials, signal: AbortSignal) => Promise<TResult>,
    ): Promise<TResult | undefined> {
      if (disposed) return undefined;
      cancel();
      const id = ++sequence;
      const controller = new AbortController();
      active = { id, controller };
      const isCurrent = () =>
        !disposed && active?.id === id && !controller.signal.aborted && sequence === id;
      try {
        const credentials = await prepare(controller.signal);
        if (!isCurrent()) return undefined;
        const result = await operation(credentials, controller.signal);
        return isCurrent() ? result : undefined;
      } catch (error) {
        if (!isCurrent()) return undefined;
        throw error;
      } finally {
        if (active?.id === id) active = undefined;
      }
    },
    cancel,
    dispose(): void {
      disposed = true;
      cancel();
    },
    isActive(): boolean {
      return active !== undefined;
    },
  };
}
