import { describe, expect, it } from "vitest";

import { isActivePlay, shouldRespeakForSynthChange } from "./respeak";
import { DEFAULT_TTS_CONFIG, type TTSConfig } from "./types";

function cfg(over: Partial<TTSConfig>): TTSConfig {
  return { ...DEFAULT_TTS_CONFIG, ...over };
}

describe("shouldRespeakForSynthChange", () => {
  it("dashscope: voice change with api key → true", () => {
    expect(
      shouldRespeakForSynthChange(
        cfg({ engine: "dashscope", dashscopeApiKey: "k", dashscopeVoice: "Cherry" }),
        cfg({ engine: "dashscope", dashscopeApiKey: "k", dashscopeVoice: "Ethan" }),
      ),
    ).toBe(true);
  });

  it("dashscope: voice change without api key → false", () => {
    expect(
      shouldRespeakForSynthChange(
        cfg({ engine: "dashscope", dashscopeApiKey: "", dashscopeVoice: "Cherry" }),
        cfg({ engine: "dashscope", dashscopeApiKey: "", dashscopeVoice: "Ethan" }),
      ),
    ).toBe(false);
  });

  it("dashscope: same voice → false", () => {
    const base = { engine: "dashscope" as const, dashscopeApiKey: "k", dashscopeVoice: "Cherry" };
    expect(shouldRespeakForSynthChange(cfg(base), cfg(base))).toBe(false);
  });

  it("dashscope: rate change (voice unchanged) → false", () => {
    expect(
      shouldRespeakForSynthChange(
        cfg({ engine: "dashscope", dashscopeApiKey: "k", dashscopeVoice: "Cherry", rate: 1.0 }),
        cfg({ engine: "dashscope", dashscopeApiKey: "k", dashscopeVoice: "Cherry", rate: 1.5 }),
      ),
    ).toBe(false);
  });

  it("edge: voice change → true", () => {
    expect(
      shouldRespeakForSynthChange(
        cfg({ engine: "edge", edgeVoice: "a" }),
        cfg({ engine: "edge", edgeVoice: "b" }),
      ),
    ).toBe(true);
  });

  it("edge: rate change → true", () => {
    expect(
      shouldRespeakForSynthChange(
        cfg({ engine: "edge", rate: 1.0 }),
        cfg({ engine: "edge", rate: 1.5 }),
      ),
    ).toBe(true);
  });

  it("edge: pitch change → true", () => {
    expect(
      shouldRespeakForSynthChange(
        cfg({ engine: "edge", pitch: 1.0 }),
        cfg({ engine: "edge", pitch: 1.5 }),
      ),
    ).toBe(true);
  });

  it("edge: no synth-param change → false", () => {
    const base = { engine: "edge" as const, edgeVoice: "a", rate: 1.0, pitch: 1.0 };
    expect(shouldRespeakForSynthChange(cfg(base), cfg(base))).toBe(false);
  });

  it("system engine → false", () => {
    expect(
      shouldRespeakForSynthChange(
        cfg({ engine: "system", voiceName: "a" }),
        cfg({ engine: "system", voiceName: "b" }),
      ),
    ).toBe(false);
  });
});

describe("isActivePlay", () => {
  it("playing/loading → true", () => {
    expect(isActivePlay("playing")).toBe(true);
    expect(isActivePlay("loading")).toBe(true);
  });
  it("paused/stopped → false", () => {
    expect(isActivePlay("paused")).toBe(false);
    expect(isActivePlay("stopped")).toBe(false);
  });
});
