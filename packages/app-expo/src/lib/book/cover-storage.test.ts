import { beforeEach, describe, expect, it, vi } from "vitest";

const platform = vi.hoisted(() => ({
  getAppDataDir: vi.fn(async () => "/app"),
  joinPath: vi.fn(async (...parts: string[]) => parts.join("/")),
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  deleteFile: vi.fn(async () => undefined),
}));

vi.mock("@readany/core/services", () => ({ getPlatformService: () => platform }));
import * as coverStorage from "./cover-storage";

describe("mobile cover file extensions", () => {
  const getCoverFileExtension = (
    coverStorage as typeof coverStorage & {
      getCoverFileExtension?: (bytes: Uint8Array, mimeType?: string | null) => string;
    }
  ).getCoverFileExtension;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps recognized image MIME types", () => {
    expect(getCoverFileExtension).toBeTypeOf("function");
    if (!getCoverFileExtension) return;

    expect(getCoverFileExtension(new Uint8Array(), "image/webp")).toBe("webp");
    expect(getCoverFileExtension(new Uint8Array(), "image/gif")).toBe("gif");
    expect(getCoverFileExtension(new Uint8Array(), "image/png")).toBe("png");
    expect(getCoverFileExtension(new Uint8Array(), "image/jpeg")).toBe("jpg");
  });

  it("sniffs image bytes when the MIME type is absent", () => {
    expect(getCoverFileExtension).toBeTypeOf("function");
    if (!getCoverFileExtension) return;

    expect(
      getCoverFileExtension(
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
      ),
    ).toBe("webp");
    expect(getCoverFileExtension(new TextEncoder().encode("GIF89a"))).toBe("gif");
    expect(
      getCoverFileExtension(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    ).toBe("png");
    expect(getCoverFileExtension(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpg");
  });

  it("deletes only a newly extracted cover when a custom cover wins during persistence", async () => {
    const saveExtractedCoverIfStillMissing = (
      coverStorage as typeof coverStorage & {
        saveExtractedCoverIfStillMissing?: (
          bookId: string,
          bytes: Uint8Array,
          mimeType: string | null,
          getCurrentCoverUrl: () => string | undefined,
        ) => Promise<string | undefined>;
      }
    ).saveExtractedCoverIfStillMissing;
    expect(saveExtractedCoverIfStillMissing).toBeTypeOf("function");
    if (!saveExtractedCoverIfStillMissing) return;

    let currentCoverUrl = "";
    platform.writeFile.mockImplementationOnce(async () => {
      currentCoverUrl = "covers/book-custom-user.webp";
    });

    await expect(
      saveExtractedCoverIfStillMissing(
        "book",
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
        null,
        () => currentCoverUrl,
      ),
    ).resolves.toBeUndefined();
    expect(platform.deleteFile).toHaveBeenCalledWith("/app/covers/book.webp");
    expect(platform.deleteFile).not.toHaveBeenCalledWith("/app/covers/book-custom-user.webp");
  });

  it("cleans an extracted cover when custom selection completes after persistence", async () => {
    const commitCustomCover = (
      coverStorage as typeof coverStorage & {
        commitCustomCover?: (
          bookId: string,
          customCoverUrl: string,
          persist: (coverUrl: string) => Promise<void>,
        ) => Promise<void>;
      }
    ).commitCustomCover;
    expect(commitCustomCover).toBeTypeOf("function");
    if (!commitCustomCover) return;

    await expect(
      coverStorage.saveExtractedCoverIfStillMissing(
        "book",
        new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
        null,
        () => "",
      ),
    ).resolves.toBe("covers/book.webp");

    const persisted: string[] = [];
    await commitCustomCover("book", "covers/book-custom-user.png", async (coverUrl) => {
      persisted.push(coverUrl);
    });

    expect(persisted).toEqual(["covers/book-custom-user.png"]);
    expect(platform.deleteFile).toHaveBeenCalledWith("/app/covers/book.webp");
    expect(platform.deleteFile).not.toHaveBeenCalledWith("/app/covers/book-custom-user.png");
  });
});
