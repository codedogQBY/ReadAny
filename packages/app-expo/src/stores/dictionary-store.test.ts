import type { DictionaryManifest } from "@readany/core/dictionary";
import { describe, expect, it, vi } from "vitest";
import * as dictionaryStoreModule from "./dictionary-store";

const { createDictionaryStore } = dictionaryStoreModule;

const manifest: DictionaryManifest = {
  manifestVersion: 1,
  packs: {
    en: {
      language: "en",
      version: "1.0.0",
      schemaVersion: 1,
      sourceEdition: "enwiktionary",
      sourceDumpDate: "2026-09-01",
      sizeBytes: 12,
      sha256: "a".repeat(64),
      url: "https://example.test/en",
      sourceArchiveUrl: "https://example.test/en-source",
      attributionUrl: "https://example.test/license",
      license: "CC BY-SA 4.0",
    },
    zh: {
      language: "zh",
      version: "1.0.0",
      schemaVersion: 1,
      sourceEdition: "zhwiktionary",
      sourceDumpDate: "2026-09-01",
      sizeBytes: 12,
      sha256: "b".repeat(64),
      url: "https://example.test/zh",
      sourceArchiveUrl: "https://example.test/zh-source",
      attributionUrl: "https://example.test/license",
      license: "CC BY-SA 4.0",
    },
  },
};

function manager() {
  return {
    refresh: vi
      .fn()
      .mockResolvedValue({ en: { state: "not-installed" }, zh: { state: "not-installed" } }),
    install: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
  };
}

function lookupService() {
  return { lookup: vi.fn().mockResolvedValue([]) };
}

