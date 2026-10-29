import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BackgroundServiceLike,
  type BackgroundTextKey,
  MIN_UPDATE_INTERVAL_MS,
  createBackgroundVectorize,
  shouldPushUpdate,
  toPercent,
} from "./vectorize-background-core";

type StartOptions = Parameters<BackgroundServiceLike["start"]>[1];
type UpdateData = Parameters<BackgroundServiceLike["updateNotification"]>[0];

function makeService(opts: { failStart?: boolean } = {}) {
  let running = false;
  let startedTask: (() => Promise<void>) | null = null;
  const service = {
    start: vi.fn(async (task: () => Promise<void>, _options: StartOptions) => {
      if (opts.failStart) throw new Error("not allowed from the background");
      running = true;
      startedTask = task;
    }),
    updateNotification: vi.fn(async (_data: UpdateData) => undefined),
    stop: vi.fn(async () => {
      running = false;
    }),
    isRunning: () => running,
  };
  return {
    service: service as unknown as BackgroundServiceLike & typeof service,
    getTask: () => startedTask,
  };
}

const text = (key: BackgroundTextKey, params: Record<string, string | number> = {}) =>
  `${key}:${JSON.stringify(params)}`;

function setup(options: { foreground?: boolean; android?: boolean; failStart?: boolean } = {}) {
  const { service, getTask } = makeService({ failStart: options.failStart });
  const notifier = {
    ensurePermission: vi.fn(async () => undefined),
    notify: vi.fn(async (_title: string, _body: string) => undefined),
  };
  let time = 1_000_000;
  const background = createBackgroundVectorize({
    isAndroid: options.android ?? true,
    service,
    notifier,
    text,
    isAppForeground: () => options.foreground ?? false,
    now: () => time,
  });
  return {
    background,
    service,
    notifier,
    getTask,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

describe("toPercent", () => {
  it("rounds and clamps to 0-100", () => {
    expect(toPercent(0.425)).toBe(43);
    expect(toPercent(-1)).toBe(0);
    expect(toPercent(7)).toBe(100);
    expect(toPercent(Number.NaN)).toBe(0);
  });
});

describe("shouldPushUpdate", () => {
  it("always pushes the first update and forced ones", () => {
    expect(shouldPushUpdate(null, { at: 0, percent: 1 })).toBe(true);
    expect(shouldPushUpdate({ at: 0, percent: 5 }, { at: 1, percent: 5 }, true)).toBe(true);
  });

  it("skips an unchanged percentage", () => {
    expect(shouldPushUpdate({ at: 0, percent: 5 }, { at: 10_000, percent: 5 })).toBe(false);
  });

  it("rate-limits changes", () => {
    const last = { at: 0, percent: 5 };
    expect(shouldPushUpdate(last, { at: MIN_UPDATE_INTERVAL_MS - 1, percent: 6 })).toBe(false);
    expect(shouldPushUpdate(last, { at: MIN_UPDATE_INTERVAL_MS, percent: 6 })).toBe(true);
  });
});

describe("createBackgroundVectorize", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  it("starts a dataSync foreground service when the first queue begins", async () => {
    const { background, service } = setup();
    await background.acquire();

    expect(service.start).toHaveBeenCalledTimes(1);
    const options = service.start.mock.calls[0][1];
    expect(options.foregroundServiceType).toEqual(["dataSync"]);
    expect(options.taskName).toBe("ReadAnyVectorize");
  });

  it("keeps the headless task pending until the queue is released", async () => {
    const { background, getTask } = setup();
    const handle = await background.acquire();
    let settled = false;
    void getTask()?.().then(() => {
      settled = true;
    });

    await Promise.resolve();
    expect(settled).toBe(false);

    await handle.release();
    await Promise.resolve();
    expect(settled).toBe(true);
  });

  it("shows the current book and percent in the notification", async () => {
    const { background, service, advance } = setup();
    const handle = await background.acquire();

    handle.bookStarted("War and Peace", 1, 3);
    advance(2000);
    handle.bookProgress(0.426);
    await Promise.resolve();

    const calls = service.updateNotification.mock.calls;
    const last = calls[calls.length - 1][0] as {
      taskDesc: string;
      progressBar: { max: number; value: number };
    };
    expect(last.progressBar).toEqual({ max: 100, value: 43 });
    expect(last.taskDesc).toContain('"title":"War and Peace"');
    expect(last.taskDesc).toContain('"current":2');
    expect(last.taskDesc).toContain('"total":3');
  });

  it("does not flood the notification with updates", async () => {
    const { background, service, advance } = setup();
    const handle = await background.acquire();
    handle.bookStarted("Book", 0, 1);
    const afterStart = service.updateNotification.mock.calls.length;

    for (let i = 1; i <= 20; i++) {
      advance(10);
      handle.bookProgress(i / 100);
    }
    await Promise.resolve();

    expect(service.updateNotification.mock.calls.length).toBe(afterStart);
  });

  it("stops the service only when the last holder releases", async () => {
    const { background, service } = setup();
    const first = await background.acquire();
    const second = await background.acquire();

    expect(service.start).toHaveBeenCalledTimes(1);
    await first.release();
    expect(service.stop).not.toHaveBeenCalled();
    await second.release();
    expect(service.stop).toHaveBeenCalledTimes(1);
  });

  it("is safe to release twice", async () => {
    const { background, service } = setup();
    const handle = await background.acquire();
    await handle.release();
    await handle.release();
    expect(service.stop).toHaveBeenCalledTimes(1);
  });

  it("posts a result notification when the work ends while the app is hidden", async () => {
    const { background, notifier } = setup({ foreground: false });
    const handle = await background.acquire();
    handle.bookStarted("A", 0, 2);
    handle.bookFinished(true);
    handle.bookStarted("B", 1, 2);
    handle.bookFinished(true);
    await handle.release();

    expect(notifier.notify).toHaveBeenCalledTimes(1);
    expect(notifier.notify.mock.calls[0]).toEqual([
      "doneTitle:{}",
      'doneBody:{"done":2,"total":2}',
    ]);
  });

  it("reports failures so the user knows to continue", async () => {
    const { background, notifier } = setup({ foreground: false });
    const handle = await background.acquire();
    handle.bookFinished(true);
    handle.bookFinished(false);
    await handle.release();

    expect(notifier.notify.mock.calls[0][1]).toBe('partialBody:{"done":1,"failed":1}');
  });

  it("stays quiet when the app is on screen", async () => {
    const { background, notifier } = setup({ foreground: true });
    const handle = await background.acquire();
    handle.bookFinished(true);
    await handle.release();

    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it("starts nothing and notifies nothing outside Android", async () => {
    const { background, service, notifier } = setup({ android: false });
    const handle = await background.acquire();
    handle.bookStarted("A", 0, 1);
    handle.bookProgress(0.5);
    handle.bookFinished(true);
    await handle.release();

    expect(service.start).not.toHaveBeenCalled();
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it("falls back to a no-op when the service cannot be started", async () => {
    const { background, notifier } = setup({ failStart: true });
    const handle = await background.acquire();

    expect(() => handle.bookStarted("A", 0, 1)).not.toThrow();
    handle.bookFinished(true);
    await handle.release();
    expect(notifier.notify).not.toHaveBeenCalled();
  });

  it("can start again after a finished run, with fresh counters", async () => {
    const { background, service, notifier } = setup({ foreground: false });
    const first = await background.acquire();
    first.bookFinished(true);
    await first.release();

    const second = await background.acquire();
    second.bookFinished(true);
    second.bookFinished(true);
    await second.release();

    expect(service.start).toHaveBeenCalledTimes(2);
    expect(notifier.notify.mock.calls[1][1]).toBe('doneBody:{"done":2,"total":2}');
  });
});
