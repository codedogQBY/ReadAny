import {
  DEFAULT_TTS_CONFIG,
  type ITTSPlayer,
  type TTSConfig,
  TTSPlaybackController,
  VOICE_RESPEAK_DEBOUNCE_MS,
  isActivePlay,
  mergeTTSConfigUpdates,
  normalizeTTSConfig,
  preloadTTSChunks,
  shouldRespeakForSynthChange,
  splitNarrationText,
} from "@readany/core/tts";
import { Platform } from "react-native";
import TrackPlayer from "react-native-track-player";
import { create } from "zustand";
import { ExpoSpeechTTSPlayer } from "../lib/platform/expo-speech-player";
import { canUseSystemTtsSynthesis } from "../lib/platform/system-tts-synthesis";
import { TrackPlayerCloudTTSPlayer } from "../lib/platform/track-player-cloud-tts-player";
import { TrackPlayerDashScopeTTSPlayer } from "../lib/platform/track-player-dashscope-player";
import { TrackPlayerEdgeTTSPlayer } from "../lib/platform/track-player-edge-player";
import { TrackPlayerSystemTTSPlayer } from "../lib/platform/track-player-system-player";
import { withPersist } from "./persist";

export type TTSPlayState = "stopped" | "playing" | "paused" | "loading";

export interface TTSPlayerFactories {
  createSystemTTS: () => ITTSPlayer;
  createEdgeTTS: () => ITTSPlayer;
  createDashScopeTTS: () => ITTSPlayer;
  createXiaomiTTS: () => ITTSPlayer;
  createOpenAICompatibleTTS: () => ITTSPlayer;
}

const defaultFactories: TTSPlayerFactories = {
  createSystemTTS: () => {
    if (Platform.OS === "android" || Platform.OS === "ios") {
      if (!canUseSystemTtsSynthesis()) {
        console.warn("[TTS] System TTS synthesis module unavailable; native rebuild required");
      }
      return new TrackPlayerSystemTTSPlayer();
    }
    return new ExpoSpeechTTSPlayer();
  },
  createEdgeTTS: () => new TrackPlayerEdgeTTSPlayer(),
  createDashScopeTTS: () => new TrackPlayerDashScopeTTSPlayer(),
  createXiaomiTTS: () => new TrackPlayerCloudTTSPlayer(),
  createOpenAICompatibleTTS: () => new TrackPlayerCloudTTSPlayer(),
};

let _factories: TTSPlayerFactories = defaultFactories;
let _systemTTS: ITTSPlayer | null = null;
let _edgeTTS: ITTSPlayer | null = null;
let _dashscopeTTS: ITTSPlayer | null = null;
let _xiaomiTTS: ITTSPlayer | null = null;
let _openAICompatibleTTS: ITTSPlayer | null = null;
let _controller: TTSPlaybackController | null = null;
let _sleepTimerHandle: ReturnType<typeof setTimeout> | null = null;

function getSystemTTS(): ITTSPlayer {
  if (!_systemTTS) _systemTTS = _factories.createSystemTTS();
  return _systemTTS;
}

function getEdgeTTS(): ITTSPlayer {
  if (!_edgeTTS) _edgeTTS = _factories.createEdgeTTS();
  return _edgeTTS;
}

function getDashScopeTTS(): ITTSPlayer {
  if (!_dashscopeTTS) _dashscopeTTS = _factories.createDashScopeTTS();
  return _dashscopeTTS;
}

function getXiaomiTTS(): ITTSPlayer {
  if (!_xiaomiTTS) _xiaomiTTS = _factories.createXiaomiTTS();
  return _xiaomiTTS;
}

function getOpenAICompatibleTTS(): ITTSPlayer {
  if (!_openAICompatibleTTS) {
    _openAICompatibleTTS = _factories.createOpenAICompatibleTTS();
  }
  return _openAICompatibleTTS;
}

function clearSleepTimerHandle(): void {
  if (_sleepTimerHandle) {
    clearTimeout(_sleepTimerHandle);
    _sleepTimerHandle = null;
  }
}

let _respeakTimer: ReturnType<typeof setTimeout> | null = null;

function clearRespeakTimer(): void {
  if (_respeakTimer) {
    clearTimeout(_respeakTimer);
    _respeakTimer = null;
  }
}

function scheduleRespeak(): void {
  clearRespeakTimer();
  _respeakTimer = setTimeout(() => {
    _respeakTimer = null;
    const { playState, jumpToChunk } = useTTSStore.getState();
    if (isActivePlay(playState)) {
      jumpToChunk(useTTSStore.getState().currentChunkIndex);
    }
  }, VOICE_RESPEAK_DEBOUNCE_MS);
}

