import { describe, expect, it } from "vitest";
import {
  buildOpenAICompatibleUrl,
  buildProviderModelsUrl,
  detectProviderFromUrl,
  ensureUrlProtocol,
  formatApiHost,
  getDefaultBaseUrl,
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
      buildProviderModelsUrl(
        "openai",
        "https://example.com/custom-endpoint",
        "sk-test",
        true,
      ),
    ).toBe("");
  });

  it("respects providers that should not auto-append /v1", () => {
    expect(resolveProviderBaseUrl("anthropic", "https://api.anthropic.com")).toBe(
      "https://api.anthropic.com",
    );
    expect(resolveProviderBaseUrl("perplexity", "https://api.perplexity.ai")).toBe(
      "https://api.perplexity.ai",
    );
    // Atlas Cloud's default base URL already includes /v1, so it must not be doubled.
    expect(resolveProviderBaseUrl("atlascloud", "https://api.atlascloud.ai/v1")).toBe(
      "https://api.atlascloud.ai/v1",
    );
  });

  it("resolves Atlas Cloud as an OpenAI-compatible provider", () => {
    expect(getDefaultBaseUrl("atlascloud")).toBe("https://api.atlascloud.ai/v1");
    expect(detectProviderFromUrl("https://api.atlascloud.ai/v1")).toBe("atlascloud");
    expect(buildProviderModelsUrl("atlascloud")).toBe("https://api.atlascloud.ai/v1/models");
    expect(buildOpenAICompatibleUrl("https://api.atlascloud.ai/v1", "chat/completions")).toBe(
      "https://api.atlascloud.ai/v1/chat/completions",
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

  describe("ensureUrlProtocol / scheme-less inputs", () => {
    it("prepends https:// when a remote URL has no scheme", () => {
      expect(ensureUrlProtocol("api.openai.com/v1")).toBe("https://api.openai.com/v1");
      expect(ensureUrlProtocol("openrouter.ai/api/v1")).toBe("https://openrouter.ai/api/v1");
    });

    it("prepends http:// for localhost / loopback hosts", () => {
      expect(ensureUrlProtocol("localhost:11434")).toBe("http://localhost:11434");
      expect(ensureUrlProtocol("127.0.0.1:8080/api")).toBe("http://127.0.0.1:8080/api");
    });

    it("leaves already-protocoled URLs alone", () => {
      expect(ensureUrlProtocol("https://api.openai.com")).toBe("https://api.openai.com");
      expect(ensureUrlProtocol("http://localhost:1234")).toBe("http://localhost:1234");
      expect(ensureUrlProtocol("  https://api.openai.com  ")).toBe("https://api.openai.com");
    });

    it("returns empty string for empty / whitespace input", () => {
      expect(ensureUrlProtocol("")).toBe("");
      expect(ensureUrlProtocol("   ")).toBe("");
    });

    it("strips leading slashes that would survive concatenation", () => {
      expect(ensureUrlProtocol("//api.example.com")).toBe("//api.example.com");
      expect(ensureUrlProtocol("/api.example.com")).toBe("https://api.example.com");
    });

    it("flows through the provider URL builders so requests escape the webview", () => {
      expect(resolveProviderBaseUrl("openai", "api.openai.com")).toBe(
        "https://api.openai.com/v1",
      );
      expect(buildProviderModelsUrl("custom", "api.example.com")).toBe(
        "https://api.example.com/v1/models",
      );
      expect(buildProviderModelsUrl("ollama", "localhost:11434")).toBe(
        "http://localhost:11434/api/tags",
      );
      expect(formatApiHost("api.openai.com")).toBe("https://api.openai.com/v1/");
    });
  });
});
