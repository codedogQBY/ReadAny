import type {
  DictionaryEntry,
  DictionaryLanguage,
  DictionaryPackDescriptor,
} from "@readany/core/dictionary";
import { describe, expect, it, vi } from "vitest";
import { DefinitionController } from "./definition-controller";

const descriptor: DictionaryPackDescriptor = {
  language: "en",
  version: "1.0.0",
  schemaVersion: 1,
  sourceEdition: "enwiktionary",
  sourceDumpDate: "2026-09-01",
  sizeBytes: 1_572_864,
  sha256: "a".repeat(64),
  url: "https://example.test/readany-dictionary-en.sqlite",
  sourceArchiveUrl: "https://example.test/en-source.xml.bz2",
  attributionUrl: "https://en.wiktionary.org",
  license: "CC BY-SA 4.0",
};

const entry: DictionaryEntry = {
  id: 1,
  language: "en",
  headword: "desire",
  pronunciation: "/dɪˈzaɪəɹ/",
  partOfSpeech: "noun",
  senses: [{ order: 0, definition: "A strong wish." }],
};

function lookupError(code: string, message = code): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createController(options?: {
  lookup?: (text: string) => Promise<DictionaryEntry[]>;
  install?: (
    pack: DictionaryPackDescriptor,
    onProgress: (progress: number) => void,
    onVerifying?: () => void,
  ) => Promise<void>;
  getDescriptor?: (language: DictionaryLanguage) => DictionaryPackDescriptor | undefined;
}) {
  return new DefinitionController({
    lookup: options?.lookup ?? vi.fn(async () => [entry]),
    install: options?.install ?? vi.fn(async () => {}),
    getDescriptor: options?.getDescriptor ?? vi.fn(() => descriptor),
  });
}

describe("DefinitionController", () => {
  it("opens a supported selection into its local result", async () => {
    const lookup = vi.fn(async () => [entry]);
    const controller = createController({ lookup });

    await controller.open("  Desire  ");

    expect(lookup).toHaveBeenCalledWith("  Desire  ");
    expect(controller.state).toEqual({
      kind: "result",
      displayText: "Desire",
      entries: [entry],
    });
  });

  it("offers the matching pack when the local pack is absent", async () => {
    const getDescriptor = vi.fn(() => descriptor);
    const controller = createController({
      lookup: async () => {
        throw lookupError("pack-not-installed");
      },
      getDescriptor,
    });

    await controller.open("desire");

    expect(getDescriptor).toHaveBeenCalledWith("en");
    expect(controller.state).toEqual({ kind: "missing-pack", language: "en", descriptor });
  });

  it("shows verification separately and discards it after closing", async () => {
    let verify: (() => void) | undefined;
    let finish!: () => void;
    const controller = createController({
      lookup: async () => {
        throw lookupError("pack-not-installed");
      },
      install: async (_pack, _progress, onVerifying) => {
        verify = onVerifying;
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    });
    await controller.open("desire");
    const downloading = controller.download();
    verify?.();
    expect(controller.state).toEqual({ kind: "verifying", language: "en" });
    controller.close();
    verify?.();
    finish();
    await downloading;
    expect(controller.state).toEqual({ kind: "idle" });
  });

  it("reports install progress then automatically retries the original selection", async () => {
    const lookup = vi
      .fn<(text: string) => Promise<DictionaryEntry[]>>()
      .mockRejectedValueOnce(lookupError("pack-not-installed"))
      .mockResolvedValueOnce([entry]);
    const install = vi.fn(
      async (_pack: DictionaryPackDescriptor, onProgress: (value: number) => void) => {
        onProgress(0.37);
      },
    );
    const controller = createController({ lookup, install });

    await controller.open("desire");
    const downloading = controller.download();

    expect(controller.state).toEqual({ kind: "downloading", language: "en", progress: 0.37 });
    await downloading;

    expect(install).toHaveBeenCalledWith(descriptor, expect.any(Function), expect.any(Function));
    expect(lookup).toHaveBeenNthCalledWith(2, "desire");
    expect(controller.state).toEqual({
      kind: "result",
      displayText: "desire",
      entries: [entry],
    });
  });

  it("shows no-match for a supported local lookup with no entries", async () => {
    const controller = createController({ lookup: async () => [] });

    await controller.open("unknown");

    expect(controller.state).toEqual({ kind: "no-match", displayText: "unknown" });
  });

  it("rejects an unsupported selection before invoking lookup", async () => {
    const lookup = vi.fn(async () => [entry]);
    const controller = createController({ lookup });

    await controller.open("read閱讀");

    expect(lookup).not.toHaveBeenCalled();
    expect(controller.state).toEqual({ kind: "unsupported", reason: "mixed-script" });
  });

  it("retries a recoverable local lookup error", async () => {
    const lookup = vi
      .fn<(text: string) => Promise<DictionaryEntry[]>>()
      .mockRejectedValueOnce(new Error("database temporarily unavailable"))
      .mockResolvedValueOnce([entry]);
    const controller = createController({ lookup });

    await controller.open("desire");
    expect(controller.state).toEqual({
      kind: "error",
      message: "database temporarily unavailable",
    });

    await controller.retry();

    expect(lookup).toHaveBeenCalledTimes(2);
    expect(controller.state).toEqual({
      kind: "result",
      displayText: "desire",
      entries: [entry],
    });
  });

  it("suppresses a stale lookup when the selected text changes", async () => {
    const first = deferred<DictionaryEntry[]>();
    const lookup = vi.fn((text: string) =>
      text === "first" ? first.promise : Promise.resolve([entry]),
    );
    const controller = createController({ lookup });

    const firstOpen = controller.open("first");
    await controller.open("second");
    first.resolve([]);
    await firstOpen;

    expect(controller.state).toEqual({
      kind: "result",
      displayText: "second",
      entries: [entry],
    });
  });

  it("closes by invalidating in-flight work and resetting to idle", async () => {
    const pending = deferred<DictionaryEntry[]>();
    const controller = createController({ lookup: () => pending.promise });

    const opening = controller.open("desire");
    controller.close();
    pending.resolve([entry]);
    await opening;

    expect(controller.state).toEqual({ kind: "idle" });
  });
});
