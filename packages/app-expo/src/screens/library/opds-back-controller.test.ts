import type { OpdsFeed } from "@readany/core";
import { describe, expect, it, vi } from "vitest";
import { createOpdsBackController } from "./opds-back-controller";
import { type OpdsViewState, createInitialOpdsViewState, opdsViewReducer } from "./opds-view-state";

const feed = (title: string): OpdsFeed => ({
  title,
  navigation: [],
  publications: [],
  groups: [],
  facets: [],
});

function readyWithHistory(): OpdsViewState {
  let state = opdsViewReducer(createInitialOpdsViewState(), {
    type: "loadStarted",
    requestId: 1,
    url: "root",
    mode: "replace",
  });
  state = opdsViewReducer(state, { type: "loadSucceeded", requestId: 1, feed: feed("Root") });
  state = opdsViewReducer(state, {
    type: "loadStarted",
    requestId: 2,
    url: "child",
    mode: "push",
  });
  return opdsViewReducer(state, {
    type: "loadSucceeded",
    requestId: 2,
    feed: feed("Child"),
  });
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

describe("OPDS native back controller", () => {
  it("uses internal history for the header back action", () => {
    const { controller, startBack, exit } = setup(readyWithHistory());

    controller.handleHeaderBack();

    expect(startBack).toHaveBeenCalledWith("root");
    expect(exit).not.toHaveBeenCalled();
  });

  it("prevents a native route pop and uses the same internal history", () => {
    const { controller, startBack } = setup(readyWithHistory());
    const event = { preventDefault: vi.fn() };

    controller.handleBeforeRemove(event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(startBack).toHaveBeenCalledWith("root");
  });

  it("cancels an in-flight push and restores the previous ready feed", () => {
    const child = readyWithHistory();
    const pushing = opdsViewReducer(child, {
      type: "loadStarted",
      requestId: 3,
      url: "grandchild",
      mode: "push",
    });
    const { controller, cancelRequest, getState } = setup(pushing);

    controller.handleBeforeRemove({ preventDefault: vi.fn() });

    expect(cancelRequest).toHaveBeenCalledOnce();
    expect(getState().content).toMatchObject({ status: "ready", currentUrl: "child" });
  });

  it("restores the previous feed when native back follows a failed push", () => {
    const child = readyWithHistory();
    const pushing = opdsViewReducer(child, {
      type: "loadStarted",
      requestId: 3,
      url: "grandchild",
      mode: "push",
    });
    const failed = opdsViewReducer(pushing, {
      type: "loadFailed",
      requestId: 3,
      error: "unreachable",
    });
    const { controller, getState, exit } = setup(failed);

    controller.handleBeforeRemove({ preventDefault: vi.fn() });

    expect(getState().content).toMatchObject({ status: "ready", currentUrl: "child" });
    expect(exit).not.toHaveBeenCalled();
  });

  it("allows the root route to pop", () => {
    let root = opdsViewReducer(createInitialOpdsViewState(), {
      type: "loadStarted",
      requestId: 1,
      url: "root",
      mode: "replace",
    });
    root = opdsViewReducer(root, { type: "loadSucceeded", requestId: 1, feed: feed("Root") });
    const { controller, exit } = setup(root);

    controller.handleHeaderBack();

    expect(exit).toHaveBeenCalledOnce();
  });
});