function normalizeSegments(text: string | string[]): string[] {
  if (Array.isArray(text)) {
    return text.map((segment) => segment.trim()).filter(Boolean);
  }
  return splitNarrationText(text)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function getPlayerForConfig(config: TTSConfig): ITTSPlayer {
  if (config.engine === "dashscope") {
    return getDashScopeTTS();
  }
  if (config.engine === "edge") {
    return getEdgeTTS();
  }
  if (config.engine === "xiaomi") {
    return getXiaomiTTS();
  }
  if (config.engine === "openai-compatible") {
    return getOpenAICompatibleTTS();
  }
  return getSystemTTS();
}

export interface TTSState {
  playState: TTSPlayState;
  currentText: string;
  currentSegmentText: string;
  config: TTSConfig;
  onEnd: (() => void) | null;
  currentBookTitle: string;
  currentChapterTitle: string;
  currentBookId: string;
  currentArtwork: string;
  currentLocationCfi: string;
  currentChunkIndex: number;
  totalChunks: number;
  sleepTimerEndsAt: number | null;
  sleepTimerDurationMinutes: number | null;

  play: (text: string | string[]) => void;
  preload: (text: string | string[]) => boolean;
  append: (text: string | string[]) => boolean;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  toggle: (text?: string) => void;
  updateConfig: (updates: Partial<TTSConfig>) => void;
  setPlayState: (state: TTSPlayState) => void;
  setOnEnd: (cb: (() => void) | null) => void;
  setCurrentBook: (title: string, chapter: string, bookId?: string, artwork?: string) => void;
  setCurrentLocation: (cfi?: string | null) => void;
  setChunkProgress: (index: number, total: number) => void;
  jumpToChunk: (index: number) => void;
  setSleepTimer: (minutes: number) => void;
  clearSleepTimer: () => void;
}

export const useTTSStore = create<TTSState>()(
  withPersist<TTSState>(
    "tts",
    (set, get) => {
      const controller = new TTSPlaybackController(
        getPlayerForConfig,
        {
          onStateChange: (playState) => set({ playState }),
          onSegmentChange: (index, total, text) =>
            set({ currentChunkIndex: index, totalChunks: total, currentSegmentText: text }),
          onEnd: () => get().onEnd?.(),
          onError: (error) => console.error("[TTS] playback failed", error),
          configurePlayer: (player) => {
            if (
              "setArtworkGetter" in player &&
              typeof (player as { setArtworkGetter?: unknown }).setArtworkGetter === "function"
            ) {
              (
                player as { setArtworkGetter: (getter: () => string | undefined) => void }
              ).setArtworkGetter(() => get().currentArtwork || undefined);
            }
            if (
              "setTitleGetter" in player &&
              typeof (player as { setTitleGetter?: unknown }).setTitleGetter === "function"
            ) {
              (
                player as { setTitleGetter: (getter: () => string | undefined) => void }
              ).setTitleGetter(
                () => get().currentChapterTitle || get().currentBookTitle || undefined,
              );
            }
          },
        },
        preloadTTSChunks,
      );
      _controller = controller;
      return {
        playState: "stopped",
        currentText: "",
        currentSegmentText: "",
        config: DEFAULT_TTS_CONFIG,
        onEnd: null,
        currentBookTitle: "",
        currentChapterTitle: "",
        currentBookId: "",
        currentArtwork: "",
        currentLocationCfi: "",
        currentChunkIndex: 0,
        totalChunks: 0,
        sleepTimerEndsAt: null,
        sleepTimerDurationMinutes: null,

        play: (text: string | string[]) => {
          clearRespeakTimer();
          const segments = normalizeSegments(text);
          const joinedText = segments.join(" ").trim();
          if (!joinedText) {
            console.log("[TTSStore] No text to speak");
            return;
          }

          const config = normalizeTTSConfig(get().config);
          set({
            playState: "loading",
            currentText: joinedText,
            currentSegmentText: segments[0] || "",
            currentChunkIndex: 0,
            totalChunks: segments.length,
          });

          controller.play(segments, config);
        },

        preload: (text: string | string[]) =>
          controller.preload(text, normalizeTTSConfig(get().config)),

        append: (text: string | string[]) => {
          const segments = normalizeSegments(text);
          const joinedText = segments.join(" ").trim();
          if (!joinedText) return false;
          const appended = controller.append(segments);
          if (appended) {
            const snapshot = controller.snapshot();
            set((state) => ({
              currentText: [state.currentText, joinedText].filter(Boolean).join(" ").trim(),
              totalChunks: snapshot.segments.length,
              currentSegmentText:
                snapshot.segments[snapshot.currentIndex] || state.currentSegmentText,
            }));
          }
          return appended;
        },

        pause: () => {
          console.log("[TTSStore] pause called");
          clearRespeakTimer();
          const { playState } = get();
          if (playState !== "playing" && playState !== "loading") return;
          controller.pause();
        },

        resume: () => {
          console.log("[TTSStore] resume called");
          if (get().playState === "paused") {
            controller.resume(normalizeTTSConfig(get().config));
            return;
          }
          const snapshot = controller.snapshot();
          if (snapshot.segments.length === 0 || snapshot.currentIndex >= snapshot.segments.length) {
            set({ playState: "stopped" });
            return;
          }
          controller.resume(normalizeTTSConfig(get().config));
        },

        stop: () => {
          console.log("[TTSStore] stop called");
          clearSleepTimerHandle();
          clearRespeakTimer();
          controller.clear();
          set({
            playState: "stopped",
            currentText: "",
            currentSegmentText: "",
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
        },

        toggle: (text?: string) => {
          console.log("[TTSStore] toggle called, playState:", get().playState);
          const { playState, currentText, play } = get();
          if (playState === "playing" || playState === "loading") {
            get().pause();
          } else if (playState === "paused") {
            get().resume();
          } else if (text) {
            play(text);
          } else if (currentText) {
            play(currentText);
          }
        },

        updateConfig: (updates) => {
          const previousConfig = normalizeTTSConfig(get().config);
          const normalizedUpdates = mergeTTSConfigUpdates(previousConfig, updates);
          const nextConfig = normalizeTTSConfig({ ...previousConfig, ...normalizedUpdates });
          set({ config: nextConfig });

          if (
            shouldRespeakForSynthChange(previousConfig, nextConfig) &&
            isActivePlay(get().playState)
          ) {
            scheduleRespeak();
          } else {
            // 非重读变更（切引擎、或改了当前引擎不关心的字段）必须取消上一次合成变更排下的
            // 待执行 respeak，否则陈旧防抖定时器会 fire 并强制重启播放。
            clearRespeakTimer();
          }
        },

        setPlayState: (playState) => set({ playState }),

        setOnEnd: (cb) => {
          console.log("[TTSStore] setOnEnd", { hasCallback: !!cb });
          set({ onEnd: cb });
        },

        setCurrentBook: (title, chapter, bookId, artwork) => {
          set({
            currentBookTitle: title,
            currentChapterTitle: chapter,
            currentBookId: bookId ?? "",
            currentArtwork: artwork ?? "",
          });
          // Sync notification bar metadata
          TrackPlayer.getActiveTrackIndex()
            .then((idx) => {
              if (idx != null) {
                TrackPlayer.updateMetadataForTrack(idx, {
                  title: chapter || title,
                  artist: title,
                  album: title || "ReadAny",
                  ...(artwork ? { artwork } : {}),
                }).catch((err) => console.warn("[TTS] Failed to update track metadata:", err));
              }
            })
            .catch((err) => console.warn("[TTS] Failed to get active track index:", err));
        },

        setCurrentLocation: (cfi) => set({ currentLocationCfi: cfi ?? "" }),

        setChunkProgress: (index, total) =>
          set({
            currentChunkIndex: index,
            totalChunks: total,
            currentSegmentText: controller.snapshot().segments[index] || "",
          }),

        jumpToChunk: (index: number) => {
          clearRespeakTimer();
          const snapshot = controller.snapshot();
          if (index < 0 || index >= snapshot.segments.length) return;
          const config = normalizeTTSConfig(get().config);
          set({ playState: "loading", currentChunkIndex: index });
          controller.jumpTo(index, config);
        },

        setSleepTimer: (minutes: number) => {
          const durationMinutes = Math.max(1, Math.round(minutes));
          const endsAt = Date.now() + durationMinutes * 60_000;
          clearSleepTimerHandle();
          _sleepTimerHandle = setTimeout(() => {
            _sleepTimerHandle = null;
            if (get().sleepTimerEndsAt !== endsAt) return;
            set({
              sleepTimerEndsAt: null,
              sleepTimerDurationMinutes: null,
            });
            get().pause();
          }, durationMinutes * 60_000);
          set({
            sleepTimerEndsAt: endsAt,
            sleepTimerDurationMinutes: durationMinutes,
          });
        },

        clearSleepTimer: () => {
          clearSleepTimerHandle();
          set({
            sleepTimerEndsAt: null,
            sleepTimerDurationMinutes: null,
          });
        },
      };
    },
    {
      playState: "stopped" as const,
      currentText: "",
      currentSegmentText: "",
      currentChunkIndex: 0,
      totalChunks: 0,
      currentLocationCfi: "",
      sleepTimerEndsAt: null,
      sleepTimerDurationMinutes: null,
    } as Partial<TTSState>,
    (persisted) => ({
      ...persisted,
      config: normalizeTTSConfig((persisted as TTSState).config),
    }),
  ),
);

export function setTTSPlayerFactories(factories: Partial<TTSPlayerFactories>): void {
  _factories = { ...defaultFactories, ...factories };
  _controller?.clear();
  _systemTTS = null;
  _edgeTTS = null;
  _dashscopeTTS = null;
  _xiaomiTTS = null;
  _openAICompatibleTTS = null;
}
