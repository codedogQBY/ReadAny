import { afterEach, describe, expect, it, vi } from "vitest";
import { buildAITranslationPrompt, microsoftTranslate, toMicrosoftLangCode } from "./providers";

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

  it("requests Simplified Chinese without an empty source language parameter", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("token"))
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ translations: [{ text: "你好" }] }]), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(microsoftTranslate(["hello"], "AUTO", "zh_Hans")).resolves.toEqual(["你好"]);

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    const requestUrl = new URL(url);
    expect(requestUrl.searchParams.get("api-version")).toBe("3.0");
    expect(requestUrl.searchParams.get("to")).toBe("zh-Hans");
    expect(requestUrl.searchParams.has("from")).toBe(false);
    expect(init.headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer token",
    });
    expect(init.body).toBe(JSON.stringify([{ Text: "hello" }]));
  });
});
