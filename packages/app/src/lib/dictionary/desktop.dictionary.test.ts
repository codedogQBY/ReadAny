import { invoke } from "@tauri-apps/api/core";
import { exists, rename } from "@tauri-apps/plugin-fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DesktopDictionaryDatabaseAdapter,
  createDesktopDictionaryPackPlatform,
} from "./desktop-dictionary";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage = (_message: unknown) => {};
  },
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  create: vi.fn(),
  exists: vi.fn(),
  rename: vi.fn(),
  mkdir: vi.fn(),
  remove: vi.fn(),
  stat: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());

describe("desktop dictionary files", () => {
  it("delegates transfer to native code and forwards bounded progress", async () => {
    let emit!: (value: unknown) => void;
    vi.mocked(invoke).mockImplementationOnce(async (_command, args) => {
      const channel = (args as { onProgress: { onmessage(value: unknown): void } }).onProgress;
      emit = channel.onmessage;
      channel.onmessage({ receivedBytes: 1, totalBytes: 3 });
      channel.onmessage({ receivedBytes: 3, totalBytes: 3 });
      return { bytes: 3, elapsedMs: 10 };
    });
    const progress = vi.fn();
    await createDesktopDictionaryPackPlatform().download(
      "https://example.com/pack",
      "pack",
      progress,
    );
    expect(invoke).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledWith(
      "dictionary_download",
      expect.objectContaining({ url: "https://example.com/pack", path: "pack" }),
    );
    expect(progress).toHaveBeenCalledWith(1 / 3);
    expect(progress).toHaveBeenLastCalledWith(1);
    const count = progress.mock.calls.length;
    emit({ receivedBytes: 1, totalBytes: 3 });
    expect(progress).toHaveBeenCalledTimes(count);
  });
  it("propagates native transfer failures", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("disk full"));
    await expect(
      createDesktopDictionaryPackPlatform().download("url", "pack", vi.fn()),
    ).rejects.toThrow("disk full");
  });
  it("does not overwrite an existing pack during promotion", async () => {
    vi.mocked(exists).mockResolvedValue(true);
    await expect(createDesktopDictionaryPackPlatform().move("staged", "active")).rejects.toThrow(
      "already exists",
    );
    expect(rename).not.toHaveBeenCalled();
  });
});

describe("desktop dictionary queries", () => {
  it("rejects a pack with the wrong language", async () => {
    vi.mocked(invoke).mockResolvedValue([
      { key: "schema_version", value: "1" },
      { key: "language", value: "zh" },
    ]);
    await expect(new DesktopDictionaryDatabaseAdapter().open("en", "pack")).rejects.toMatchObject({
      code: "pack-invalid",
    });
  });
  it("waits for active native queries before closing and rejects later queries", async () => {
    vi.mocked(invoke).mockResolvedValueOnce([
      { key: "schema_version", value: "1" },
      { key: "language", value: "en" },
    ]);
    const connection = await new DesktopDictionaryDatabaseAdapter().open("en", "pack");
    let finish!: (rows: unknown[]) => void;
    vi.mocked(invoke).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const query = connection.getAllAsync(
      "SELECT headword FROM entries WHERE headword = ?",
      "hello",
    );
    let closed = false;
    const closing = connection.closeAsync().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    expect(invoke).toHaveBeenLastCalledWith("dictionary_query", {
      path: "pack",
      query: "SELECT headword FROM entries WHERE headword = ?",
      values: ["hello"],
    });
    finish([{ headword: "hello" }]);
    await query;
    await closing;
    expect(closed).toBe(true);
    await expect(connection.getAllAsync("SELECT 1")).rejects.toThrow("closed");
  });
});
