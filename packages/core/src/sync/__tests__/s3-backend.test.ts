import type { ListObjectsCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";

import { S3Backend } from "../s3-backend";
import { normalizeS3Key, s3KeyToLogicalPath, sanitizeS3RemoteRoot } from "../s3-paths";
import type { S3Config } from "../sync-backend";

function createBackend(): S3Backend {
  const config: S3Config = {
    type: "s3",
    endpoint: "https://s3.example.com",
    region: "auto",
    bucket: "readany-test",
    accessKeyId: "access-key",
    remoteRoot: "apps/readany",
    autoSync: false,
    syncIntervalMins: 30,
    wifiOnly: false,
    notifyOnComplete: true,
  };
  return new S3Backend(config, "secret-key");
}

describe("s3-backend path helpers", () => {
  it("sanitizes the configured remote root", () => {
    expect(sanitizeS3RemoteRoot(" /ReadAny//Sync/ ")).toBe("readany/sync");
    expect(sanitizeS3RemoteRoot("readany\u0000-prod")).toBe("readany-prod");
  });

  it("maps ReadAny logical paths into the default S3 prefix", () => {
    expect(normalizeS3Key("readany", "/readany/sync/device-a.json")).toBe(
      "readany/sync/device-a.json",
    );
    expect(normalizeS3Key("readany", "sync/device-a.json")).toBe("readany/sync/device-a.json");
  });

  it("maps ReadAny logical paths into a custom S3 prefix", () => {
    expect(normalizeS3Key("/apps/readany/", "/readany/data/books/book.epub")).toBe(
      "apps/readany/data/books/book.epub",
    );
    expect(normalizeS3Key("apps/readany", "data/books/book.epub")).toBe(
      "apps/readany/data/books/book.epub",
    );
  });

  it("converts S3 keys back to ReadAny logical paths", () => {
    expect(s3KeyToLogicalPath("apps/readany", "apps/readany/sync/device-a.json")).toBe(
      "/readany/sync/device-a.json",
    );
    expect(s3KeyToLogicalPath("apps/readany", "apps/readany/data/books/")).toBe(
      "/readany/data/books",
    );
  });

  it("lists remote device snapshots under the configured S3 prefix", async () => {
    const backend = createBackend();
    const send = vi.fn(async (command: ListObjectsV2Command) => {
      expect(command.input).toMatchObject({
        Bucket: "readany-test",
        Prefix: "apps/readany/sync/",
        Delimiter: "/",
      });
      return {
        Contents: [
          { Key: "apps/readany/sync/", Size: 0 },
          {
            Key: "apps/readany/sync/device-remote.json",
            Size: "42",
            LastModified: "2026-06-02T00:00:00.000Z",
          },
        ],
      };
    });
    Object.assign(backend as unknown as { client: { send: typeof send } }, { client: { send } });

    await expect(backend.listDir("/readany/sync")).resolves.toEqual([
      {
        name: "device-remote.json",
        path: "/readany/sync/device-remote.json",
        size: 42,
        lastModified: Date.parse("2026-06-02T00:00:00.000Z"),
        isDirectory: false,
      },
    ]);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("falls back to a flat S3 list when delimiter listing returns empty", async () => {
    const backend = createBackend();
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Contents: [] })
      .mockResolvedValueOnce({
        Contents: [{ Key: "apps/readany/sync/device-remote.json", Size: 7 }],
      });
    Object.assign(backend as unknown as { client: { send: typeof send } }, { client: { send } });

    await expect(backend.listDir("/readany/sync")).resolves.toEqual([
      {
        name: "device-remote.json",
        path: "/readany/sync/device-remote.json",
        size: 7,
        lastModified: 0,
        isDirectory: false,
      },
    ]);

    expect(send).toHaveBeenCalledTimes(2);
    expect((send.mock.calls[0]?.[0] as ListObjectsV2Command).input.Delimiter).toBe("/");
    expect((send.mock.calls[1]?.[0] as ListObjectsV2Command).input.Delimiter).toBeUndefined();
  });

  it("falls back to ListObjects v1 when ListObjectsV2 returns empty", async () => {
    const backend = createBackend();
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Contents: [] })
      .mockResolvedValueOnce({ Contents: [] })
      .mockResolvedValueOnce({
        Contents: [{ Key: "apps/readany/sync/device-remote.json", Size: 9 }],
      });
    Object.assign(backend as unknown as { client: { send: typeof send } }, { client: { send } });

    await expect(backend.listDir("/readany/sync")).resolves.toEqual([
      {
        name: "device-remote.json",
        path: "/readany/sync/device-remote.json",
        size: 9,
        lastModified: 0,
        isDirectory: false,
      },
    ]);

    expect(send).toHaveBeenCalledTimes(3);
    expect((send.mock.calls[2]?.[0] as ListObjectsCommand).input.Prefix).toBe("apps/readany/sync/");
    expect((send.mock.calls[2]?.[0] as ListObjectsCommand).input.Delimiter).toBe("/");
  });

  it("can recover files by scanning the parent prefix", async () => {
    const backend = createBackend();
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Contents: [] })
      .mockResolvedValueOnce({ Contents: [] })
      .mockResolvedValueOnce({ Contents: [] })
      .mockResolvedValueOnce({ Contents: [] })
      .mockResolvedValueOnce({
        Contents: [
          { Key: "apps/readany/data/file-manifest.json", Size: 100 },
          { Key: "apps/readany/sync/device-remote.json", Size: 11 },
        ],
      });
    Object.assign(backend as unknown as { client: { send: typeof send } }, { client: { send } });

    await expect(backend.listDir("/readany/sync")).resolves.toEqual([
      {
        name: "device-remote.json",
        path: "/readany/sync/device-remote.json",
        size: 11,
        lastModified: 0,
        isDirectory: false,
      },
    ]);

    expect(send).toHaveBeenCalledTimes(5);
    expect((send.mock.calls[4]?.[0] as ListObjectsV2Command).input.Prefix).toBe("apps/readany/");
    expect((send.mock.calls[4]?.[0] as ListObjectsV2Command).input.Delimiter).toBeUndefined();
  });

  it("continues S3 list fallbacks after a provider-specific list error", async () => {
    const backend = createBackend();
    const send = vi
      .fn()
      .mockResolvedValueOnce({ Contents: [] })
      .mockResolvedValueOnce({ Contents: [] })
      .mockRejectedValueOnce(new Error("The specified key does not exist"))
      .mockRejectedValueOnce(new Error("The specified key does not exist"))
      .mockResolvedValueOnce({
        Contents: [
          { Key: "apps/readany/data/file-manifest.json", Size: 100 },
          { Key: "apps/readany/sync/device-remote.json", Size: 13 },
        ],
      });
    Object.assign(backend as unknown as { client: { send: typeof send } }, { client: { send } });

    await expect(backend.listDir("/readany/sync")).resolves.toEqual([
      {
        name: "device-remote.json",
        path: "/readany/sync/device-remote.json",
        size: 13,
        lastModified: 0,
        isDirectory: false,
      },
    ]);

    expect(send).toHaveBeenCalledTimes(5);
    expect((send.mock.calls[4]?.[0] as ListObjectsV2Command).input.Prefix).toBe("apps/readany/");
    expect((send.mock.calls[4]?.[0] as ListObjectsV2Command).input.Delimiter).toBeUndefined();
  });
});
