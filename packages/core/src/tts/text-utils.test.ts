import { describe, expect, it } from "vitest";
import { splitNarrationText } from "./display";
import { cleanText, hasSpeakableText, isTTSFootnoteMarker } from "./text-utils";

describe("TTS text utils", () => {
  it("removes numeric footnote markers from narration text", () => {
    expect(cleanText("她听了这话[12]，便不再言语。")).toBe("她听了这话，便不再言语。");
    expect(cleanText("This sentence[3] keeps flowing.")).toBe("This sentence keeps flowing.");
    expect(cleanText("这一段（45）仍然应当连续朗读。")).toBe("这一段仍然应当连续朗读。");
  });

  it("removes Chinese numeral footnote markers from narration text", () => {
    expect(cleanText("宝玉听了[十二]，忙回头看。")).toBe("宝玉听了，忙回头看。");
    expect(cleanText("此处另有注释［二十三］，不应读出。")).toBe("此处另有注释，不应读出。");
    expect(cleanText("他又看了一眼【一】才明白。")).toBe("他又看了一眼才明白。");
  });

  it("detects standalone footnote marker text nodes", () => {
    expect(isTTSFootnoteMarker("[十二]")).toBe(true);
    expect(isTTSFootnoteMarker("［23］")).toBe(true);
    expect(isTTSFootnoteMarker("（四）")).toBe(true);
    expect(isTTSFootnoteMarker("正文[十二]")).toBe(false);
  });

  it("does not emit narration chunks containing only punctuation", () => {
    expect(hasSpeakableText("……")).toBe(false);
    expect(hasSpeakableText("。！？")).toBe(false);
    expect(hasSpeakableText("许七安……")).toBe(true);
    expect(splitNarrationText("许七安说。……下一句。")).toEqual(["许七安说。", "下一句。"]);
  });
});
