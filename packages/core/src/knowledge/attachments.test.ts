import { describe, expect, it } from "vitest";
import type { JSONValue } from "../types";
import {
  basenameFromPath,
  canonicalizeKnowledgeAttachmentImageSources,
  createKnowledgeAttachmentHash,
  createKnowledgeAttachmentUri,
  inferKnowledgeAttachmentKind,
  inferKnowledgeAttachmentMimeType,
  parseKnowledgeAttachmentUri,
  resolveKnowledgeAttachmentImageSources,
  sanitizeKnowledgeAttachmentFileName,
} from "./attachments";

describe("knowledge attachments", () => {
  it("creates and parses stable attachment URIs", () => {
    const uri = createKnowledgeAttachmentUri("att/一");
    expect(uri).toBe("readany-attachment://att%2F%E4%B8%80");
    expect(parseKnowledgeAttachmentUri(uri)).toBe("att/一");
    expect(parseKnowledgeAttachmentUri("https://example.com/image.png")).toBeUndefined();
  });

  it("normalizes file names and infers attachment metadata", () => {
    expect(basenameFromPath("/tmp/My Cover.PNG?cache=1")).toBe("My Cover.PNG");
    expect(sanitizeKnowledgeAttachmentFileName("bad:/cover?.png")).toBe("bad cover .png");
    expect(inferKnowledgeAttachmentKind("cover.png")).toBe("image");
    expect(inferKnowledgeAttachmentKind("chapter.mp3")).toBe("audio");
    expect(inferKnowledgeAttachmentKind("paper.pdf")).toBe("pdf");
    expect(inferKnowledgeAttachmentMimeType("cover.png")).toBe("image/png");
  });

  it("creates deterministic lightweight hashes for local asset identity", () => {
    expect(createKnowledgeAttachmentHash(new Uint8Array([1, 2, 3]))).toBe(
      createKnowledgeAttachmentHash(new Uint8Array([1, 2, 3])),
    );
    expect(createKnowledgeAttachmentHash(new Uint8Array([1, 2, 4]))).not.toBe(
      createKnowledgeAttachmentHash(new Uint8Array([1, 2, 3])),
    );
  });

  it("resolves image node sources from attachment ids without mutating the document", () => {
    const contentJson: JSONValue = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Before" }],
        },
        {
          type: "image",
          attrs: {
            src: "file:///other-device/cover.png",
            attachmentId: "att-1",
            alt: "Cover",
          },
        },
        {
          type: "image",
          attrs: {
            src: "file:///other-device/missing.png",
            attachmentId: "missing",
            alt: "Missing",
          },
        },
      ],
    };
    const originalJson = JSON.stringify(contentJson);

    const resolved = resolveKnowledgeAttachmentImageSources(contentJson, (attachmentId) =>
      attachmentId === "att-1" ? "asset://local/cover.png" : undefined,
    );

    expect(resolved).toEqual({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "Before" }],
        },
        {
          type: "image",
          attrs: {
            src: "asset://local/cover.png",
            attachmentId: "att-1",
            alt: "Cover",
          },
        },
        {
          type: "image",
          attrs: {
            src: "file:///other-device/missing.png",
            attachmentId: "missing",
            alt: "Missing",
          },
        },
      ],
    });
    expect(JSON.stringify(contentJson)).toBe(originalJson);
  });

  it("keeps object identity when no attachment image source changes", () => {
    const contentJson: JSONValue = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Only text" }] }],
    };

    expect(resolveKnowledgeAttachmentImageSources(contentJson, () => undefined)).toBe(contentJson);
  });

  it("resolves portable attachment image URIs when attachmentId is missing", () => {
    const contentJson: JSONValue = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src: "readany-attachment://att-portable",
            alt: "Portable",
          },
        },
      ],
    };

    expect(
      resolveKnowledgeAttachmentImageSources(contentJson, (attachmentId) =>
        attachmentId === "att-portable" ? "asset://local/portable.png" : undefined,
      ),
    ).toEqual({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src: "asset://local/portable.png",
            attachmentId: "att-portable",
            alt: "Portable",
          },
        },
      ],
    });
  });

  it("canonicalizes image attachment sources to portable attachment URIs", () => {
    const contentJson: JSONValue = {
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src: "file:///this-device/cover.png",
            attachmentId: "att-1",
            alt: "Cover",
          },
        },
        {
          type: "image",
          attrs: {
            src: "https://example.com/remote.png",
            alt: "Remote",
          },
        },
        {
          type: "image",
          attrs: {
            src: "readany-attachment://att-2",
            alt: "Already portable",
          },
        },
      ],
    };
    const originalJson = JSON.stringify(contentJson);

    expect(canonicalizeKnowledgeAttachmentImageSources(contentJson)).toEqual({
      type: "doc",
      content: [
        {
          type: "image",
          attrs: {
            src: "readany-attachment://att-1",
            attachmentId: "att-1",
            alt: "Cover",
          },
        },
        {
          type: "image",
          attrs: {
            src: "https://example.com/remote.png",
            alt: "Remote",
          },
        },
        {
          type: "image",
          attrs: {
            src: "readany-attachment://att-2",
            attachmentId: "att-2",
            alt: "Already portable",
          },
        },
      ],
    });
    expect(JSON.stringify(contentJson)).toBe(originalJson);
  });
});
