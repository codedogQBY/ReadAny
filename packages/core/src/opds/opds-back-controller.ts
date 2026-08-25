import type { OpdsViewAction, OpdsViewState } from "./opds-view-state";

interface OpdsBackDependencies {
  getState(): OpdsViewState;
  cancelRequest(): void;
  dispatch(action: OpdsViewAction): void;
  startBack(url: string): void;
  exit(): void;
}

export function createOpdsBackController(dependencies: OpdsBackDependencies) {
  const consumeInternalBack = (): boolean => {
    const { content } = dependencies.getState();
    if (
      content.status === "loading" &&
      content.previous &&
      (content.pending.mode === "push" || content.pending.mode === "back")
    ) {
      dependencies.cancelRequest();
      dependencies.dispatch({ type: "loadCancelled", requestId: content.requestId });
      return true;
    }
    if (
      content.status === "error" &&
      content.previous &&
      (content.failedRequest.mode === "push" || content.failedRequest.mode === "back")
    ) {
      dependencies.dispatch({ type: "loadCancelled", requestId: content.failedRequestId });
      return true;
    }
    const snapshot =
      content.status === "ready"
        ? content
        : content.status === "loading" || content.status === "error"
          ? content.previous
          : undefined;
    const target = snapshot?.history[snapshot.history.length - 1];
    if (!target) return false;
    dependencies.cancelRequest();
    dependencies.startBack(target);
    return true;
  };

  return {
    handleHeaderBack(): void {
      if (!consumeInternalBack()) dependencies.exit();
    },
    handleBeforeRemove(event: { preventDefault(): void }): void {
      if (!consumeInternalBack()) return;
      event.preventDefault();
    },
  };
}
