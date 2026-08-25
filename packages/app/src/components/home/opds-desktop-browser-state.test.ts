import {
  type OpdsFeed,
  type OpdsViewState,
  createInitialOpdsViewState,
  createOpdsBackController,
  opdsViewReducer,
} from "@readany/core";
import { describe, expect, it, vi } from "vitest";

const feed = (title: string): OpdsFeed => ({
  title,
  navigation: [],
  publications: [],
  groups: [],
  facets: [],
});

function ready(url = "root", title = "Root"): OpdsViewState {
  const loading = opdsViewReducer(createInitialOpdsViewState(), {
    type: "loadStarted",
    requestId: 1,
    url,
    mode: "replace",
  });
  return opdsViewReducer(loading, { type: "loadSucceeded", requestId: 1, feed: feed(title) });
}

function push(state: OpdsViewState, requestId: number, url: string, title?: string) {
  const loading = opdsViewReducer(state, { type: "loadStarted", requestId, url, mode: "push" });
  return title
    ? opdsViewReducer(loading, { type: "loadSucceeded", requestId, feed: feed(title) })
    : loading;
}

function setup(initial: OpdsViewState) {
  let state = initial;
  const cancelRequest = vi.fn();
  const startBack = vi.fn();
  const exit = vi.fn();
  const controller = createOpdsBackController({
    getState: () => state,
    cancelRequest,
    dispatch: (action) => {
      state = opdsViewReducer(state, action);
    },
    startBack,
    exit,
  });
  return { controller, cancelRequest, startBack, exit, getState: () => state };
}

describe("desktop OPDS browser state", () => {
  it.each([
    ["root", ready()],
    ["non-root", push(ready(), 2, "child", "Child")],
  ])("dismisses a failed push at %s without consuming history", (_label, previous) => {
    const pushing = push(previous, 3, "failed-target");
    const failed = opdsViewReducer(pushing, {
      type: "loadFailed",
      requestId: 3,
      error: "unreachable",
    });
    const harness = setup(failed);

    harness.controller.handleHeaderBack();

    expect(harness.getState().content).toMatchObject({
      status: "ready",
      currentUrl: previous.content.status === "ready" ? previous.content.currentUrl : undefined,
    });
    expect(harness.startBack).not.toHaveBeenCalled();
    expect(harness.exit).not.toHaveBeenCalled();
  });

  it("keeps refresh failure distinct and follows existing history on Back", () => {
    const child = push(ready(), 2, "child", "Child");
    const refreshing = opdsViewReducer(child, {
      type: "loadStarted",
      requestId: 3,
      url: "child",
      mode: "refresh",
    });
    const failed = opdsViewReducer(refreshing, {
      type: "loadFailed",
      requestId: 3,
      error: "unreachable",
    });
    const harness = setup(failed);

    harness.controller.handleHeaderBack();

    expect(harness.startBack).toHaveBeenCalledWith("root");
  });

  it("cancels an in-flight push and restores the retained feed", () => {
    const pushing = push(ready(), 2, "child");
    const harness = setup(pushing);

    harness.controller.handleHeaderBack();

    expect(harness.cancelRequest).toHaveBeenCalledOnce();
    expect(harness.getState().content).toMatchObject({ status: "ready", currentUrl: "root" });
  });

  it("retains a failed push target so retry can complete the requested child", () => {
    const previous = push(ready(), 2, "child", "Child");
    const pushing = push(previous, 3, "grandchild");
    const failed = opdsViewReducer(pushing, {
      type: "loadFailed",
      requestId: 3,
      error: "unreachable",
    });

    const retrying = opdsViewReducer(failed, { type: "retryStarted", requestId: 4 });
    expect(retrying.content).toMatchObject({
      status: "loading",
      pending: { mode: "push", url: "grandchild" },
      previous: { currentUrl: "child", history: ["root"] },
    });

    const completed = opdsViewReducer(retrying, {
      type: "loadSucceeded",
      requestId: 4,
      feed: feed("Grandchild"),
    });
    expect(completed.content).toMatchObject({
      status: "ready",
      currentUrl: "grandchild",
      history: ["root", "child"],
    });
  });
});
