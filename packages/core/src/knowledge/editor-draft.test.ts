import { beforeEach, describe, expect, it } from "vitest";
import { type IPlatformService, setPlatformService } from "../services/platform";
import {
  clearKnowledgeEditorDraft,
  createKnowledgeEditorDraftKey,
  isKnowledgeEditorDraftRestorable,
  knowledgeEditorDraftFingerprint,
  loadKnowledgeEditorDraft,
  saveKnowledgeEditorDraft,
} from "./editor-draft";

function createTestPlatform(files = new Map<string, string>()): IPlatformService {
  return {
    platformType: "mobile",
    isMobile: true,
    isDesktop: false,
    readFile: async (path) => new TextEncoder().encode(files.get(path) ?? ""),
    writeFile: async (path, data) => {
      files.set(path, new TextDecoder().decode(data));
    },
    writeTextFile: async (path, content) => {
      files.set(path, content);
    },
    readTextFile: async (path) => {
      if (!files.has(path)) throw new Error(`Missing file: ${path}`);
      return files.get(path) ?? "";
    },
    mkdir: async () => {},
    exists: async (path) => files.has(path),
    deleteFile: async (path) => {
      files.delete(path);
    },
    getAppDataDir: async () => "/tmp/readany",
    getDataDir: async () => "/tmp/readany",
    joinPath: async (...parts) => parts.join("/").replace(/\/+/g, "/"),
    convertFileSrc: (path) => path,
    pickFile: async () => null,
    loadDatabase: async () => {
      throw new Error("Database is not available in draft tests");
    },
    fetch: async (url, options) => fetch(url, options),
    createWebSocket: async () => {
      throw new Error("WebSocket is not available in draft tests");
    },
    getAppVersion: async () => "0.0.0-test",
    kvGetItem: async () => null,
    kvSetItem: async () => {},
    kvRemoveItem: async () => {},
    kvGetAllKeys: async () => [],
    copyToClipboard: async () => {},
    shareOrDownloadFile: async () => null,
  };
}

describe("knowledge editor drafts", () => {
  beforeEach(() => {
    setPlatformService(createTestPlatform());
  });

  it("builds stable draft keys by document and scope", () => {
    expect(createKnowledgeEditorDraftKey("doc-1", "mobile")).toBe("mobile:doc-1");
    expect(createKnowledgeEditorDraftKey("doc-1")).toBe("knowledge:doc-1");
  });

  it("saves, loads, and clears draft files", async () => {
    const key = createKnowledgeEditorDraftKey("doc-1", "mobile");
    const value = {
      contentJson: { type: "doc", content: [{ type: "paragraph" }] },
      contentMd: "Draft text",
      plainText: "Draft text",
    };

    const saved = await saveKnowledgeEditorDraft(key, value, {
      baseFingerprint: "base",
      updatedAt: 1_000,
    });
    const loaded = await loadKnowledgeEditorDraft(key);

    expect(loaded).toEqual(saved);
    expect(loaded?.baseFingerprint).toBe("base");
    expect(loaded?.contentFingerprint).toBe(knowledgeEditorDraftFingerprint(value.contentJson));

    await clearKnowledgeEditorDraft(key);
    expect(await loadKnowledgeEditorDraft(key)).toBeNull();
  });

  it("keeps desktop and mobile drafts isolated for the same document", async () => {
    const mobileKey = createKnowledgeEditorDraftKey("doc-shared", "mobile");
    const desktopKey = createKnowledgeEditorDraftKey("doc-shared", "desktop");

    await saveKnowledgeEditorDraft(
      mobileKey,
      {
        contentJson: { type: "doc", content: [{ type: "paragraph", attrs: { source: "mobile" } }] },
        contentMd: "Mobile draft",
        plainText: "Mobile draft",
      },
      { baseFingerprint: "base-mobile", updatedAt: 2_000 },
    );
    await saveKnowledgeEditorDraft(
      desktopKey,
      {
        contentJson: {
          type: "doc",
          content: [{ type: "paragraph", attrs: { source: "desktop" } }],
        },
        contentMd: "Desktop draft",
        plainText: "Desktop draft",
      },
      { baseFingerprint: "base-desktop", updatedAt: 3_000 },
    );

    expect(await loadKnowledgeEditorDraft(mobileKey)).toMatchObject({
      key: mobileKey,
      baseFingerprint: "base-mobile",
      value: { contentMd: "Mobile draft" },
    });
    expect(await loadKnowledgeEditorDraft(desktopKey)).toMatchObject({
      key: desktopKey,
      baseFingerprint: "base-desktop",
      value: { contentMd: "Desktop draft" },
    });
  });

  it("offers only fresh drafts that differ from the current document", async () => {
    const draft = await saveKnowledgeEditorDraft(
      createKnowledgeEditorDraftKey("doc-2", "mobile"),
      {
        contentJson: { type: "doc", content: [{ type: "paragraph", attrs: { id: "draft" } }] },
        contentMd: "Draft",
        plainText: "Draft",
      },
      { updatedAt: 10_000 },
    );

    expect(isKnowledgeEditorDraftRestorable(draft, "current", 10_100)).toBe(true);
    expect(isKnowledgeEditorDraftRestorable(draft, draft.contentFingerprint, 10_100)).toBe(false);
    expect(
      isKnowledgeEditorDraftRestorable(draft, "current", 10_000 + 8 * 24 * 60 * 60 * 1000),
    ).toBe(false);
  });
});
