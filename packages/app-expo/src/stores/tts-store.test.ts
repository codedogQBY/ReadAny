import { DEFAULT_TTS_CONFIG, type ITTSPlayer } from "@readany/core/tts";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("react-native-track-player", () => ({
  default: {
    getActiveTrackIndex: vi.fn(() => Promise.resolve(undefined)),
    updateMetadataForTrack: vi.fn(() => Promise.resolve()),
  },
}));
vi.mock("./persist", () => ({
  withPersist: (_key: string, creator: unknown) => creator,
}));
vi.mock("../lib/platform/system-tts-synthesis", () => ({
  canUseSystemTtsSynthesis: () => true,
}));
vi.mock("../lib/platform/expo-speech-player", () => ({ ExpoSpeechTTSPlayer: class {} }));
vi.mock("../lib/platform/native-system-tts-player", () => ({
  NativeSystemTTSPlayer: class {},
}));
vi.mock("../lib/platform/track-player-system-player", () => ({
  TrackPlayerSystemTTSPlayer: class {},
}));
vi.mock("../lib/platform/track-player-edge-player", () => ({
  TrackPlayerEdgeTTSPlayer: class {},
}));
vi.mock("../lib/platform/track-player-dashscope-player", () => ({
  TrackPlayerDashScopeTTSPlayer: class {},
}));
vi.mock("../lib/platform/track-player-cloud-tts-player", () => ({
  TrackPlayerCloudTTSPlayer: class {},
}));

const { setTTSPlayerFactories, useTTSStore } = await import("./tts-store");

type MockPlayer = ITTSPlayer & {
  speak: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onError?: (error: Error) => void;
};

function createPlayer(): MockPlayer {
  const player = {
    speak: vi.fn(() => player.onStateChange?.("playing")),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(() => {
      player.onStateChange?.("stopped");
      player.onEnd?.();
    }),
  } as MockPlayer;
  return player;
}

describe("Expo TTS provider failures", () => {
  let systemPlayer: MockPlayer;
  let dashscopePlayer: MockPlayer;
  let edgePlayer: MockPlayer;

  beforeEach(() => {
    systemPlayer = createPlayer();
    dashscopePlayer = createPlayer();
    edgePlayer = createPlayer();
    setTTSPlayerFactories({
      createSystemTTS: () => systemPlayer,
      createDashScopeTTS: () => dashscopePlayer,
      createEdgeTTS: () => edgePlayer,
    });
    useTTSStore.setState({
      config: DEFAULT_TTS_CONFIG,
      playState: "stopped",
      currentText: "",
      currentSegmentText: "",
      onEnd: null,
    });
    useTTSStore.getState().stop();
    vi.clearAllMocks();
  });

  it("uses the DashScope player even when its API key is missing", () => {
    useTTSStore.getState().updateConfig({ engine: "dashscope", dashscopeApiKey: "" });

    useTTSStore.getState().play("test sentence");

    expect(dashscopePlayer.speak).toHaveBeenCalledOnce();
    expect(systemPlayer.speak).not.toHaveBeenCalled();
  });

  it("stops on a provider error without firing the reader onEnd", () => {
    const onEnd = vi.fn();
    useTTSStore.getState().updateConfig({ engine: "dashscope", dashscopeApiKey: "key" });
    useTTSStore.getState().setOnEnd(onEnd);
    useTTSStore.getState().play(["first", "second"]);

    dashscopePlayer.onError?.(new Error("request failed"));

    expect(onEnd).not.toHaveBeenCalled();
    expect(useTTSStore.getState().playState).toBe("stopped");
  });

  it("omits punctuation-only chunks before starting mobile playback", () => {
    useTTSStore.getState().updateConfig({ engine: "edge", edgeVoice: "zh-CN-YunjianNeural" });

    useTTSStore.getState().play(["……", "许七安说。", "。"]);

    expect(edgePlayer.speak).toHaveBeenCalledWith(["许七安说。"], expect.anything());
  });
});
