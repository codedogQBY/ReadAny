import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAITranslationPrompt, googleTranslate, toMicrosoftLangCode } from "./providers";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("buildAITranslationPrompt", () => {
  it("asks AI to translate classical Chinese into modern vernacular Chinese", () => {
    const prompt = buildAITranslationPrompt("AUTO", "zh-CN");

    expect(prompt).toContain("Classical/Literary Chinese");
    expect(prompt).toContain("modern vernacular Simplified Chinese");
    expect(prompt).toContain("学而不思则罔，思而不学则殆");
    expect(prompt).toContain("not the original sentence");
    expect(prompt).toContain("Do not mention source, author, title");
    expect(prompt).toContain("most likely modern meaning in context");
  });

  it("keeps numbered output requirements for batch translation", () => {
    const prompt = buildAITranslationPrompt("AUTO", "zh-CN", { numbered: true });

    expect(prompt).toContain('keep the same numbering format "N. translation"');
    expect(prompt).toContain("Do not add any explanation");
  });
});

describe("Microsoft translator", () => {
  it("normalizes Chinese language variants to Microsoft script codes", () => {
    expect(toMicrosoftLangCode("zh-CN")).toBe("zh-Hans");
    expect(toMicrosoftLangCode("zh-cn")).toBe("zh-Hans");
    expect(toMicrosoftLangCode("zh_Hans")).toBe("zh-Hans");
    expect(toMicrosoftLangCode("zh")).toBe("zh-Hans");
    expect(toMicrosoftLangCode("zh-TW")).toBe("zh-Hant");
    expect(toMicrosoftLangCode("zh_hant")).toBe("zh-Hant");
    expect(toMicrosoftLangCode("ja")).toBe("ja");
  });

  it("uses the keyless Google endpoint and parses translation segments", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(
      new Response(JSON.stringify([[["你好", "hello"]], null, "en"]), {
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(googleTranslate(["hello"], "AUTO", "zh-CN")).resolves.toEqual(["你好"]);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const requestUrl = new URL(url);
    expect(requestUrl.hostname).toBe("translate.googleapis.com");
    expect(requestUrl.searchParams.get("sl")).toBe("auto");
    expect(requestUrl.searchParams.get("tl")).toBe("zh-cn");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
