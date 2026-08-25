import { describe, expect, it } from "vitest";
import { createOpdsDesktopRequestController } from "./opds-desktop-request-controller";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("desktop OPDS request controller", () => {
  it("aborts the previous request and suppresses its stale result", async () => {
    const first = deferred<string>();
    const controller = createOpdsDesktopRequestController({
      prepare: async () => "credentials",
    });

    const firstRun = controller.run((_credentials, signal) => {
      expect(signal.aborted).toBe(false);
      return first.promise;
    });
    await expect(controller.run(async () => "newest")).resolves.toBe("newest");
    first.resolve("stale");
    await expect(firstRun).resolves.toBeUndefined();

    expect(controller.isActive()).toBe(false);
  });

  it("suppresses callbacks after cancellation or disposal", async () => {
    const pending = deferred<string>();
    const controller = createOpdsDesktopRequestController({
      prepare: async () => undefined,
    });

    const run = controller.run(() => pending.promise);
    controller.dispose();
    pending.resolve("late");
    await expect(run).resolves.toBeUndefined();

    expect(controller.isActive()).toBe(false);
  });
});
