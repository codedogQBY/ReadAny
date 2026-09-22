import { afterEach, describe, expect, it, vi } from "vitest";

import { setPlatformService } from "../services/platform";
import {
  buildVoxCPMTTSUrl,
  buildXiaomiTTSUrl,
  fetchVoxCPMAudio,
  isTTSAbortError,
} from "./cloud-tts";
import { DEFAULT_TTS_CONFIG } from "./types";

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
    expect(isTTSAbortError(new DOMException("The operation was aborted", "AbortError"))).toBe(
      true,
    );
    expect(isTTSAbortError(new Error("Request cancelled"))).toBe(true);
    expect(isTTSAbortError(new Error("Request canceled"))).toBe(true);
    expect(isTTSAbortError({ code: "ERR_CANCELED", message: "canceled" })).toBe(true);
  });

  it("does not classify regular provider failures as aborts", () => {
    expect(isTTSAbortError(new Error("Xiaomi MiMo TTS failed: 400"))).toBe(false);
  });
});

describe("buildVoxCPMTTSUrl", () => {
  it("defaults to a locally served VoxCPM", () => {
    expect(buildVoxCPMTTSUrl(DEFAULT_TTS_CONFIG)).toBe("http://localhost:8000/v1/audio/speech");
  });

  it("tolerates a trailing slash on the base URL", () => {
    expect(buildVoxCPMTTSUrl({ voxcpmBaseUrl: "https://tts.example.com/v1/" })).toBe(
      "https://tts.example.com/v1/audio/speech",
    );
  });
});

describe("fetchVoxCPMAudio", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function stubPlatform() {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    }));
    setPlatformService({ fetch: fetchMock } as never);
    return fetchMock;
  }

  it("posts the OpenAI audio/speech shape and omits auth when no key is set", async () => {
    const fetchMock = stubPlatform();

    const bytes = await fetchVoxCPMAudio("Hello", DEFAULT_TTS_CONFIG);

    expect(Array.from(bytes)).toEqual([1, 2, 3]);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://localhost:8000/v1/audio/speech");
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual({
      model: "openbmb/VoxCPM2",
      input: "Hello",
      voice: "default",
      response_format: "wav",
    });
  });

  it("sends a bearer token only when a key is configured", async () => {
    const fetchMock = stubPlatform();

    await fetchVoxCPMAudio("Hello", { ...DEFAULT_TTS_CONFIG, voxcpmApiKey: "k-1" });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer k-1");
  });

  it("forwards an abort signal so stop() can cancel an in-flight request", async () => {
    // The buffered player aborts its controller on stop(). Before this was
    // threaded through, that abort reached nothing and a second play stacked
    // a concurrent request on top of the first.
    const fetchMock = stubPlatform();
    const controller = new AbortController();

    await fetchVoxCPMAudio("Hello", DEFAULT_TTS_CONFIG, controller.signal);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it("prefixes the Voice Design description onto the input text", async () => {
    const fetchMock = stubPlatform();

    await fetchVoxCPMAudio("你好", {
      ...DEFAULT_TTS_CONFIG,
      voxcpmVoiceDesign: "年轻女声，温柔亲切",
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).input).toBe("(年轻女声，温柔亲切)你好");
  });
});
