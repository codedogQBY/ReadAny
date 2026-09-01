import { afterEach, describe, expect, it, vi } from "vitest";
import { type IPlatformService, setPlatformService } from "../services/platform";
import {
  buildXiaomiTTSUrl,
  fetchDashScopeTTSAudio,
  getPreloadedTTSAudio,
  isTTSAbortError,
  preloadTTSChunks,
} from "./cloud-tts";
import { DEFAULT_TTS_CONFIG, type TTSConfig, type TTSEngine } from "./types";

function configFor(engine: TTSEngine): TTSConfig {
  return {
    ...DEFAULT_TTS_CONFIG,
    engine,
    dashscopeApiKey: "dashscope-key",
    xiaomiApiKey: "xiaomi-key",
    openaiTtsApiKey: "openai-key",
  };
}

function createPlatform() {
  let socketMessage: ((data: string | ArrayBuffer) => void) | undefined;
  let socketSendCount = 0;
  const fetch = vi.fn(async (url: string) => {
    if (url.includes("dashscope")) {
      return Response.json({ output: { audio: { data: "AQID" } } });
    }
    if (url.includes("xiaomimimo")) {
      return Response.json({ choices: [{ message: { audio: { data: "BAUG" } } }] });
    }
    return new Response(new Uint8Array([7, 8, 9]).buffer);
  });
  const createWebSocket = vi.fn(async () => ({
    send: () => {
      socketSendCount += 1;
      if (socketSendCount !== 2) return;
      queueMicrotask(() => {
        socketMessage?.(new Uint8Array([0, 0, 10, 11, 12]).buffer);
        socketMessage?.("Path:turn.end\r\n\r\n");
      });
    },
    close: vi.fn(),
    onMessage: (handler: (data: string | ArrayBuffer) => void) => {
      socketMessage = handler;
    },
    onClose: vi.fn(),
    onError: vi.fn(),
  }));

  setPlatformService({ fetch, createWebSocket } as unknown as IPlatformService);
  return { fetch, createWebSocket };
}

afterEach(() => {
  setPlatformService(null as unknown as IPlatformService);
});

describe("buildXiaomiTTSUrl", () => {
  it("uses the default Xiaomi MiMo base URL", () => {
    expect(buildXiaomiTTSUrl(DEFAULT_TTS_CONFIG)).toBe(
      "https://api.xiaomimimo.com/v1/chat/completions",
    );
  });

  it("supports Xiaomi Token Plan base URL", () => {
    expect(
      buildXiaomiTTSUrl({
        xiaomiBaseUrl: "https://token-plan-cn.xiaomimimo.com/v1/",
      }),
    ).toBe("https://token-plan-cn.xiaomimimo.com/v1/chat/completions");
  });
});

describe("isTTSAbortError", () => {
  it("recognizes abort and cancellation errors from different runtimes", () => {
    expect(isTTSAbortError(new DOMException("The operation was aborted", "AbortError"))).toBe(true);
    expect(isTTSAbortError(new Error("Request cancelled"))).toBe(true);
    expect(isTTSAbortError(new Error("Request canceled"))).toBe(true);
    expect(isTTSAbortError({ code: "ERR_CANCELED", message: "canceled" })).toBe(true);
  });

  it("does not classify regular provider failures as aborts", () => {
    expect(isTTSAbortError(new Error("Xiaomi MiMo TTS failed: 400"))).toBe(false);
  });
});

describe("TTS synthesis preloading", () => {
  it("preloads every synthesizable provider and skips system voices", async () => {
    const platform = createPlatform();
    const engines: TTSEngine[] = ["edge", "dashscope", "xiaomi", "openai-compatible", "system"];

    for (const engine of engines) {
      const text = `preload-${engine}`;
      const config = configFor(engine);
      await preloadTTSChunks([text], config);
      const cached = getPreloadedTTSAudio(text, config);
      if (engine === "system") {
        expect(cached).toBeNull();
      } else {
        expect(await cached).toBeInstanceOf(Uint8Array);
      }
    }

    expect(platform.fetch).toHaveBeenCalledTimes(3);
    expect(platform.createWebSocket).toHaveBeenCalledOnce();
  });

  it("deduplicates playback requests against an in-flight preload", async () => {
    const platform = createPlatform();
    const config = configFor("dashscope");
    const text = "shared-dashscope-request";

    await Promise.all([preloadTTSChunks([text], config), fetchDashScopeTTSAudio(text, config)]);

    expect(platform.fetch).toHaveBeenCalledOnce();
  });

  it("separates cached audio when provider credentials change", async () => {
    const platform = createPlatform();
    const firstConfig = configFor("dashscope");
    const secondConfig = { ...firstConfig, dashscopeApiKey: "another-dashscope-key" };
    const text = "credential-specific-audio";

    await fetchDashScopeTTSAudio(text, firstConfig);
    await fetchDashScopeTTSAudio(text, secondConfig);

    expect(platform.fetch).toHaveBeenCalledTimes(2);
  });
});
