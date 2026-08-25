import { beforeEach, describe, expect, it, vi } from "vitest";

const fs = vi.hoisted(() => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
}));

vi.mock("@/lib/storage/desktop-library-root", () => ({
  getDesktopLibraryRoot: vi.fn(async () => "C:/library"),
}));
vi.mock("@tauri-apps/plugin-fs", () => fs);
vi.mock("@tauri-apps/api/path", () => ({
  join: vi.fn(async (...parts: string[]) => parts.join("/")),
}));

import * as coverStorage from "./cover-storage";

describe("desktop cover file extensions", () => {
  const getCoverFileExtension = (
    coverStorage as typeof coverStorage & {
      getCoverFileExtension?: (blob: Blob) => Promise<string>;
    }
  ).getCoverFileExtension;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps recognized image MIME types", async () => {
    expect(getCoverFileExtension).toBeTypeOf("function");
    if (!getCoverFileExtension) return;

    await expect(getCoverFileExtension(new Blob([], { type: "image/webp" }))).resolves.toBe("webp");
    await expect(getCoverFileExtension(new Blob([], { type: "image/gif" }))).resolves.toBe("gif");
    await expect(getCoverFileExtension(new Blob([], { type: "image/png" }))).resolves.toBe("png");
    await expect(getCoverFileExtension(new Blob([], { type: "image/jpeg" }))).resolves.toBe("jpg");
  });

  it("sniffs image bytes when the MIME type is absent", async () => {
    expect(getCoverFileExtension).toBeTypeOf("function");
    if (!getCoverFileExtension) return;

    await expect(
      getCoverFileExtension(
        new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])]),
      ),
    ).resolves.toBe("webp");
    await expect(
      getCoverFileExtension(new Blob([new TextEncoder().encode("GIF89a")])),
    ).resolves.toBe("gif");
    await expect(
      getCoverFileExtension(
        new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]),
      ),
    ).resolves.toBe("png");
    await expect(
      getCoverFileExtension(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])])),
    ).resolves.toBe("jpg");
  });

  it("removes only a newly extracted cover when a custom cover wins during persistence", async () => {
    const saveExtractedCoverIfStillMissing = (
      coverStorage as typeof coverStorage & {
        saveExtractedCoverIfStillMissing?: (
          bookId: string,
          blob: Blob,
          getCurrentCoverUrl: () => string | undefined,
        ) => Promise<string | undefined>;
      }
    ).saveExtractedCoverIfStillMissing;
    expect(saveExtractedCoverIfStillMissing).toBeTypeOf("function");
    if (!saveExtractedCoverIfStillMissing) return;

    let currentCoverUrl = "";
    fs.writeFile.mockImplementationOnce(async () => {
      currentCoverUrl = "covers/book-custom-user.webp";
    });

    await expect(
      saveExtractedCoverIfStillMissing(
        "book",
        new Blob([new Uint8Array([1])], { type: "image/webp" }),
        () => currentCoverUrl,
      ),
    ).resolves.toBeUndefined();
    expect(fs.remove).toHaveBeenCalledWith("C:/library/covers/book.webp");
    expect(fs.remove).not.toHaveBeenCalledWith("C:/library/covers/book-custom-user.webp");
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
        new Blob([new Uint8Array([1])], { type: "image/webp" }),
        () => "",
      ),
    ).resolves.toBe("covers/book.webp");

    const persisted: string[] = [];
    await commitCustomCover("book", "covers/book-custom-user.png", async (coverUrl) => {
      persisted.push(coverUrl);
    });

    expect(persisted).toEqual(["covers/book-custom-user.png"]);
    expect(fs.remove).toHaveBeenCalledWith("C:/library/covers/book.webp");
    expect(fs.remove).not.toHaveBeenCalledWith("C:/library/covers/book-custom-user.png");
  });
});
