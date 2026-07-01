import { describe, expect, it } from "vitest";
import {
  createObsidianNewUri,
  createObsidianOpenUri,
  createObsidianSearchUri,
  createObsidianVaultFileOpenUri,
  inferObsidianVaultNameFromPath,
  joinObsidianVaultFilePath,
} from "./obsidian-uri";

describe("obsidian URI helpers", () => {
  it("builds open URIs with encoded vault and file paths", () => {
    expect(
      createObsidianOpenUri({
        vault: "ReadAny Vault",
        file: "Books/燃火#摘录",
        paneType: "tab",
      }),
    ).toBe("obsidian://open?vault=ReadAny%20Vault&file=Books%2F%E7%87%83%E7%81%AB%23%E6%91%98%E5%BD%95&paneType=tab");
  });

  it("lets absolute paths override vault and file parameters", () => {
    expect(
      createObsidianOpenUri({
        vault: "Ignored",
        file: "Ignored.md",
        path: "/Users/me/ReadAny/Notes/My Note.md",
      }),
    ).toBe("obsidian://open?path=%2FUsers%2Fme%2FReadAny%2FNotes%2FMy%20Note.md");
  });

  it("builds new-note append URIs without hand-written query strings", () => {
    expect(
      createObsidianNewUri({
        vault: "ReadAny",
        file: "Inbox/Capture.md",
        content: "A captured idea",
        append: true,
        silent: true,
      }),
    ).toBe(
      "obsidian://new?vault=ReadAny&file=Inbox%2FCapture.md&content=A%20captured%20idea&append=true&silent=true",
    );
  });

  it("builds search URIs scoped to a vault", () => {
    expect(createObsidianSearchUri({ vault: "ReadAny Vault", query: "燃火" })).toBe(
      "obsidian://search?vault=ReadAny%20Vault&query=%E7%87%83%E7%81%AB",
    );
  });

  it("opens exported vault files by absolute path", () => {
    expect(
      createObsidianVaultFileOpenUri({
        rootPath: "/Users/me/ReadAny",
        relativePath: "Notes/My Note.md",
        paneType: "split",
      }),
    ).toBe(
      "obsidian://open?path=%2FUsers%2Fme%2FReadAny%2FNotes%2FMy%20Note.md&paneType=split",
    );
  });

  it("preserves Windows-style vault paths when joining exported files", () => {
    expect(joinObsidianVaultFilePath("C:\\Users\\me\\ReadAny", "Notes\\My Note.md")).toBe(
      "C:\\Users\\me\\ReadAny\\Notes\\My Note.md",
    );
  });

  it("infers a vault name fallback from the selected folder", () => {
    expect(inferObsidianVaultNameFromPath("/Users/me/ReadAny Vault/")).toBe("ReadAny Vault");
  });
});

