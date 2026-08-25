import type { OpdsErrorCode } from "./opds-client";
import type { OpdsFeed } from "./opds-types";

export type OpdsLoadMode = "replace" | "refresh" | "push" | "back";

export interface OpdsPendingRequest {
  readonly url: string;
  readonly mode: OpdsLoadMode;
}

export interface OpdsReadySnapshot {
  readonly feed: OpdsFeed;
  readonly currentUrl: string;
  readonly history: readonly string[];
}

export type OpdsContentState =
  | { readonly status: "idle" }
  | {
      readonly status: "loading";
      readonly requestId: number;
      readonly pending: OpdsPendingRequest;
      readonly previous?: OpdsReadySnapshot;
    }
  | (OpdsReadySnapshot & {
      readonly status: "ready";
      readonly refreshing: boolean;
      readonly requestId?: number;
      readonly pending?: OpdsPendingRequest;
    })
  | {
      readonly status: "error";
      readonly failedRequestId: number;
      readonly error: OpdsErrorCode;
      readonly failedRequest: OpdsPendingRequest;
      readonly previous?: OpdsReadySnapshot;
    };

export type OpdsDownloadState =
  | { readonly status: "idle" }
  | {
      readonly status: "downloading";
      readonly requestId: number;
      readonly publicationTitle: string;
      readonly loaded: number;
      readonly total: number;
    }
  | {
      readonly status: "success";
      readonly requestId: number;
      readonly publicationTitle: string;
      readonly importedCount: number;
    }
  | {
      readonly status: "importing";
      readonly requestId: number;
      readonly publicationTitle: string;
    }
  | {
      readonly status: "error";
      readonly requestId: number;
      readonly publicationTitle: string;
      readonly error: OpdsErrorCode;
    };

export interface OpdsViewState {
  readonly content: OpdsContentState;
  readonly download: OpdsDownloadState;
}

export type OpdsViewAction =
  | {
      readonly type: "loadStarted";
      readonly requestId: number;
      readonly url: string;
      readonly mode: OpdsLoadMode;
    }
  | { readonly type: "loadSucceeded"; readonly requestId: number; readonly feed: OpdsFeed }
  | { readonly type: "loadFailed"; readonly requestId: number; readonly error: OpdsErrorCode }
  | { readonly type: "retryStarted"; readonly requestId: number }
  | { readonly type: "loadCancelled"; readonly requestId: number }
  | {
      readonly type: "downloadStarted";
      readonly requestId: number;
      readonly publicationTitle: string;
    }
  | {
      readonly type: "downloadProgress";
      readonly requestId: number;
      readonly loaded: number;
      readonly total: number;
    }
  | {
      readonly type: "downloadSucceeded";
      readonly requestId: number;
      readonly importedCount: number;
    }
  | { readonly type: "downloadImporting"; readonly requestId: number }
  | { readonly type: "downloadFailed"; readonly requestId: number; readonly error: OpdsErrorCode }
  | { readonly type: "downloadCancelled"; readonly requestId: number }
  | { readonly type: "downloadReset" };

export interface OpdsBrowserRouteParams {
  readonly catalogId: string;
}

export function createInitialOpdsViewState(): OpdsViewState {
  return { content: { status: "idle" }, download: { status: "idle" } };
}

export function createOpdsBrowserRouteParams(catalogId: string): OpdsBrowserRouteParams {
  return { catalogId };
}

export function getOpdsReadySnapshot(content: OpdsContentState): OpdsReadySnapshot | undefined {
  if (content.status === "ready") {
    return { feed: content.feed, currentUrl: content.currentUrl, history: content.history };
  }
  if (content.status === "loading" || content.status === "error") return content.previous;
  return undefined;
}

function activeRequestId(content: OpdsContentState): number | undefined {
  if (content.status === "loading") return content.requestId;
  if (content.status === "ready" && content.refreshing) return content.requestId;
  return undefined;
}

function startLoad(
  content: OpdsContentState,
  requestId: number,
  pending: OpdsPendingRequest,
): OpdsContentState {
  const previous = getOpdsReadySnapshot(content);
  if (pending.mode === "refresh" && previous) {
    return { status: "ready", ...previous, refreshing: true, requestId, pending };
  }
  return { status: "loading", requestId, pending, ...(previous ? { previous } : {}) };
}

