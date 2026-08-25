import { describe, expect, it, vi } from "vitest";
import { createOpdsDesktopDownloadController } from "./opds-desktop-download-controller";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("desktop OPDS download controller", () => {
  it("cancels before deferred credentials resolve", async () => {
    const credentials = deferred<string>();
    const operation = vi.fn(async () => "downloaded");
    const controller = createOpdsDesktopDownloadController({
      prepare: () => credentials.promise,
    });

    const pending = controller.run(operation);
    expect(controller.cancel()).toBe(true);
    credentials.resolve("secret");

    await expect(pending).resolves.toBeUndefined();
    expect(operation).not.toHaveBeenCalled();
  });

  it("disposes before deferred credentials resolve without starting import", async () => {
    const credentials = deferred<string>();
    const operation = vi.fn(async () => "downloaded");
    const controller = createOpdsDesktopDownloadController({
      prepare: () => credentials.promise,
    });

    const pending = controller.run(operation);
    controller.dispose();
    credentials.resolve("secret");

    await expect(pending).resolves.toBeUndefined();
    expect(operation).not.toHaveBeenCalled();
  });

  it("suppresses a cancelled attempt when a retry completes first", async () => {
    const firstCredentials = deferred<string>();
    let attempts = 0;
    const controller = createOpdsDesktopDownloadController({
      prepare: () => (++attempts === 1 ? firstCredentials.promise : Promise.resolve("new")),
    });
    const firstOperation = vi.fn(async () => "stale");

    const first = controller.run(firstOperation);
    controller.cancel();
    await expect(controller.run(async () => "fresh")).resolves.toBe("fresh");
    firstCredentials.resolve("old");

    await expect(first).resolves.toBeUndefined();
    expect(firstOperation).not.toHaveBeenCalled();
  });

  it("rejects concurrent starts and stops accepting cancellation at import", async () => {
    const downloading = deferred<string>();
    const controller = createOpdsDesktopDownloadController({
      prepare: async () => "credentials",
    });
    let operationSignal: AbortSignal | undefined;
    const pending = controller.run(async (_credentials, ownership) => {
      operationSignal = ownership.signal;
      ownership.markImportStarted();
      return downloading.promise;
    });
    await Promise.resolve();

    await expect(controller.run(async () => "second")).rejects.toMatchObject({
      code: "download-in-progress",
    });
    expect(controller.cancel()).toBe(false);
    expect(operationSignal?.aborted).toBe(false);
    downloading.resolve("imported");
    await expect(pending).resolves.toBe("imported");
  });

  it("lets an atomic import finish after disposal while suppressing its stale result", async () => {
    const importing = deferred<string>();
    const controller = createOpdsDesktopDownloadController({
      prepare: async () => "credentials",
    });
    let operationSignal: AbortSignal | undefined;
    const pending = controller.run(async (_credentials, ownership) => {
      operationSignal = ownership.signal;
      ownership.markImportStarted();
      return importing.promise;
    });
    await Promise.resolve();

    expect(controller.dispose()).toBe(false);
    expect(operationSignal?.aborted).toBe(false);
    importing.resolve("imported");

    await expect(pending).resolves.toBeUndefined();
  });
});
