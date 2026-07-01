import { describe, expect, it } from "vitest";
import {
  KNOWLEDGE_MOBILE_EDITOR_MAX_HEIGHT,
  KNOWLEDGE_MOBILE_EDITOR_MIN_HEIGHT,
  clampKnowledgeEditorBridgeHeight,
  isKnowledgeEditorBridgeJsonValue,
  parseKnowledgeEditorBridgeMessage,
} from "./mobile-editor-bridge";

describe("mobile knowledge editor bridge", () => {
  it("parses typed bridge messages from the WebView", () => {
    expect(
      parseKnowledgeEditorBridgeMessage(
        JSON.stringify({
          type: "selectionChanged",
          marks: { bold: true, taskList: true },
          linkHref: "https://example.com",
          headingLevel: 2,
          canUndo: true,
          canRedo: false,
        }),
      ),
    ).toEqual({
      message: {
        type: "selectionChanged",
        marks: { bold: true, taskList: true },
        linkHref: "https://example.com",
        headingLevel: 2,
        canUndo: true,
        canRedo: false,
      },
    });
  });

  it("surfaces malformed bridge payloads as explicit parse errors", () => {
    expect(parseKnowledgeEditorBridgeMessage("{not-json")).toEqual({
      message: null,
      error: "invalid_json",
    });
    expect(parseKnowledgeEditorBridgeMessage(JSON.stringify({ contentJson: { type: "doc" } })))
      .toEqual({
        message: null,
        error: "missing_type",
      });
  });

  it("accepts only JSON-safe editor content from contentChanged messages", () => {
    expect(
      isKnowledgeEditorBridgeJsonValue({
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Safe content" }],
          },
        ],
      }),
    ).toBe(true);

    expect(isKnowledgeEditorBridgeJsonValue({ type: "doc", toJSON: () => "not-data" })).toBe(
      false,
    );
    expect(isKnowledgeEditorBridgeJsonValue({ type: "doc", nested: undefined })).toBe(false);
  });

  it("clamps editor height to mobile-safe bounds", () => {
    expect(clampKnowledgeEditorBridgeHeight(1)).toBe(KNOWLEDGE_MOBILE_EDITOR_MIN_HEIGHT);
    expect(clampKnowledgeEditorBridgeHeight(320.2)).toBe(321);
    expect(clampKnowledgeEditorBridgeHeight(9999)).toBe(KNOWLEDGE_MOBILE_EDITOR_MAX_HEIGHT);
  });
});
