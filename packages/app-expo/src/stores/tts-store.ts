import {
  DEFAULT_TTS_CONFIG,
  type ITTSPlayer,
  type TTSConfig,
  normalizeTTSConfig,
  splitNarrationText,
} from "@readany/core/tts";
import TrackPlayer from "react-native-track-player";
import { create } from "zustand";
import { ExpoSpeechTTSPlayer } from "../lib/platform/expo-speech-player";
import { TrackPlayerDashScopeTTSPlayer } from "../lib/platform/track-player-dashscope-player";
import { TrackPlayerEdgeTTSPlayer } from "../lib/platform/track-player-edge-player";
import { withPersist } from "./persist";

export type TTSPlayState = "stopped" | "playing" | "paused" | "loading";

export interface TTSPlayerFactories {
  createSystemTTS: () => ITTSPlayer;
  createEdgeTTS: () => ITTSPlayer;
  createDashScopeTTS: () => ITTSPlayer;
}

const defaultFactories: TTSPlayerFactories = {
  createSystemTTS: () => new ExpoSpeechTTSPlayer(),
  createEdgeTTS: () => new TrackPlayerEdgeTTSPlayer(),
  createDashScopeTTS: () => new TrackPlayerDashScopeTTSPlayer(),
};

let _factories: TTSPlayerFactories = defaultFactories;
let _systemTTS: ITTSPlayer | null = null;
let _edgeTTS: ITTSPlayer | null = null;
let _dashscopeTTS: ITTSPlayer | null = null;
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

function clearSleepTimerHandle(): void {
  if (_sleepTimerHandle) {
    clearTimeout(_sleepTimerHandle);
    _sleepTimerHandle = null;
  }
}

function detachAndStopPlayer(player: ITTSPlayer | null): void {
  if (!player) return;
  player.onStateChange = undefined;
  player.onChunkChange = undefined;
  player.onEnd = undefined;
  try {
    player.stop();
  } catch {}
}

function detachAndStopAllPlayers(): void {
  _activeTTS = null;
  detachAndStopPlayer(_systemTTS);
  detachAndStopPlayer(_edgeTTS);
  detachAndStopPlayer(_dashscopeTTS);
}