function finishLoad(content: OpdsContentState, feed: OpdsFeed): OpdsContentState {
  if (content.status !== "loading" && content.status !== "ready") return content;
  const pending = content.pending;
  if (!pending) return content;
  const previous = getOpdsReadySnapshot(content);
  let history: readonly string[] = [];
  if (previous) {
    if (pending.mode === "push") history = [...previous.history, previous.currentUrl];
    else if (pending.mode === "back") history = previous.history.slice(0, -1);
    else if (pending.mode === "refresh") history = previous.history;
  }
  return { status: "ready", feed, currentUrl: pending.url, history, refreshing: false };
}

export function opdsViewReducer(state: OpdsViewState, action: OpdsViewAction): OpdsViewState {
  switch (action.type) {
    case "loadStarted":
      return {
        ...state,
        content: startLoad(state.content, action.requestId, { url: action.url, mode: action.mode }),
      };
    case "retryStarted":
      return state.content.status === "error"
        ? {
            ...state,
            content: startLoad(state.content, action.requestId, state.content.failedRequest),
          }
        : state;
    case "loadSucceeded":
      return activeRequestId(state.content) === action.requestId
        ? { ...state, content: finishLoad(state.content, action.feed) }
        : state;
    case "loadFailed": {
      if (activeRequestId(state.content) !== action.requestId) return state;
      const pending =
        state.content.status === "loading" || state.content.status === "ready"
          ? state.content.pending
          : undefined;
      if (!pending) return state;
      const previous = getOpdsReadySnapshot(state.content);
      return {
        ...state,
        content: {
          status: "error",
          failedRequestId: action.requestId,
          error: action.error,
          failedRequest: pending,
          ...(previous ? { previous } : {}),
        },
      };
    }
    case "loadCancelled": {
      const matches =
        activeRequestId(state.content) === action.requestId ||
        (state.content.status === "error" && state.content.failedRequestId === action.requestId);
      if (!matches) return state;
      const previous = getOpdsReadySnapshot(state.content);
      return previous
        ? { ...state, content: { status: "ready", ...previous, refreshing: false } }
        : { ...state, content: { status: "idle" } };
    }
    case "downloadStarted":
      return state.download.status === "downloading"
        ? state
        : {
            ...state,
            download: {
              status: "downloading",
              requestId: action.requestId,
              publicationTitle: action.publicationTitle,
              loaded: 0,
              total: 0,
            },
          };
    case "downloadProgress":
      return state.download.status === "downloading" &&
        state.download.requestId === action.requestId
        ? {
            ...state,
            download: {
              ...state.download,
              loaded: Math.max(0, action.loaded),
              total: Math.max(0, action.total),
            },
          }
        : state;
    case "downloadImporting":
      return state.download.status === "downloading" &&
        state.download.requestId === action.requestId
        ? {
            ...state,
            download: {
              status: "importing",
              requestId: action.requestId,
              publicationTitle: state.download.publicationTitle,
            },
          }
        : state;
    case "downloadSucceeded":
      return (state.download.status === "downloading" || state.download.status === "importing") &&
        state.download.requestId === action.requestId
        ? {
            ...state,
            download: {
              status: "success",
              requestId: action.requestId,
              publicationTitle: state.download.publicationTitle,
              importedCount: action.importedCount,
            },
          }
        : state;
    case "downloadFailed":
      return (state.download.status === "downloading" || state.download.status === "importing") &&
        state.download.requestId === action.requestId
        ? {
            ...state,
            download: {
              status: "error",
              requestId: action.requestId,
              publicationTitle: state.download.publicationTitle,
              error: action.error,
            },
          }
        : state;
    case "downloadCancelled":
      return state.download.status === "downloading" &&
        state.download.requestId === action.requestId
        ? { ...state, download: { status: "idle" } }
        : state;
    case "downloadReset":
      return state.download.status === "idle" ? state : { ...state, download: { status: "idle" } };
  }
}

export function selectOpdsFeed(state: OpdsViewState): OpdsFeed | undefined {
  if (state.content.status === "ready") return state.content.feed;
  if (state.content.status === "loading" || state.content.status === "error") {
    return state.content.previous?.feed;
  }
  return undefined;
}

export function canSearchOpds(state: OpdsViewState): boolean {
  return selectOpdsFeed(state)?.search !== undefined;
}

export function getOpdsPagination(state: OpdsViewState): {
  previousUrl?: string;
  nextUrl?: string;
} {
  const current = selectOpdsFeed(state);
  return {
    ...(current?.previousUrl ? { previousUrl: current.previousUrl } : {}),
    ...(current?.nextUrl ? { nextUrl: current.nextUrl } : {}),
  };
}

export function shouldEditOpdsCredentials(state: OpdsViewState): boolean {
  return state.content.status === "error" && state.content.error === "unauthorized";
}
