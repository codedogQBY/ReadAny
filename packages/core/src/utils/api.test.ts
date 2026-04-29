import { describe, expect, it } from "vitest";
import {
  buildOpenAICompatibleUrl,
  buildProviderModelsUrl,
  providerSupportsExactRequestUrl,
  resolveProviderBaseUrl,
} from "./api";

describe("AI API URL helpers", () => {
  it("appends /v1 for OpenAI-compatible root URLs", () => {
    expect(resolveProviderBaseUrl("openai", "https://api.openai.com")).toBe(
      "https://api.openai.com/v1",
    );
    expect(resolveProviderBaseUrl("lmstudio", "http://localhost:1234")).toBe(
      "http://localhost:1234/v1",
    );
  });

  it("strips console-like dashboard paths before appending /v1", () => {
    expect(resolveProviderBaseUrl("openai", "https://elysiver.h-e.top/console")).toBe(
      "https://elysiver.h-e.top/v1",
    );
    expect(resolveProviderBaseUrl("custom", "https://example.com/proxy/console")).toBe(
      "https://example.com/proxy/v1",
    );
    expect(buildProviderModelsUrl("openai", "https://elysiver.h-e.top/console")).toBe(
      "https://elysiver.h-e.top/v1/models",
    );
  });

  it("keeps custom paths as-is when the URL ends with a slash", () => {
    expect(resolveProviderBaseUrl("custom", "https://example.com/api/")).toBe(
      "https://example.com/api",
    );
    expect(buildOpenAICompatibleUrl("https://example.com/api/res/", "chat/completions")).toBe(
      "https://example.com/api/res/chat/completions",
    );
  });

  it("supports exact request URLs for OpenAI-compatible providers", () => {
    expect(providerSupportsExactRequestUrl("openai")).toBe(true);
    expect(resolveProviderBaseUrl("openai", "https://example.com/custom-endpoint", true)).toBe(
      "https://example.com/custom-endpoint",
    );
    expect(
      buildOpenAICompatibleUrl(
        "https://example.com/custom-endpoint",
        "chat/completions",
        "https://api.openai.com",
        true,
      ),
    ).toBe("https://example.com/custom-endpoint");
    expect(
      buildProviderModelsUrl("openai", "https://example.com/custom-endpoint", "sk-test", true),
    ).toBe("");
  });

  it("respects providers that should not auto-append /v1", () => {
    expect(resolveProviderBaseUrl("anthropic", "https://api.anthropic.com")).toBe(
      "https://api.anthropic.com",
    );
    expect(resolveProviderBaseUrl("perplexity", "https://api.perplexity.ai")).toBe(
      "https://api.perplexity.ai",
    );
  });

  it("builds provider-specific model listing URLs", () => {
    expect(buildProviderModelsUrl("openai", "https://api.openai.com")).toBe(
      "https://api.openai.com/v1/models",
    );
    expect(buildProviderModelsUrl("ollama", "http://localhost:11434")).toBe(
      "http://localhost:11434/api/tags",
    );
    expect(
      buildProviderModelsUrl("google", "https://generativelanguage.googleapis.com", "AIza-test"),
    ).toBe("https://generativelanguage.googleapis.com/v1beta/models?key=AIza-test");
  });
});
