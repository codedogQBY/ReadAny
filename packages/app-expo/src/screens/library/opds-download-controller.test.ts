import { OpdsError } from "@readany/core";
import { describe, expect, it, vi } from "vitest";
import {
  createOpdsDownloadController,
  getOpdsDownloadAccessibility,
} from "./opds-download-controller";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("OPDS screen download controller", () => {
  it("owns cancellation before credential lookup and never starts a cancelled download", async () => {
    const credentials = deferred<string>();
    const execute = vi.fn(async () => ({ importedCount: 1 }));
    const events: unknown[] = [];
    let credentialSignal: AbortSignal | undefined;
    const controller = createOpdsDownloadController<string>({
      onEvent: (event) => events.push(event),
    });

    const operation = controller.start({
      publicationTitle: "Book",
      prepare: (signal) => {
        credentialSignal = signal;
        return credentials.promise;
      },
      execute,
    });

    expect(controller.cancel()).toBe(true);
    expect(credentialSignal?.aborted).toBe(true);
    credentials.resolve("secret");
    await expect(operation).resolves.toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
    expect(events.map((event) => (event as { type: string }).type)).toEqual([
      "downloadStarted",
      "downloadCancelled",
    ]);
  });

  it("transitions synchronously to noncancellable importing at the commit point", async () => {
    const imported = deferred<{ importedCount: number }>();
    const events: unknown[] = [];
    const controller = createOpdsDownloadController<string>({
      onEvent: (event) => events.push(event),
    });

    const operation = controller.start({
      publicationTitle: "Book",
      prepare: async () => "secret",
      execute: async ({ onImportStart }) => {
        onImportStart();
        return imported.promise;
      },
    });

    await vi.waitFor(() => expect(controller.getPhase()).toBe("importing"));
    expect(controller.cancel()).toBe(false);
    expect(events.at(-1)).toMatchObject({ type: "downloadImporting" });
    imported.resolve({ importedCount: 1 });
    await expect(operation).resolves.toEqual({ importedCount: 1 });
    expect(events.at(-1)).toMatchObject({ type: "downloadSucceeded", importedCount: 1 });
  });

  it("surfaces a committed import failure even when cancel is tapped late", async () => {
    const imported = deferred<{ importedCount: number }>();
    const events: unknown[] = [];
    const controller = createOpdsDownloadController<void>({
      onEvent: (event) => events.push(event),
    });
    const operation = controller.start({
      publicationTitle: "Book",
      prepare: async () => undefined,
      execute: async ({ onImportStart }) => {
        onImportStart();
        return imported.promise;
      },
    });

    await vi.waitFor(() => expect(controller.getPhase()).toBe("importing"));
    expect(controller.cancel()).toBe(false);
    imported.reject(new OpdsError("import-failed"));
    await expect(operation).rejects.toMatchObject({ code: "import-failed" });
    expect(events.at(-1)).toMatchObject({ type: "downloadFailed", error: "import-failed" });
  });

  it("rejects a second request while credential lookup is active", async () => {
    const credentials = deferred<void>();
    const controller = createOpdsDownloadController<void>({ onEvent: vi.fn() });
    const first = controller.start({
      publicationTitle: "First",
      prepare: () => credentials.promise,
      execute: async () => ({ importedCount: 1 }),
    });

    await expect(
      controller.start({
        publicationTitle: "Second",
        prepare: async () => undefined,
        execute: async () => ({ importedCount: 1 }),
      }),
    ).rejects.toMatchObject({ code: "download-in-progress" });

    controller.cancel();
    credentials.resolve();
    await first;
  });

  it("describes determinate, indeterminate, importing, success, and error states accessibly", () => {
    expect(
      getOpdsDownloadAccessibility({
        status: "downloading",
        requestId: 1,
        publicationTitle: "Book",
        loaded: 25,
        total: 100,
      }),
    ).toMatchObject({ role: "progressbar", value: { min: 0, max: 100, now: 25 } });
    expect(
      getOpdsDownloadAccessibility({
        status: "downloading",
        requestId: 1,
        publicationTitle: "Book",
        loaded: 25,
        total: 0,
      }),
    ).toMatchObject({ role: "progressbar", value: { text: "downloading" } });
    expect(
      getOpdsDownloadAccessibility({ status: "importing", requestId: 1, publicationTitle: "Book" }),
    ).toMatchObject({ role: "progressbar", value: { text: "importing" }, liveRegion: "polite" });
    expect(
      getOpdsDownloadAccessibility({
        status: "error",
        requestId: 1,
        publicationTitle: "Book",
        error: "import-failed",
      }),
    ).toMatchObject({ role: "alert", liveRegion: "assertive" });
  });
});
