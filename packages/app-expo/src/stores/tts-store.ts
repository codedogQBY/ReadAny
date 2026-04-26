import {
  DEFAULT_TTS_CONFIG,
  normalizeTTSConfig,
  splitNarrationText,
  type ITTSPlayer,
  type TTSConfig,
} from "@readany/core/tts";
import { ExpoAVEdgeTTSPlayer } from "../lib/platform/expo-av-edge-player";
import { ExpoSpeechTTSPlayer } from "../lib/platform/expo-speech-player";
import { create } from "zustand";
import { withPersist } from "./persist";

export type TTSPlayState = "stopped" | "playing" | "paused" | "loading";

export interface TTSPlayerFactories {
  createSystemTTS: () => ITTSPlayer;
  createEdgeTTS: () => ITTSPlayer;
  createDashScopeTTS: () => ITTSPlayer;
  createMiMoTTS: () => ITTSPlayer;
}

const defaultFactories: TTSPlayerFactories = {
  createSystemTTS: () => new ExpoSpeechTTSPlayer(),
  createEdgeTTS: () => new ExpoAVEdgeTTSPlayer(),
  // DashScope streaming is not wired on RN yet; keep a predictable system fallback.
  createDashScopeTTS: () => new ExpoSpeechTTSPlayer(),
  // MiMo cloud audio playback is not wired on RN yet; keep a predictable system fallback.
  createMiMoTTS: () => new ExpoSpeechTTSPlayer(),
};

let _factories: TTSPlayerFactories = defaultFactories;
let _systemTTS: ITTSPlayer | null = null;
let _edgeTTS: ITTSPlayer | null = null;
let _dashscopeTTS: ITTSPlayer | null = null;
let _mimoTTS: ITTSPlayer | null = null;

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

function getMiMoTTS(): ITTSPlayer {
  if (!_mimoTTS) _mimoTTS = _factories.createMiMoTTS();
  return _mimoTTS;
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
  detachAndStopPlayer(_systemTTS);
  detachAndStopPlayer(_edgeTTS);
  detachAndStopPlayer(_dashscopeTTS);
  detachAndStopPlayer(_mimoTTS);
}

function normalizeSegments(text: string | string[]): string[] {
  if (Array.isArray(text)) {
    return text.map((segment) => segment.trim()).filter(Boolean);
  }
  return splitNarrationText(text).map((segment) => segment.trim()).filter(Boolean);
}

function getPlayerForConfig(config: TTSConfig): ITTSPlayer {
  if (config.engine === "dashscope" && config.dashscopeApiKey) {
    return getDashScopeTTS();
  }
  if (config.engine === "edge") {
    return getEdgeTTS();
  }
  if (config.engine === "mimo" && config.mimoApiKey) {
    return getMiMoTTS();
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

  player.onStateChange = (playState) => {
    if (gen !== _sessionGeneration) return;
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

  const playback = player.speak(segments, config);
  void Promise.resolve(playback).catch((error) => {
    if (gen !== _sessionGeneration) return;
    console.error("[TTSStore] play failed:", error);
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
  currentLocationCfi: string;
  currentChunkIndex: number;
  totalChunks: number;
  sleepTimerEndsAt: number | null;
  sleepTimerDurationMinutes: number | null;

  play: (text: string | string[]) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  toggle: (text?: string) => void;
  updateConfig: (updates: Partial<TTSConfig>) => void;
  setPlayState: (state: TTSPlayState) => void;
  setOnEnd: (cb: (() => void) | null) => void;
  setCurrentBook: (title: string, chapter: string, bookId?: string) => void;
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

      pause: () => {
        console.log("[TTSStore] pause called");
        const { playState } = get();
        if (playState !== "playing" && playState !== "loading") return;
        _sessionGeneration += 1;
        detachAndStopAllPlayers();
        set({ playState: "paused" });
      },

      resume: () => {
        console.log("[TTSStore] resume called");
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

      setCurrentBook: (title, chapter, bookId) =>
        set({ currentBookTitle: title, currentChapterTitle: chapter, currentBookId: bookId ?? "" }),

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
  _mimoTTS = null;
}