function normalizeSegments(text: string | string[]): string[] {
  if (Array.isArray(text)) {
    return text.map((segment) => segment.trim()).filter(Boolean);
  }
  return splitNarrationText(text)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function previewSessionSegments(segments: string[], limit = 8) {
  return segments.slice(0, limit).map((text, index) => ({
    index,
    text: text.replace(/\s+/g, " ").trim(),
  }));
}

function getPlayerForConfig(config: TTSConfig): ITTSPlayer {
  if (config.engine === "dashscope" && config.dashscopeApiKey) {
    return getDashScopeTTS();
  }
  if (config.engine === "edge") {
    return getEdgeTTS();
  }
  return getSystemTTS();
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
  _activeTTS = player;

  // Set artwork getter for RNTP players
  if (
    "setArtworkGetter" in player &&
    typeof (player as { setArtworkGetter?: unknown }).setArtworkGetter === "function"
  ) {
    (player as { setArtworkGetter: (getter: () => string | undefined) => void }).setArtworkGetter(
      () => get().currentArtwork || undefined,
    );
  }

  player.onStateChange = (playState) => {
    if (gen !== _sessionGeneration) return;
    console.log("[TTSStore][player] state-change", {
      playState,
      gen,
      currentIndex: _sessionCurrentIndex,
      total: _sessionSegments.length,
      currentText: _sessionSegments[_sessionCurrentIndex] || "",
    });
    if (playState === "stopped") {
      _activeTTS = null;
    }
    set({ playState });
  };

  player.onChunkChange = (chunkIndex) => {
    if (gen !== _sessionGeneration) return;
    const absoluteIndex = startIndex + chunkIndex;
    _sessionCurrentIndex = absoluteIndex;
    console.log("[TTSStore][player] chunk-change", {
      chunkIndex,
      absoluteIndex,
      startIndex,
      total: _sessionSegments.length,
      currentText: _sessionSegments[absoluteIndex] || "",
      nextText: _sessionSegments[absoluteIndex + 1] || "",
    });
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
    console.log("[TTSStore][player] end", {
      gen,
      lastIndex,
      total: _sessionSegments.length,
      lastText: _sessionSegments[lastIndex] || "",
      queuePreview: previewSessionSegments(_sessionSegments),
      hasOnEnd: !!get().onEnd,
    });
    set({
      playState: "stopped",
      currentChunkIndex: lastIndex,
      totalChunks: _sessionSegments.length,
      currentSegmentText: _sessionSegments[lastIndex] || "",
    });
    get().onEnd?.();
  };

  const playback = player.speak(segments, config);
  void Promise.resolve(playback).catch((error) => {
    if (gen !== _sessionGeneration) return;
    console.error("[TTSStore] play failed:", error);
    _activeTTS = null;
    set({ playState: "stopped" });
  });
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
        const segments = normalizeSegments(text);
        const joinedText = segments.join(" ").trim();
        if (!joinedText) {
          console.log("[TTSStore] No text to speak");
          return;
        }

        const config = normalizeTTSConfig(get().config);
        detachAndStopAllPlayers();
        _sessionGeneration += 1;
        _sessionSegments = segments;
        _sessionCurrentIndex = 0;

        console.log("[TTSStore] play called", {
          engine: config.engine,
          segments: segments.length,
          edgeVoice: config.edgeVoice,
          voiceName: config.voiceName,
          firstText: segments[0] || "",
          secondText: segments[1] || "",
          queuePreview: previewSessionSegments(segments),
        });

        set({
          playState: "loading",
          currentText: joinedText,
          currentSegmentText: segments[0] || "",
          currentChunkIndex: 0,
          totalChunks: segments.length,
        });

        startPlayback(segments, config, 0, set, get);
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
          console.log("[TTSStore] append called", {
            appended: segments.length,
            previousTotal: previousSegments.length,
            nextTotal: _sessionSegments.length,
            appendFirstText: segments[0] || "",
            appendSecondText: segments[1] || "",
            appendedPreview: previewSessionSegments(segments),
            fullQueueTailPreview: previewSessionSegments(_sessionSegments.slice(-8)),
          });
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
        console.log("[TTSStore] pause called");
        const { playState } = get();
        if (playState !== "playing" && playState !== "loading") return;
        _activeTTS?.pause();
        set({ playState: "paused" });
      },

      resume: () => {
        console.log("[TTSStore] resume called");
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

        startPlayback(remainingSegments, config, nextIndex, set, get);
      },

      stop: () => {
        console.log("[TTSStore] stop called");
        clearSleepTimerHandle();
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

      updateConfig: (updates) =>
        set((state) => ({
          config: normalizeTTSConfig({ ...state.config, ...updates }),
        })),

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
                ...(artwork ? { artwork } : {}),
              }).catch(() => {});
            }
          })
          .catch(() => {});
      },

      setCurrentLocation: (cfi) => set({ currentLocationCfi: cfi ?? "" }),

      setChunkProgress: (index, total) =>
        set({
          currentChunkIndex: index,
          totalChunks: total,
          currentSegmentText: _sessionSegments[index] || "",
        }),

      jumpToChunk: (index: number) => {
        if (index < 0 || index >= _sessionSegments.length) return;

        const config = normalizeTTSConfig(get().config);
        const remainingSegments = _sessionSegments.slice(index);
        if (remainingSegments.length === 0) {
          set({ playState: "stopped" });
          return;
        }

        console.log("[TTSStore] jumpToChunk", {
          index,
          engine: config.engine,
          segments: _sessionSegments.length,
        });

        detachAndStopAllPlayers();
        _sessionGeneration += 1;
        _sessionCurrentIndex = index;

        set({
          playState: "loading",
          currentSegmentText: _sessionSegments[index] || "",
          currentChunkIndex: index,
          totalChunks: _sessionSegments.length,
        });

        startPlayback(remainingSegments, config, index, set, get);
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
}
