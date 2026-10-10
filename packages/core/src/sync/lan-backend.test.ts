import { afterEach, describe, expect, it, vi } from "vitest";

import { type IPlatformService, setPlatformService } from "../services/platform";
import { LANBackend } from "./lan-backend";

function installPlatformStub(service: Partial<IPlatformService>): void {
  setPlatformService(service as unknown as IPlatformService);
}

describe("LANBackend.getFileToPath", () => {
  afterEach(() => {
    setPlatformService(null as unknown as IPlatformService);
  });

  it("streams through the platform downloader with the pair code header", async () => {
    const downloadFile = vi.fn(async () => {});
    installPlatformStub({ downloadFile });

    // Trailing slash is stripped by the constructor; the request must not keep a double slash.
    const backend = new LANBackend("http://192.168.42.129:8080/", "123456", "Mobile");
    const onProgress = vi.fn();

    await backend.getFileToPath(
      "/readany/data/books/李大霄投资战略 第3版-id/李大霄投资战略 第3版.epub",
      "/tmp/book.epub",
      onProgress,
    );

    expect(downloadFile).toHaveBeenCalledTimes(1);
    expect(downloadFile).toHaveBeenCalledWith(
      "http://192.168.42.129:8080/file/readany/data/books/李大霄投资战略 第3版-id/李大霄投资战略 第3版.epub",
      "/tmp/book.epub",
      { headers: { "X-Pair-Code": "123456" }, onProgress },
    );
  });

  it("reports unsupported platforms so callers fall back to buffering", async () => {
    installPlatformStub({});

    const backend = new LANBackend("http://192.168.42.129:8080", "123456", "Mobile");

    // Must match isDirectFileTransferUnsupported() in sync-files.ts.
    await expect(backend.getFileToPath("/book.epub", "/tmp/book.epub")).rejects.toThrow(
      "Platform does not support direct file download",
    );
  });

  it("propagates download failures instead of silently succeeding", async () => {
    installPlatformStub({
      downloadFile: vi.fn(async () => {
        throw new Error("File download failed: 404");
      }),
    });

    const backend = new LANBackend("http://192.168.42.129:8080", "123456", "Mobile");

    await expect(backend.getFileToPath("/book.epub", "/tmp/book.epub")).rejects.toThrow(
      "File download failed: 404",
    );
  });
});
