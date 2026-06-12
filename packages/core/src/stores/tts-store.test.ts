import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TTS_CONFIG, type ITTSPlayer } from "../tts";

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
  const player = {} as MockTTSPlayer;
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

function resetStore(config = DEFAULT_TTS_CONFIG) {
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
  useTTSStore.getState().stop();
  useTTSStore.setState({
    playState: "stopped",
    currentText: "",
    config,
    onEnd: null,
    currentChunkIndex: 0,
    totalChunks: 0,
  });
}

describe("useTTSStore", () => {
  let systemPlayer: MockTTSPlayer;
  let edgePlayer: MockTTSPlayer;
  let dashscopePlayer: MockTTSPlayer;

  beforeEach(() => {
    systemPlayer = createMockPlayer();
    edgePlayer = createMockPlayer();
    dashscopePlayer = createMockPlayer();
    setTTSPlayerFactories({
      createSystemTTS: () => systemPlayer,
      createEdgeTTS: () => edgePlayer,
      createDashScopeTTS: () => dashscopePlayer,
    });
    resetStore({ ...DEFAULT_TTS_CONFIG, engine: "edge" });
    vi.clearAllMocks();
  });

  it("stops the old engine when the configured engine changes during playback", () => {
    useTTSStore.getState().play("hello");

    expect(edgePlayer.speak).toHaveBeenCalledOnce();
    expect(useTTSStore.getState().playState).toBe("playing");

    useTTSStore.getState().updateConfig({ engine: "system" });

    expect(edgePlayer.stop).toHaveBeenCalledOnce();
    expect(edgePlayer.onEnd).toBeUndefined();
    expect(useTTSStore.getState().playState).toBe("stopped");
    expect(useTTSStore.getState().config.engine).toBe("system");
  });

  it("does not stop playback for non-engine config updates", () => {
    useTTSStore.getState().play("hello");

    useTTSStore.getState().updateConfig({ rate: 1.3 });

    expect(edgePlayer.stop).not.toHaveBeenCalled();
    expect(useTTSStore.getState().playState).toBe("playing");
    expect(useTTSStore.getState().config.rate).toBe(1.3);
  });

  it("stops stale players before starting a new playback session", () => {
    useTTSStore.getState().play("edge text");
    edgePlayer.stop.mockClear();
    useTTSStore.setState({
      config: { ...DEFAULT_TTS_CONFIG, engine: "system" },
    });

    useTTSStore.getState().play("system text");

    expect(edgePlayer.stop).toHaveBeenCalledOnce();
    expect(systemPlayer.speak).toHaveBeenCalledOnce();
  });

  it("does not invoke the reader onEnd callback while stopping a stale engine", () => {
    const onEnd = vi.fn();
    useTTSStore.getState().setOnEnd(onEnd);
    useTTSStore.getState().play("hello");

    useTTSStore.getState().updateConfig({ engine: "system" });

    expect(onEnd).not.toHaveBeenCalled();
  });
});
