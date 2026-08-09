import {
  DEFAULT_TTS_CONFIG,
  type ITTSPlayer,
  type TTSConfig,
  type TTSProfile,
  VOICE_RESPEAK_DEBOUNCE_MS,
  isActivePlay,
  normalizeTTSConfig,
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
let _activeTTS: ITTSPlayer | null = null;

let _sessionSegments: string[] = [];
let _sessionCurrentIndex = 0;
let _sessionGeneration = 0;
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
      jumpToChunk(_sessionCurrentIndex);
    }
  }, VOICE_RESPEAK_DEBOUNCE_MS);
}

function detachAndStopPlayer(player: ITTSPlayer | null): void {
  if (!player) return;
  player.onStateChange = undefined;
  player.onChunkChange = undefined;
  player.onError = undefined;
  player.onEnd = undefined;
  try {
    player.stop();
  } catch (err) {
    console.warn("[TTS] Failed to stop player:", err);
  }
}

function detachAndStopAllPlayers(): void {
  const activeTTS = _activeTTS;
  _activeTTS = null;
  if (
    activeTTS &&
    activeTTS !== _systemTTS &&
    activeTTS !== _edgeTTS &&
    activeTTS !== _dashscopeTTS &&
    activeTTS !== _xiaomiTTS &&
    activeTTS !== _openAICompatibleTTS
  ) {
    detachAndStopPlayer(activeTTS);
  }
  detachAndStopPlayer(_systemTTS);
  detachAndStopPlayer(_edgeTTS);
  detachAndStopPlayer(_dashscopeTTS);
  detachAndStopPlayer(_xiaomiTTS);
  detachAndStopPlayer(_openAICompatibleTTS);
}

