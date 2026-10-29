import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRequestTracker, sendScript } from "./extractor-requests-core";

describe("createRequestTracker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const make = () => createRequestTracker<string>({ timeoutMs: 1000, timeoutMessage: "timed out" });

  it("settles a request by its id", async () => {
    const tracker = make();
    const first = tracker.begin();
    const second = tracker.begin();

    expect(tracker.resolve(second.id, "second")).toBe(true);
    expect(tracker.resolve(first.id, "first")).toBe(true);

    await expect(first.promise).resolves.toBe("first");
    await expect(second.promise).resolves.toBe("second");
    expect(tracker.size).toBe(0);
  });

  it("ignores an answer for a request that already ended", async () => {
    const tracker = make();
    const first = tracker.begin();
    const second = tracker.begin();
    tracker.reject(first.id, new Error("stopped"));
    await expect(first.promise).rejects.toThrow("stopped");

    // A late answer for the first book must not settle the second one.
    expect(tracker.resolve(first.id, "late")).toBe(false);
    expect(tracker.size).toBe(1);

    tracker.resolve(second.id, "second");
    await expect(second.promise).resolves.toBe("second");
  });

  it("settles the oldest request when the answer carries no id", async () => {
    const tracker = make();
    const first = tracker.begin();
    const second = tracker.begin();

    tracker.resolve(undefined, "answer");

    await expect(first.promise).resolves.toBe("answer");
    expect(tracker.size).toBe(1);
    tracker.reject(second.id, new Error("done"));
    await expect(second.promise).rejects.toThrow("done");
  });

  it("returns false when nothing is waiting", () => {
    const tracker = make();
    expect(tracker.resolve(undefined, "x")).toBe(false);
    expect(tracker.reject("extract-99", new Error("x"))).toBe(false);
  });

  it("rejects with the timeout message and forgets the request", async () => {
    const tracker = make();
    const request = tracker.begin();
    const outcome = request.promise.catch((error: Error) => error.message);

    await vi.advanceTimersByTimeAsync(999);
    expect(tracker.size).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(outcome).resolves.toBe("timed out");
    expect(tracker.size).toBe(0);
    expect(tracker.resolve(request.id, "late")).toBe(false);
  });

  it("does not time out a request that was answered", async () => {
    const tracker = make();
    const request = tracker.begin();
    tracker.resolve(request.id, "ok");

    await vi.advanceTimersByTimeAsync(5000);
    await expect(request.promise).resolves.toBe("ok");
  });

  it("rejects every waiting request", async () => {
    const tracker = make();
    const first = tracker.begin();
    const second = tracker.begin();
    const outcomes = Promise.all([
      first.promise.catch((error: Error) => error.message),
      second.promise.catch((error: Error) => error.message),
    ]);

    tracker.rejectAll(new Error("unmounted"));

    await expect(outcomes).resolves.toEqual(["unmounted", "unmounted"]);
    expect(tracker.size).toBe(0);
  });
});

describe("sendScript", () => {
  const makeDeps = (overrides: Partial<Parameters<typeof sendScript>[0]> = {}) => ({
    native: vi.fn(async () => {}),
    command: vi.fn(),
    isAppActive: () => true,
    warn: vi.fn(),
    ...overrides,
  });

  it("uses the native bridge when there is one", async () => {
    const deps = makeDeps();

    await expect(sendScript(deps, "run()")).resolves.toBe("native");

    expect(deps.native).toHaveBeenCalledWith("run()");
    expect(deps.command).not.toHaveBeenCalled();
  });

  it("uses the native bridge with the app in the background", async () => {
    const deps = makeDeps({ isAppActive: () => false });

    await expect(sendScript(deps, "run()")).resolves.toBe("native");

    expect(deps.command).not.toHaveBeenCalled();
  });

  it("falls back to the command while the app is active", async () => {
    const deps = makeDeps({
      native: vi.fn(async () => {
        throw new Error("view not found");
      }),
    });

    await expect(sendScript(deps, "run()")).resolves.toBe("command");

    expect(deps.command).toHaveBeenCalledWith("run()");
    expect(deps.warn).toHaveBeenCalled();
  });

  it("uses the command when there is no native bridge", async () => {
    const deps = makeDeps({ native: null });

    await expect(sendScript(deps, "run()")).resolves.toBe("command");

    expect(deps.command).toHaveBeenCalledWith("run()");
  });

  it("fails at once instead of queueing a command in the background", async () => {
    const deps = makeDeps({ native: null, isAppActive: () => false });

    await expect(sendScript(deps, "run()")).rejects.toThrow("background");

    expect(deps.command).not.toHaveBeenCalled();
  });

  it("fails in the background when the native bridge breaks", async () => {
    const deps = makeDeps({
      native: vi.fn(async () => {
        throw new Error("view not found");
      }),
      isAppActive: () => false,
    });

    await expect(sendScript(deps, "run()")).rejects.toThrow("background");

    expect(deps.command).not.toHaveBeenCalled();
  });
});
