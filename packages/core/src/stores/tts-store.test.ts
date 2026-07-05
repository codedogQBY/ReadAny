import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TTS_CONFIG, type ITTSPlayer, type TTSConfig } from "../tts/types";

vi.mock("./persist", () => ({
  withPersist: (_key: string, creator: unknown) => creator,
}));

const { setTTSPlayerFactories, useTTSStore } = await import("./tts-store");

type MockTTSPlayer = ITTSPlayer & {
  speak: ReturnType<typeof vi.fn>;
  pause: ReturnType<typeof vi.fn>;
  resume: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

function createMockPlayer(): MockTTSPlayer {
  const player = { paused: false } as MockTTSPlayer;
  player.speak = vi.fn(() => {
    player.onStateChange?.("playing");
  });
  player.pause = vi.fn(() => {
    player.onStateChange?.("paused");
  });
  player.resume = vi.fn(() => {
    player.onStateChange?.("playing");
  });
  player.stop = vi.fn(() => {
    player.onStateChange?.("stopped");
    player.onEnd?.();
  });
  return player;
}

function resetStore(config: TTSConfig = DEFAULT_TTS_CONFIG) {
  useTTSStore.setState({
    playState: "stopped",
    currentText: "",
    config,
    onEnd: null,
    currentChunkIndex: 0,
    totalChunks: 0,
    currentBookTitle: "",
    currentChapterTitle: "",
    currentBookId: "",
    currentLocationCfi: "",
    sleepTimerEndsAt: null,
    sleepTimerDurationMinutes: null,
  });
}

let systemPlayer: MockTTSPlayer;
let edgePlayer: MockTTSPlayer;
let dashscopePlayer: MockTTSPlayer;

function startDashScope(voice = "Cherry") {
  useTTSStore
    .getState()
    .updateConfig({ engine: "dashscope", dashscopeApiKey: "key", dashscopeVoice: voice });
  useTTSStore.getState().play(["s0", "s1", "s2"]);
}
function startEdge() {
  useTTSStore
    .getState()
    .updateConfig({ engine: "edge", edgeVoice: "zh-CN-XiaoxiaoNeural", rate: 1.0, pitch: 1.0 });
  useTTSStore.getState().play(["s0", "s1"]);
}

describe("useTTSStore — re-speak on synth change (#370)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    systemPlayer = createMockPlayer();
    edgePlayer = createMockPlayer();
    dashscopePlayer = createMockPlayer();
    setTTSPlayerFactories({
      createSystemTTS: () => systemPlayer,
      createEdgeTTS: () => edgePlayer,
      createDashScopeTTS: () => dashscopePlayer,
    });
    resetStore();
    useTTSStore.getState().stop();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dashscope: re-speaks from current sentence with new voice after debounce", () => {
    startDashScope("Cherry");
    expect(dashscopePlayer.speak).toHaveBeenCalledTimes(1);
    useTTSStore.getState().updateConfig({ dashscopeVoice: "Ethan" });
    expect(dashscopePlayer.speak).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(250);
    expect(dashscopePlayer.speak).toHaveBeenCalledTimes(2);
    const [segments, config] = dashscopePlayer.speak.mock.calls[1];
    expect(segments).toEqual(["s0", "s1", "s2"]);
    expect((config as TTSConfig).dashscopeVoice).toBe("Ethan");
  });

  it("edge: re-speaks on edge voice change", () => {
    startEdge();
    useTTSStore.getState().updateConfig({ edgeVoice: "zh-CN-YunxiNeural" });
    vi.advanceTimersByTime(250);
    expect(edgePlayer.speak).toHaveBeenCalledTimes(2);
    expect((edgePlayer.speak.mock.calls[1][1] as TTSConfig).edgeVoice).toBe("zh-CN-YunxiNeural");
  });

  it("edge: re-speaks from current chunk with changed rate and does not leak stopped state", () => {
    startEdge();
    edgePlayer.onChunkChange?.(1, 2);
    expect(useTTSStore.getState().currentChunkIndex).toBe(1);

    useTTSStore.getState().updateConfig({ rate: 1.5 });
    vi.advanceTimersByTime(250);

    expect(edgePlayer.stop).toHaveBeenCalledTimes(1);
    expect(edgePlayer.speak).toHaveBeenCalledTimes(2);
    expect(edgePlayer.speak.mock.calls[1][0]).toEqual(["s1"]);
    expect((edgePlayer.speak.mock.calls[1][1] as TTSConfig).rate).toBe(1.5);
    expect(useTTSStore.getState().playState).toBe("playing");
    expect(useTTSStore.getState().currentChunkIndex).toBe(1);
  });

  it("edge: rapid voice/rate changes collapse into one re-speak with latest config", () => {
    startEdge();
    useTTSStore.getState().updateConfig({ edgeVoice: "zh-CN-YunxiNeural" });
    vi.advanceTimersByTime(100);
    useTTSStore.getState().updateConfig({ rate: 1.3 });
    vi.advanceTimersByTime(100);
    useTTSStore.getState().updateConfig({ pitch: 1.2 });
    vi.advanceTimersByTime(250);

    expect(edgePlayer.stop).toHaveBeenCalledTimes(1);
    expect(edgePlayer.speak).toHaveBeenCalledTimes(2);
    const config = edgePlayer.speak.mock.calls[1][1] as TTSConfig;
    expect(config.edgeVoice).toBe("zh-CN-YunxiNeural");
    expect(config.rate).toBe(1.3);
    expect(config.pitch).toBe(1.2);
  });

  it("debounces rapid switches into one re-speak with the last voice", () => {
    startDashScope("Cherry");
    useTTSStore.getState().updateConfig({ dashscopeVoice: "Ethan" });
    vi.advanceTimersByTime(100);
    useTTSStore.getState().updateConfig({ dashscopeVoice: "Serena" });
    vi.advanceTimersByTime(100);
    useTTSStore.getState().updateConfig({ dashscopeVoice: "Dylan" });
    expect(dashscopePlayer.speak).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(250);
    expect(dashscopePlayer.speak).toHaveBeenCalledTimes(2);
    expect((dashscopePlayer.speak.mock.calls[1][1] as TTSConfig).dashscopeVoice).toBe("Dylan");
  });

  it("[cleanup] new play() during a pending re-speak adds no spurious speak", () => {
    startDashScope("Cherry");
    useTTSStore.getState().updateConfig({ dashscopeVoice: "Ethan" });
    vi.clearAllMocks();
    useTTSStore.getState().play(["n0", "n1"]);
    expect(dashscopePlayer.speak).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(250);
    expect(dashscopePlayer.speak).toHaveBeenCalledTimes(1);
  });

  it("[cleanup] manual jumpToChunk during a pending re-speak does not double-fire", () => {
    startDashScope("Cherry");
    useTTSStore.getState().updateConfig({ dashscopeVoice: "Ethan" });
    vi.clearAllMocks();
    useTTSStore.getState().jumpToChunk(1);
    const callsAfterJump = dashscopePlayer.speak.mock.calls.length;
    vi.advanceTimersByTime(250);
    expect(dashscopePlayer.speak).toHaveBeenCalledTimes(callsAfterJump);
  });

  it("[loading] triggers re-speak while in loading state", () => {
    startDashScope("Cherry");
    useTTSStore.setState({ playState: "loading" });
    vi.clearAllMocks();
    useTTSStore.getState().updateConfig({ dashscopeVoice: "Ethan" });
    vi.advanceTimersByTime(250);
    expect(dashscopePlayer.speak).toHaveBeenCalledTimes(1);
    expect((dashscopePlayer.speak.mock.calls[0][1] as TTSConfig).dashscopeVoice).toBe("Ethan");
  });

  it("does not re-speak when stopped", () => {
    useTTSStore
      .getState()
      .updateConfig({ engine: "dashscope", dashscopeApiKey: "key", dashscopeVoice: "Cherry" });
    useTTSStore.getState().updateConfig({ dashscopeVoice: "Ethan" });
    vi.advanceTimersByTime(250);
    expect(dashscopePlayer.speak).not.toHaveBeenCalled();
  });

  it("does not re-speak when voice unchanged", () => {
    startDashScope("Cherry");
    useTTSStore.getState().updateConfig({ dashscopeVoice: "Cherry" });
    vi.advanceTimersByTime(250);
    expect(dashscopePlayer.speak).toHaveBeenCalledTimes(1);
  });

  it("does not re-speak when dashscope api key missing", () => {
    useTTSStore
      .getState()
      .updateConfig({ engine: "dashscope", dashscopeApiKey: "", dashscopeVoice: "Cherry" });
    useTTSStore.getState().play(["s0", "s1"]);
    vi.clearAllMocks();
    useTTSStore.getState().updateConfig({ dashscopeVoice: "Ethan" });
    vi.advanceTimersByTime(250);
    expect(dashscopePlayer.speak).not.toHaveBeenCalled();
  });

  it("cancels pending re-speak on stop", () => {
    startDashScope("Cherry");
    useTTSStore.getState().updateConfig({ dashscopeVoice: "Ethan" });
    useTTSStore.getState().stop();
    vi.advanceTimersByTime(250);
    expect(dashscopePlayer.speak).toHaveBeenCalledTimes(1);
  });

  it("cancels pending re-speak on pause", () => {
    startDashScope("Cherry");
    useTTSStore.getState().updateConfig({ dashscopeVoice: "Ethan" });
    useTTSStore.getState().pause();
    vi.advanceTimersByTime(250);
    expect(dashscopePlayer.speak).toHaveBeenCalledTimes(1);
  });

  it("[cleanup] 非重读配置变更取消待执行的 respeak（不残留重启）", () => {
    startEdge();
    useTTSStore.getState().updateConfig({ edgeVoice: "zh-CN-YunxiNeural" }); // 排下 respeak 定时器
    vi.advanceTimersByTime(100); // 防抖窗口内
    useTTSStore.getState().updateConfig({ engine: "system" }); // 非重读变更 → 应取消定时器
    vi.clearAllMocks();
    vi.advanceTimersByTime(250); // 让任何残留定时器有机会 fire
    expect(edgePlayer.speak).not.toHaveBeenCalled();
    expect(systemPlayer.speak).not.toHaveBeenCalled();
  });

  it("[engine-switch] stops active playback without firing reader onEnd", () => {
    const onEnd = vi.fn();
    startEdge();
    useTTSStore.getState().setOnEnd(onEnd);
    edgePlayer.stop.mockClear();

    useTTSStore.getState().updateConfig({ engine: "system" });

    expect(edgePlayer.stop).toHaveBeenCalledOnce();
    expect(edgePlayer.onEnd).toBeUndefined();
    expect(onEnd).not.toHaveBeenCalled();
    expect(useTTSStore.getState().playState).toBe("stopped");
    expect(useTTSStore.getState().config.engine).toBe("system");
  });

  it("[engine-switch] does not stop playback for non-engine synth updates", () => {
    startEdge();
    edgePlayer.stop.mockClear();

    useTTSStore.getState().updateConfig({ rate: 1.3 });

    expect(edgePlayer.stop).not.toHaveBeenCalled();
    expect(useTTSStore.getState().playState).toBe("playing");
    expect(useTTSStore.getState().config.rate).toBe(1.3);
  });
});
