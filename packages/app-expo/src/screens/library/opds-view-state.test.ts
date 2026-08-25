import type { OpdsFeed } from "@readany/core";
import { describe, expect, it } from "vitest";
import {
  canSearchOpds,
  createInitialOpdsViewState,
  createOpdsBrowserRouteParams,
  getOpdsPagination,
  opdsViewReducer,
  selectOpdsFeed,
  shouldEditOpdsCredentials,
} from "./opds-view-state";

function feed(overrides: Partial<OpdsFeed> = {}): OpdsFeed {
  return {
    title: "Catalog",
    navigation: [],
    publications: [],
    groups: [],
    facets: [],
    ...overrides,
  };
}

function readyState() {
  const loading = opdsViewReducer(createInitialOpdsViewState(), {
    type: "loadStarted",
    requestId: 1,
    url: "https://catalog.test/root",
    mode: "replace",
  });
  return opdsViewReducer(loading, {
    type: "loadSucceeded",
    requestId: 1,
    feed: feed(),
  });
}

describe("OPDS mobile view state", () => {
  it("starts idle with no visible feed or active download", () => {
    const state = createInitialOpdsViewState();

    expect(state.content).toEqual({ status: "idle" });
    expect(state.download).toEqual({ status: "idle" });
    expect(selectOpdsFeed(state)).toBeUndefined();
  });

  it("uses loading for the first catalog request", () => {
    const state = opdsViewReducer(createInitialOpdsViewState(), {
      type: "loadStarted",
      requestId: 1,
      url: "https://catalog.test/root",
      mode: "replace",
    });

    expect(state.content).toMatchObject({
      status: "loading",
      requestId: 1,
      pending: { url: "https://catalog.test/root", mode: "replace" },
    });
  });

  it("retains the ready feed while refresh is in flight", () => {
    const ready = readyState();
    const refreshing = opdsViewReducer(ready, {
      type: "loadStarted",
      requestId: 2,
      url: "https://catalog.test/root",
      mode: "refresh",
    });

    expect(refreshing.content.status).toBe("ready");
    expect(refreshing.content).toMatchObject({ refreshing: true, requestId: 2 });
    expect(selectOpdsFeed(refreshing)?.title).toBe("Catalog");
  });

  it("pushes feed navigation and returns through its history", () => {
    const ready = readyState();
    const loadingChild = opdsViewReducer(ready, {
      type: "loadStarted",
      requestId: 2,
      url: "https://catalog.test/fiction",
      mode: "push",
    });
    const child = opdsViewReducer(loadingChild, {
      type: "loadSucceeded",
      requestId: 2,
      feed: feed({ title: "Fiction" }),
    });

    expect(child.content).toMatchObject({
      status: "ready",
      currentUrl: "https://catalog.test/fiction",
      history: ["https://catalog.test/root"],
    });

    const loadingRoot = opdsViewReducer(child, {
      type: "loadStarted",
      requestId: 3,
      url: "https://catalog.test/root",
      mode: "back",
    });
    const root = opdsViewReducer(loadingRoot, {
      type: "loadSucceeded",
      requestId: 3,
      feed: feed({ title: "Catalog again" }),
    });

    expect(root.content).toMatchObject({
      status: "ready",
      currentUrl: "https://catalog.test/root",
      history: [],
    });
  });

  it("shows search only when the feed advertises it", () => {
    expect(canSearchOpds(readyState())).toBe(false);

    const loading = opdsViewReducer(createInitialOpdsViewState(), {
      type: "loadStarted",
      requestId: 1,
      url: "https://catalog.test/root",
      mode: "replace",
    });
    const searchable = opdsViewReducer(loading, {
      type: "loadSucceeded",
      requestId: 1,
      feed: feed({
        search: { kind: "template", urlTemplate: "https://catalog.test?q={searchTerms}" },
      }),
    });

    expect(canSearchOpds(searchable)).toBe(true);
  });

  it("exposes only advertised previous and next pagination links", () => {
    const loading = opdsViewReducer(createInitialOpdsViewState(), {
      type: "loadStarted",
      requestId: 1,
      url: "https://catalog.test/page/2",
      mode: "replace",
    });
    const ready = opdsViewReducer(loading, {
      type: "loadSucceeded",
      requestId: 1,
      feed: feed({
        previousUrl: "https://catalog.test/page/1",
        nextUrl: "https://catalog.test/page/3",
      }),
    });

    expect(getOpdsPagination(ready)).toEqual({
      previousUrl: "https://catalog.test/page/1",
      nextUrl: "https://catalog.test/page/3",
    });
  });

  it("turns authentication failures into an edit-credentials recovery", () => {
    const failed = opdsViewReducer(readyState(), {
      type: "loadStarted",
      requestId: 2,
      url: "https://catalog.test/private",
      mode: "push",
    });
    const error = opdsViewReducer(failed, {
      type: "loadFailed",
      requestId: 2,
      error: "unauthorized",
    });

    expect(error.content.status).toBe("error");
    expect(shouldEditOpdsCredentials(error)).toBe(true);
  });

  it("retries the failed request with a new request id", () => {
    const loading = opdsViewReducer(createInitialOpdsViewState(), {
      type: "loadStarted",
      requestId: 1,
      url: "https://catalog.test/root",
      mode: "replace",
    });
    const failed = opdsViewReducer(loading, {
      type: "loadFailed",
      requestId: 1,
      error: "unreachable",
    });
    const retrying = opdsViewReducer(failed, { type: "retryStarted", requestId: 2 });

    expect(retrying.content).toMatchObject({
      status: "loading",
      requestId: 2,
      pending: { url: "https://catalog.test/root", mode: "replace" },
    });
  });

  it("tracks download progress and imported completion", () => {
    let state = opdsViewReducer(readyState(), {
      type: "downloadStarted",
      requestId: 7,
      publicationTitle: "A Book",
    });
    state = opdsViewReducer(state, {
      type: "downloadProgress",
      requestId: 7,
      loaded: 40,
      total: 100,
    });
    expect(state.download).toMatchObject({ status: "downloading", loaded: 40, total: 100 });

    state = opdsViewReducer(state, { type: "downloadImporting", requestId: 7 });
    expect(state.download).toMatchObject({ status: "importing", publicationTitle: "A Book" });
    expect(opdsViewReducer(state, { type: "downloadCancelled", requestId: 7 }).download).toEqual(
      state.download,
    );

    state = opdsViewReducer(state, {
      type: "downloadSucceeded",
      requestId: 7,
      importedCount: 1,
    });
    expect(state.download).toEqual({
      status: "success",
      requestId: 7,
      publicationTitle: "A Book",
      importedCount: 1,
    });
  });

  it("resets cancellation and ignores late progress from the cancelled request", () => {
    const downloading = opdsViewReducer(readyState(), {
      type: "downloadStarted",
      requestId: 7,
      publicationTitle: "A Book",
    });
    const cancelled = opdsViewReducer(downloading, {
      type: "downloadCancelled",
      requestId: 7,
    });
    const staleProgress = opdsViewReducer(cancelled, {
      type: "downloadProgress",
      requestId: 7,
      loaded: 100,
      total: 100,
    });

    expect(staleProgress.download).toEqual({ status: "idle" });
  });

  it("ignores stale feed responses after a newer request starts", () => {
    const first = opdsViewReducer(createInitialOpdsViewState(), {
      type: "loadStarted",
      requestId: 1,
      url: "https://catalog.test/old",
      mode: "replace",
    });
    const latest = opdsViewReducer(first, {
      type: "loadStarted",
      requestId: 2,
      url: "https://catalog.test/latest",
      mode: "replace",
    });
    const stale = opdsViewReducer(latest, {
      type: "loadSucceeded",
      requestId: 1,
      feed: feed({ title: "Old response" }),
    });

    expect(stale).toBe(latest);
  });

  it("restores the previous ready feed when an in-flight or failed push is cancelled", () => {
    const ready = readyState();
    const pushing = opdsViewReducer(ready, {
      type: "loadStarted",
      requestId: 2,
      url: "https://catalog.test/child",
      mode: "push",
    });
    const restoredInFlight = opdsViewReducer(pushing, { type: "loadCancelled", requestId: 2 });
    expect(restoredInFlight.content).toMatchObject({
      status: "ready",
      currentUrl: "https://catalog.test/root",
    });

    const failed = opdsViewReducer(pushing, {
      type: "loadFailed",
      requestId: 2,
      error: "unreachable",
    });
    const restoredFailed = opdsViewReducer(failed, { type: "loadCancelled", requestId: 2 });
    expect(restoredFailed.content).toMatchObject({
      status: "ready",
      currentUrl: "https://catalog.test/root",
    });
  });

  it("creates serializable route params containing only the catalog id", () => {
    const params = createOpdsBrowserRouteParams("catalog-id");

    expect(params).toEqual({ catalogId: "catalog-id" });
    expect(JSON.parse(JSON.stringify(params))).toEqual(params);
    expect(JSON.stringify(params)).not.toContain("password");
  });
});