function normalizeSegments(text: string | string[]): string[] {
  if (Array.isArray(text)) {
    return text.map((segment) => segment.trim()).filter(Boolean);
  }
  return splitNarrationText(text)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function syncProfileUpdatesFromLegacyFields(
  previousConfig: TTSConfig,
  updates: Partial<TTSConfig>,
): Partial<TTSConfig> {
  const targetProvider = updates.engine ?? previousConfig.engine;
  const requestedProfileId = updates.activeProfileId ?? previousConfig.activeProfileId;
  const profileUpdates: Partial<TTSProfile> = {};

  if (targetProvider === "edge" && updates.edgeVoice !== undefined) {
    profileUpdates.voice = updates.edgeVoice;
  } else if (targetProvider === "system" && updates.voiceName !== undefined) {
    profileUpdates.voice = updates.voiceName;
  } else if (targetProvider === "dashscope") {
    if (updates.dashscopeApiKey !== undefined) profileUpdates.apiKey = updates.dashscopeApiKey;
    if (updates.dashscopeVoice !== undefined) profileUpdates.voice = updates.dashscopeVoice;
  } else if (targetProvider === "xiaomi") {
    if (updates.xiaomiBaseUrl !== undefined) profileUpdates.baseUrl = updates.xiaomiBaseUrl;
    if (updates.xiaomiApiKey !== undefined) profileUpdates.apiKey = updates.xiaomiApiKey;
    if (updates.xiaomiVoice !== undefined) profileUpdates.voice = updates.xiaomiVoice;
    if (updates.xiaomiStylePrompt !== undefined) {
      profileUpdates.stylePrompt = updates.xiaomiStylePrompt;
    }
  } else if (targetProvider === "openai-compatible") {
    if (updates.openaiTtsBaseUrl !== undefined) profileUpdates.baseUrl = updates.openaiTtsBaseUrl;
    if (updates.openaiTtsApiKey !== undefined) profileUpdates.apiKey = updates.openaiTtsApiKey;
    if (updates.openaiTtsEndpoint !== undefined)
      profileUpdates.endpoint = updates.openaiTtsEndpoint;
    if (updates.openaiTtsModel !== undefined) profileUpdates.model = updates.openaiTtsModel;
    if (updates.openaiTtsVoice !== undefined) profileUpdates.voice = updates.openaiTtsVoice;
    if (updates.openaiTtsFormat !== undefined) profileUpdates.format = updates.openaiTtsFormat;
    if (updates.openaiTtsStylePrompt !== undefined) {
      profileUpdates.stylePrompt = updates.openaiTtsStylePrompt;
    }
  }

  if (Object.keys(profileUpdates).length === 0) return updates;

  const sourceProfiles = updates.profiles ?? previousConfig.profiles;
  const requestedProfile = sourceProfiles.find((profile) => profile.id === requestedProfileId);
  const targetProfileId =
    requestedProfile?.provider === targetProvider
      ? requestedProfile.id
      : sourceProfiles.find((profile) => profile.provider === targetProvider)?.id;

  if (!targetProfileId) return updates;

  return {
    ...updates,
    profiles: sourceProfiles.map((profile) =>
      profile.id === targetProfileId ? { ...profile, ...profileUpdates } : profile,
    ),
  };
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

function applyPlayerMetadataGetters(player: ITTSPlayer, get: () => TTSState): void {
  if (
    "setArtworkGetter" in player &&
    typeof (player as { setArtworkGetter?: unknown }).setArtworkGetter === "function"
  ) {
    (player as { setArtworkGetter: (getter: () => string | undefined) => void }).setArtworkGetter(
      () => get().currentArtwork || undefined,
    );
  }

  if (
    "setTitleGetter" in player &&
    typeof (player as { setTitleGetter?: unknown }).setTitleGetter === "function"
  ) {
    (player as { setTitleGetter: (getter: () => string | undefined) => void }).setTitleGetter(
      () => {
        const state = get();
        return state.currentChapterTitle || state.currentBookTitle || undefined;
      },
    );
  }
}

function startPlayback(
  segments: string[],
  config: TTSConfig,
  startIndex: number,
  set: (partial: Partial<TTSState>) => void,
  get: () => TTSState,
): void {
  const player = getPlayerForConfig(config);
  const gen = _sessionGeneration;
  let isStarting = true;
  _activeTTS = player;

  applyPlayerMetadataGetters(player, get);

  player.onStateChange = (playState) => {
    if (gen !== _sessionGeneration) return;
    if (isStarting && playState === "stopped") return;
    if (playState === "stopped") {
      _activeTTS = null;
    }
    set({ playState });
  };

  player.onChunkChange = (chunkIndex) => {
    if (gen !== _sessionGeneration) return;
    const absoluteIndex = startIndex + chunkIndex;
    _sessionCurrentIndex = absoluteIndex;
    set({
      currentChunkIndex: absoluteIndex,
      totalChunks: _sessionSegments.length,
      currentSegmentText: _sessionSegments[absoluteIndex] || "",
    });
  };

  player.onError = (error) => {
    if (gen !== _sessionGeneration) return;
    console.error("[TTSStore][player] error", error);
    _activeTTS = null;
    set({ playState: "stopped" });
  };

  player.onEnd = () => {
    if (gen !== _sessionGeneration) return;
    _activeTTS = null;
    const lastIndex = Math.max(0, _sessionSegments.length - 1);
    _sessionCurrentIndex = lastIndex;
    set({
      playState: "stopped",
      currentChunkIndex: lastIndex,
      totalChunks: _sessionSegments.length,
      currentSegmentText: _sessionSegments[lastIndex] || "",
    });
    get().onEnd?.();
  };

  let playback: void | Promise<void>;
  try {
    playback = player.speak(segments, config);
  } catch (error) {
    isStarting = false;
    if (gen !== _sessionGeneration) return;
    console.error("[TTSStore] play failed:", error);
    _activeTTS = null;
    set({ playState: "stopped" });
    return;
  }
  isStarting = false;
  void Promise.resolve(playback).catch((error) => {
    if (gen !== _sessionGeneration) return;
    console.error("[TTSStore] play failed:", error);
    _activeTTS = null;
    set({ playState: "stopped" });
  });
}

function startSystemPlaybackWithFallback(
  segments: string[],
  config: TTSConfig,
  startIndex: number,
  set: (partial: Partial<TTSState>) => void,
  get: () => TTSState,
): void {
  const gen = _sessionGeneration;
  const nativePlayer = getSystemTTS();
  const fallbackPlayer = new ExpoSpeechTTSPlayer();
  let nativeSettled = false;
  let fallbackStarted = false;

  applyPlayerMetadataGetters(nativePlayer, get);

  const attachPlayer = (player: ITTSPlayer) => {
    _activeTTS = player;
    player.onStateChange = (playState) => {
      if (gen !== _sessionGeneration) return;
      if (player === nativePlayer && playState === "stopped" && !nativeSettled) {
        startFallback(new Error("Native system TTS stopped before playback started"));
        return;
      }
      if (playState === "stopped") _activeTTS = null;
      set({ playState });
    };
    player.onChunkChange = (chunkIndex) => {
      if (gen !== _sessionGeneration) return;
      const absoluteIndex = startIndex + chunkIndex;
      _sessionCurrentIndex = absoluteIndex;
      set({
        currentChunkIndex: absoluteIndex,
        totalChunks: _sessionSegments.length,
        currentSegmentText: _sessionSegments[absoluteIndex] || "",
      });
    };
    player.onEnd = () => {
      if (gen !== _sessionGeneration) return;
      _activeTTS = null;
      const lastIndex = Math.max(0, _sessionSegments.length - 1);
      _sessionCurrentIndex = lastIndex;
      set({
        playState: "stopped",
        currentChunkIndex: lastIndex,
        totalChunks: _sessionSegments.length,
        currentSegmentText: _sessionSegments[lastIndex] || "",
      });
      get().onEnd?.();
    };
  };

  const startFallback = (error: unknown) => {
    if (gen !== _sessionGeneration || fallbackStarted) return;
    fallbackStarted = true;
    console.warn("[TTSStore] Native system TTS failed; falling back to ExpoSpeech:", error);
    try {
      nativePlayer.onStateChange = undefined;
      nativePlayer.onChunkChange = undefined;
      nativePlayer.onEnd = undefined;
      nativePlayer.stop();
    } catch {}
    attachPlayer(fallbackPlayer);
    void Promise.resolve(fallbackPlayer.speak(segments, config)).catch((fallbackError) => {
      if (gen !== _sessionGeneration) return;
      console.error("[TTSStore] ExpoSpeech fallback failed:", fallbackError);
      _activeTTS = null;
      set({ playState: "stopped" });
    });
  };

  attachPlayer(nativePlayer);
  try {
    const playback = nativePlayer.speak(segments, config);
    void Promise.resolve(playback)
      .then(() => {
        if (gen === _sessionGeneration) nativeSettled = true;
      })
      .catch((error) => {
        if (gen !== _sessionGeneration) return;
        if (!nativeSettled) {
          startFallback(error);
          return;
        }
        console.error("[TTSStore] play failed:", error);
        _activeTTS = null;
        set({ playState: "stopped" });
      });
  } catch (error) {
    startFallback(error);
  }
}

function startPlaybackForConfig(
  segments: string[],
  config: TTSConfig,
  startIndex: number,
  set: (partial: Partial<TTSState>) => void,
  get: () => TTSState,
): void {
  if (config.engine === "system") {
    startSystemPlaybackWithFallback(segments, config, startIndex, set, get);
    return;
  }
  startPlayback(segments, config, startIndex, set, get);
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
    (set, get) => ({
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
          return;
        }

        const config = normalizeTTSConfig(get().config);
        detachAndStopAllPlayers();
        _sessionGeneration += 1;
        _sessionSegments = segments;
        _sessionCurrentIndex = 0;

        set({
          playState: "loading",
          currentText: joinedText,
          currentSegmentText: segments[0] || "",
          currentChunkIndex: 0,
          totalChunks: segments.length,
        });

        startPlaybackForConfig(segments, config, 0, set, get);
      },

      append: (text: string | string[]) => {
        const segments = normalizeSegments(text);
        const joinedText = segments.join(" ").trim();
        if (!joinedText || !_activeTTS || typeof _activeTTS.append !== "function") {
          return false;
        }

        const previousSegments = _sessionSegments;
        try {
          _activeTTS.append(segments);
          _sessionSegments = [..._sessionSegments, ...segments];
          set((state) => ({
            currentText: [state.currentText, joinedText].filter(Boolean).join(" ").trim(),
            totalChunks: _sessionSegments.length,
            currentSegmentText:
              _sessionSegments[_sessionCurrentIndex] || state.currentSegmentText || "",
          }));
          return true;
        } catch (error) {
          _sessionSegments = previousSegments;
          console.warn("[TTSStore] append failed:", error);
          return false;
        }
      },

      pause: () => {
        clearRespeakTimer();
        const { playState } = get();
        if (playState !== "playing" && playState !== "loading") return;
        _activeTTS?.pause();
        set({ playState: "paused" });
      },

      resume: () => {
        if (get().playState === "paused" && _activeTTS) {
          _activeTTS.resume();
          set({ playState: "playing" });
          return;
        }

        if (_sessionSegments.length === 0 || _sessionCurrentIndex >= _sessionSegments.length) {
          set({ playState: "stopped" });
          return;
        }

        const config = normalizeTTSConfig(get().config);
        const nextIndex = Math.max(0, Math.min(_sessionCurrentIndex, _sessionSegments.length - 1));
        const remainingSegments = _sessionSegments.slice(nextIndex);
        if (remainingSegments.length === 0) {
          set({ playState: "stopped" });
          return;
        }

        detachAndStopAllPlayers();
        _sessionGeneration += 1;
        _sessionCurrentIndex = nextIndex;

        set({
          playState: "loading",
          currentSegmentText: _sessionSegments[nextIndex] || "",
          currentChunkIndex: nextIndex,
          totalChunks: _sessionSegments.length,
        });

        startPlaybackForConfig(remainingSegments, config, nextIndex, set, get);
      },

      stop: () => {
        clearSleepTimerHandle();
        clearRespeakTimer();
        _sessionGeneration += 1;
        detachAndStopAllPlayers();
        _sessionSegments = [];
        _sessionCurrentIndex = 0;
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
        const normalizedUpdates = syncProfileUpdatesFromLegacyFields(previousConfig, updates);
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
          currentSegmentText: _sessionSegments[index] || "",
        }),

      jumpToChunk: (index: number) => {
        clearRespeakTimer();
        if (index < 0 || index >= _sessionSegments.length) return;

        const config = normalizeTTSConfig(get().config);
        const remainingSegments = _sessionSegments.slice(index);
        if (remainingSegments.length === 0) {
          set({ playState: "stopped" });
          return;
        }

        detachAndStopAllPlayers();
        _sessionGeneration += 1;
        _sessionCurrentIndex = index;

        set({
          playState: "loading",
          currentSegmentText: _sessionSegments[index] || "",
          currentChunkIndex: index,
          totalChunks: _sessionSegments.length,
        });

        startPlaybackForConfig(remainingSegments, config, index, set, get);
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
    }),
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
  detachAndStopAllPlayers();
  _systemTTS = null;
  _edgeTTS = null;
  _dashscopeTTS = null;
  _xiaomiTTS = null;
  _openAICompatibleTTS = null;
}
