import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtractorRequestBoundary } from "./extractor-request-boundary";
import { ReaderExtractionSessions } from "./reader-extraction-sessions";

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ExtractorRequestBoundary timeout", () => {
  it("cancels and releases timed-out A before isolated B completes", async () => {
    vi.useFakeTimers();
    const order: string[] = [];
    const sessions = new ReaderExtractionSessions<{ chapters: string[] }>();
    const boundary = new ExtractorRequestBoundary<string[]>({
      timeoutMs: 45_000,
      sendCancel: (requestId) => {
        order.push(`cancel:${requestId}`);
        sessions.cancel(requestId);
      },
    });
    const parserA = deferred<{ chapters: string[] }>();
    const openA = sessions.open("A", () => parserA.promise);
    const resultA = new Promise<string[]>((resolve, reject) => {
      boundary.add({
        requestId: "A",
        resolve,
        reject: (error) => {
          order.push("reject:A");
          reject(error);
        },
        timeoutError: () => new Error("Timed out extracting book content"),
      });
    });

    const timedOut = expect(resultA).rejects.toThrow("Timed out extracting book content");
    await vi.advanceTimersByTimeAsync(45_000);
    await timedOut;
    expect(order).toEqual(["cancel:A", "reject:A"]);

    const cancelledOpen = expect(openA).rejects.toMatchObject({ name: "AbortError" });
    parserA.resolve({ chapters: ["A chapter"] });
    await cancelledOpen;
    expect(boundary.resolve("A", ["late A chapter"])).toBe(false);

    const openB = sessions.open("B", async () => ({ chapters: ["B chapter"] }));
    const resultB = new Promise<string[]>((resolve, reject) => {
      boundary.add({
        requestId: "B",
        resolve,
        reject,
        timeoutError: () => new Error("B timed out"),
      });
    });
    const bookB = await openB;
    expect(boundary.resolve("B", bookB.chapters)).toBe(true);

    await expect(resultB).resolves.toEqual(["B chapter"]);
    expect(sessions.getBook("B").chapters).toEqual(["B chapter"]);
    await vi.runAllTimersAsync();
    expect(order).toEqual(["cancel:A", "reject:A"]);
  });

  it("keeps explicit abort cancellation one-shot and ignores its late reply", async () => {
    vi.useFakeTimers();
    const cancelled: string[] = [];
    const controller = new AbortController();
    const boundary = new ExtractorRequestBoundary<string[]>({
      timeoutMs: 45_000,
      sendCancel: (requestId) => cancelled.push(requestId),
    });
    const result = new Promise<string[]>((resolve, reject) => {
      boundary.add({
        requestId: "A",
        resolve,
        reject,
        signal: controller.signal,
        abortError: () => {
          const error = new Error("cancelled");
          error.name = "AbortError";
          return error;
        },
        timeoutError: () => new Error("timed out"),
      });
    });
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });

    controller.abort();
    controller.abort();

    await rejected;
    expect(cancelled).toEqual(["A"]);
    expect(boundary.resolve("A", ["late chapter"])).toBe(false);
    await vi.runAllTimersAsync();
    expect(cancelled).toEqual(["A"]);
  });
});
