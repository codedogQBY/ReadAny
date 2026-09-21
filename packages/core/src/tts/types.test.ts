import { describe, expect, it } from "vitest";

import {
  DEFAULT_XIAOMI_TTS_VOICE,
  XIAOMI_TTS_VOICES,
  buildVoxCPMInput,
  normalizeTTSConfig,
  normalizeTTSEngine,
} from "./types";

describe("normalizeTTSConfig", () => {
  it("preserves persisted default profile settings", () => {
    const config = normalizeTTSConfig({
      engine: "openai-compatible",
      activeProfileId: "openai-compatible-default",
      profiles: [
        {
          id: "openai-compatible-default",
          name: "Custom OpenAI TTS",
          provider: "openai-compatible",
          baseUrl: "https://example.com/v1",
          apiKey: "secret-key",
          endpoint: "chat-completions",
          model: "custom-tts",
          voice: "reader",
          format: "wav",
          stylePrompt: "Read calmly.",
        },
      ],
    });

    expect(config.openaiTtsBaseUrl).toBe("https://example.com/v1");
    expect(config.openaiTtsApiKey).toBe("secret-key");
    expect(config.openaiTtsEndpoint).toBe("chat-completions");
    expect(config.openaiTtsModel).toBe("custom-tts");
    expect(config.openaiTtsVoice).toBe("reader");
    expect(config.openaiTtsFormat).toBe("wav");
    expect(config.openaiTtsStylePrompt).toBe("Read calmly.");
  });

  it("preserves Xiaomi profile base URL settings", () => {
    const config = normalizeTTSConfig({
      engine: "xiaomi",
      activeProfileId: "xiaomi-mimo-default",
      profiles: [
        {
          id: "xiaomi-mimo-default",
          name: "Xiaomi Token Plan",
          provider: "xiaomi",
          baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
          apiKey: "tp-secret",
          voice: "冰糖",
          model: "mimo-v2.5-tts",
          format: "pcm16",
          stylePrompt: "Read softly.",
        },
      ],
    });

    expect(config.xiaomiBaseUrl).toBe("https://token-plan-cn.xiaomimimo.com/v1");
    expect(config.xiaomiApiKey).toBe("tp-secret");
    expect(config.xiaomiVoice).toBe("冰糖");
    expect(config.xiaomiStylePrompt).toBe("Read softly.");
  });

  it("falls back from removed Xiaomi voice IDs", () => {
    const config = normalizeTTSConfig({
      engine: "xiaomi",
      xiaomiVoice: "Ethan",
      activeProfileId: "xiaomi-mimo-default",
      profiles: [
        {
          id: "xiaomi-mimo-default",
          name: "Xiaomi MiMo",
          provider: "xiaomi",
          voice: "Serena",
        },
      ],
    });

    expect(config.xiaomiVoice).toBe(DEFAULT_XIAOMI_TTS_VOICE);
    expect(config.profiles.find((profile) => profile.id === "xiaomi-mimo-default")?.voice).toBe(
      DEFAULT_XIAOMI_TTS_VOICE,
    );
  });

  it("matches Xiaomi MiMo V2.5 preset voices", () => {
    expect(XIAOMI_TTS_VOICES.map((voice) => voice.id)).toEqual([
      "mimo_default",
      "冰糖",
      "茉莉",
      "苏打",
      "白桦",
      "Mia",
      "Chloe",
      "Milo",
      "Dean",
    ]);
  });
});

describe("VoxCPM provider", () => {
  it("keeps voxcpm as a known engine instead of falling back to edge", () => {
    expect(normalizeTTSEngine("voxcpm")).toBe("voxcpm");
    expect(normalizeTTSEngine("not-a-real-engine")).toBe("edge");
  });

  it("ships a default VoxCPM profile pointing at a local server", () => {
    const config = normalizeTTSConfig({ engine: "voxcpm" });

    expect(config.activeProfileId).toBe("voxcpm-default");
    expect(config.voxcpmBaseUrl).toBe("http://localhost:8000/v1");
    expect(config.voxcpmModel).toBe("openbmb/VoxCPM2");
    expect(config.voxcpmApiKey).toBe("");
    expect(config.voxcpmFormat).toBe("wav");
  });

  it("restores persisted VoxCPM profile settings onto the flat config", () => {
    const config = normalizeTTSConfig({
      engine: "voxcpm",
      activeProfileId: "voxcpm-default",
      profiles: [
        {
          id: "voxcpm-default",
          name: "VoxCPM",
          provider: "voxcpm",
          baseUrl: "http://192.168.1.9:8000/v1",
          model: "openbmb/VoxCPM1.5",
          voice: "narrator",
          format: "mp3",
          stylePrompt: "a calm older man",
        },
      ],
    });

    expect(config.voxcpmBaseUrl).toBe("http://192.168.1.9:8000/v1");
    expect(config.voxcpmModel).toBe("openbmb/VoxCPM1.5");
    expect(config.voxcpmVoice).toBe("narrator");
    expect(config.voxcpmFormat).toBe("mp3");
    expect(config.voxcpmVoiceDesign).toBe("a calm older man");
  });
});

describe("buildVoxCPMInput", () => {
  it("wraps a bare Voice Design description in parentheses", () => {
    expect(buildVoxCPMInput("Hello", "a warm young woman")).toBe("(a warm young woman)Hello");
  });

  it("leaves an already-parenthesized description untouched", () => {
    expect(buildVoxCPMInput("Hello", "(a warm young woman)")).toBe("(a warm young woman)Hello");
  });

  it("returns the text unchanged when there is no description", () => {
    expect(buildVoxCPMInput("Hello", "")).toBe("Hello");
    expect(buildVoxCPMInput("Hello", "   ")).toBe("Hello");
    expect(buildVoxCPMInput("Hello", undefined)).toBe("Hello");
  });
});