describe("dictionary store", () => {
  it("completes lookup from bundled data without waiting for an in-flight remote refresh", async () => {
    let resolveRemote!: (value: DictionaryManifest) => void;
    const remote = vi.fn(
      () =>
        new Promise<DictionaryManifest>((resolve) => {
          resolveRemote = resolve;
        }),
    );
    const bundled = vi.fn().mockResolvedValue(manifest);
    const m = manager();
    const lookup = lookupService();
    const store = createDictionaryStore({
      manager: m,
      lookup,
      fetchRemoteManifest: remote,
      getBundledManifest: bundled,
    });
    let initializeFinished = false;
    const initialize = store
      .getState()
      .initialize()
      .then(() => {
        initializeFinished = true;
      });

    await expect(store.getState().lookup("desire")).resolves.toEqual([]);

    expect(initializeFinished).toBe(false);
    expect(remote).toHaveBeenCalledOnce();
    expect(bundled).toHaveBeenCalledOnce();
    expect(lookup.lookup).toHaveBeenCalledWith("desire");
    expect(m.refresh).toHaveBeenCalledTimes(1);

    resolveRemote(manifest);
    await initialize;
    expect(m.refresh).toHaveBeenCalledTimes(2);
  });

  it("starts an explicit remote refresh even when bundled lookup readiness is in flight", async () => {
    let resolveBundled!: (value: DictionaryManifest) => void;
    const bundled = vi.fn(
      () =>
        new Promise<DictionaryManifest>((resolve) => {
          resolveBundled = resolve;
        }),
    );
    const remote = vi.fn().mockResolvedValue(manifest);
    const store = createDictionaryStore({
      manager: manager(),
      lookup: lookupService(),
      fetchRemoteManifest: remote,
      getBundledManifest: bundled,
    });

    const lookup = store.getState().lookup("desire");
    await vi.waitFor(() => expect(bundled).toHaveBeenCalledOnce());
    const initialize = store.getState().initialize();

    await vi.waitFor(() => expect(remote).toHaveBeenCalledOnce());
    resolveBundled(manifest);
    await Promise.all([lookup, initialize]);
  });

  it("initializes remote-first and parses the remote value", async () => {
    const remote = vi.fn().mockResolvedValue(structuredClone(manifest));
    const bundled = vi.fn();
    const m = manager();
    const store = createDictionaryStore({
      manager: m,
      lookup: lookupService(),
      fetchRemoteManifest: remote,
      getBundledManifest: bundled,
    });

    await store.getState().initialize();

    expect(remote).toHaveBeenCalledOnce();
    expect(bundled).not.toHaveBeenCalled();
    expect(m.refresh).toHaveBeenCalledWith(manifest);
    expect(store.getState().manifest).toEqual(manifest);
  });

  it("falls back to a parsed bundled manifest when the remote value is invalid", async () => {
    const invalidRemote = { ...structuredClone(manifest), unexpected: true };
    const bundled = vi.fn().mockResolvedValue(structuredClone(manifest));
    const m = manager();
    const store = createDictionaryStore({
      manager: m,
      lookup: lookupService(),
      fetchRemoteManifest: vi.fn().mockResolvedValue(invalidRemote),
      getBundledManifest: bundled,
    });

    await store.getState().initialize();

    expect(bundled).toHaveBeenCalledOnce();
    expect(m.refresh).toHaveBeenCalledWith(manifest);
  });

  it("falls back to bundled when the remote fetch fails", async () => {
    const bundled = vi.fn().mockResolvedValue(structuredClone(manifest));
    const m = manager();
    const store = createDictionaryStore({
      manager: m,
      lookup: lookupService(),
      fetchRemoteManifest: vi.fn().mockRejectedValue(new Error("offline")),
      getBundledManifest: bundled,
    });

    await store.getState().refreshManifest();

    expect(bundled).toHaveBeenCalledOnce();
    expect(store.getState().manifest).toEqual(manifest);
  });

  it("rejects when both remote and bundled values are invalid", async () => {
    const store = createDictionaryStore({
      manager: manager(),
      lookup: lookupService(),
      fetchRemoteManifest: vi.fn().mockResolvedValue({ nope: true }),
      getBundledManifest: vi.fn().mockResolvedValue({ stillNope: true }),
    });

    await expect(store.getState().initialize()).rejects.toThrow("manifest");
  });

  it("clears a failed explicit refresh so retry performs a new remote-first attempt", async () => {
    const remote = vi.fn().mockResolvedValueOnce({ nope: true }).mockResolvedValueOnce(manifest);
    const bundled = vi.fn().mockResolvedValueOnce({ stillNope: true });
    const store = createDictionaryStore({
      manager: manager(),
      lookup: lookupService(),
      fetchRemoteManifest: remote,
      getBundledManifest: bundled,
    });

    await expect(store.getState().initialize()).rejects.toThrow("manifest");
    await expect(store.getState().retry()).resolves.toBeUndefined();

    expect(remote).toHaveBeenCalledTimes(2);
    expect(bundled).toHaveBeenCalledOnce();
  });

  it("does not hide manager refresh failures behind bundled fallback", async () => {
    const refreshError = new Error("filesystem recovery failed");
    const m = manager();
    m.refresh.mockRejectedValueOnce(refreshError);
    const bundled = vi.fn().mockResolvedValue(manifest);
    const store = createDictionaryStore({
      manager: m,
      lookup: lookupService(),
      fetchRemoteManifest: vi.fn().mockResolvedValue(manifest),
      getBundledManifest: bundled,
    });

    await expect(store.getState().initialize()).rejects.toBe(refreshError);
    expect(bundled).not.toHaveBeenCalled();
  });

  it("exposes the composed lookup service through the same store", async () => {
    const lookup = lookupService();
    lookup.lookup.mockResolvedValueOnce([
      {
        id: 1,
        language: "en",
        headword: "desire",
        partOfSpeech: "noun",
        senses: [{ order: 0, definition: "an inclination to want things" }],
      },
    ]);
    const store = createDictionaryStore({
      manager: manager(),
      lookup,
      fetchRemoteManifest: vi.fn().mockResolvedValue(manifest),
      getBundledManifest: vi.fn().mockResolvedValue(manifest),
    });

    await expect(store.getState().lookup("desire")).resolves.toMatchObject([
      { headword: "desire" },
    ]);
    expect(lookup.lookup).toHaveBeenCalledWith("desire");
  });

  it("loads only the bundled manifest before the first lookup so lookup cannot reach the network", async () => {
    const lookup = lookupService();
    lookup.lookup.mockRejectedValueOnce(
      Object.assign(new Error("English pack is not installed"), { code: "pack-not-installed" }),
    );
    const remote = vi.fn().mockResolvedValue(manifest);
    const bundled = vi.fn().mockResolvedValue(manifest);
    const m = manager();
    const store = createDictionaryStore({
      manager: m,
      lookup,
      fetchRemoteManifest: remote,
      getBundledManifest: bundled,
    });

    await expect(store.getState().lookup("desire")).rejects.toMatchObject({
      code: "pack-not-installed",
    });

    expect(remote).not.toHaveBeenCalled();
    expect(bundled).toHaveBeenCalledOnce();
    expect(m.refresh).toHaveBeenCalledWith(manifest);
    expect(store.getState().manifest).toEqual(manifest);
  });

  it("loads one shared runtime for manager operations and lookup", async () => {
    expect(dictionaryStoreModule).toHaveProperty("createRuntimeBackedDictionaryStore");
    const createRuntimeBackedDictionaryStore = Reflect.get(
      dictionaryStoreModule,
      "createRuntimeBackedDictionaryStore",
    );
    const m = manager();
    const lookup = lookupService();
    const loadRuntime = vi.fn().mockResolvedValue({ manager: m, lookup });
    const store = createRuntimeBackedDictionaryStore({
      loadRuntime,
      fetchRemoteManifest: vi.fn().mockResolvedValue(manifest),
      getBundledManifest: vi.fn().mockResolvedValue(manifest),
    });

    await store.getState().initialize();
    await store.getState().lookup("desire");
    await store.getState().remove("en");

    expect(loadRuntime).toHaveBeenCalledOnce();
    expect(m.refresh).toHaveBeenCalledWith(manifest);
    expect(lookup.lookup).toHaveBeenCalledWith("desire");
    expect(m.remove).toHaveBeenCalledWith("en");
  });

  it("clears a rejected runtime construction so Retry can construct it again", async () => {
    const m = manager();
    const lookup = lookupService();
    const loadRuntime = vi
      .fn()
      .mockRejectedValueOnce(new Error("native module unavailable"))
      .mockResolvedValueOnce({ manager: m, lookup });
    const store = dictionaryStoreModule.createRuntimeBackedDictionaryStore({
      loadRuntime,
      fetchRemoteManifest: vi.fn().mockResolvedValue(manifest),
      getBundledManifest: vi.fn().mockResolvedValue(manifest),
    });

    await expect(store.getState().initialize()).rejects.toThrow("native module unavailable");
    await expect(store.getState().retry()).resolves.toBeUndefined();

    expect(loadRuntime).toHaveBeenCalledTimes(2);
    expect(store.getState().manifest).toEqual(manifest);
  });

  it("coalesces explicit remote manifest refreshes while they are in flight", async () => {
    let resolveRemote!: (value: DictionaryManifest) => void;
    const remote = vi.fn(
      () =>
        new Promise<DictionaryManifest>((resolve) => {
          resolveRemote = resolve;
        }),
    );
    const m = manager();
    const store = createDictionaryStore({
      manager: m,
      lookup: lookupService(),
      fetchRemoteManifest: remote,
      getBundledManifest: vi.fn().mockResolvedValue(manifest),
    });

    const initialize = store.getState().initialize();
    const refresh = store.getState().refreshManifest();
    expect(remote).toHaveBeenCalledOnce();
    resolveRemote(manifest);
    await Promise.all([initialize, refresh]);

    expect(remote).toHaveBeenCalledOnce();
    expect(m.refresh).toHaveBeenCalledOnce();
  });
});
