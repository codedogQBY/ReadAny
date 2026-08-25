/**
 * TTS Store — Zustand store for TTS state and configuration.
 *
 * Manages:
 * - Playback state (playing/paused/stopped)
 * - TTS configuration (engine, voice, rate, pitch, DashScope key)
 * - Persists config to FS
 *
 * Cross-platform: player factories are injectable. By default uses a Web-based
 * system TTS player plus EdgeTTSPlayer/DashScopeTTSPlayer. Platforms without Web Audio
 * (e.g. React Native) can override via `setTTSPlayerFactories()`.
 */
import { create } from "zustand";
import {
  VOICE_RESPEAK_DEBOUNCE_MS,
  isActivePlay,
  shouldRespeakForSynthChange,
} from "../tts/respeak";
import {
  BrowserTTSPlayer,
  DashScopeTTSPlayer,
  EdgeTTSPlayer,
  OpenAICompatibleTTSPlayer,
  XiaomiTTSPlayer,
} from "../tts/tts-players";
import { LegacyPlayerProvider, TTSCoordinator } from "../tts/coordinator";
import type { ITTSPlayer, TTSConfig, TTSProfile } from "../tts/types";
import { DEFAULT_TTS_CONFIG, normalizeTTSConfig } from "../tts/types";
import { withPersist } from "./persist";

export type TTSPlayState = "stopped" | "playing" | "paused" | "loading";

/**
 * TTS player factory interface — allows platforms to provide custom player implementations.
 */
export interface TTSPlayerFactories {
  createSystemTTS: () => ITTSPlayer;
  createEdgeTTS: () => ITTSPlayer;
  createDashScopeTTS: () => ITTSPlayer;
  createXiaomiTTS: () => ITTSPlayer;
  createOpenAICompatibleTTS: () => ITTSPlayer;
}

/** Default Web-based factories */
const defaultFactories: TTSPlayerFactories = {
  createSystemTTS: () => new BrowserTTSPlayer(),
  createEdgeTTS: () => new EdgeTTSPlayer(),
  createDashScopeTTS: () => new DashScopeTTSPlayer(),
  createXiaomiTTS: () => new XiaomiTTSPlayer(),
  createOpenAICompatibleTTS: () => new OpenAICompatibleTTSPlayer(),
};

let _factories: TTSPlayerFactories = defaultFactories;

/**
 * Override TTS player factories for platforms that cannot use Web Audio APIs.
 * Call this at app startup before any TTS playback.
 *
 * Example (React Native):
 *   setTTSPlayerFactories({
 *     createSystemTTS: () => new ExpoSpeechTTSPlayer(),
 *     createEdgeTTS: () => new ExpoAVEdgeTTSPlayer(),
 *     createDashScopeTTS: () => new ExpoAVDashScopeTTSPlayer(),
 *   });
 */
export function setTTSPlayerFactories(factories: Partial<TTSPlayerFactories>): void {
  _factories = { ...defaultFactories, ...factories };
  // Reset cached instances so new factories take effect
  _systemTTS = null;
  _edgeTTS = null;
  _dashscopeTTS = null;
  _xiaomiTTS = null;
  _openAICompatibleTTS = null;
}

/** Lazily-created singleton TTS player instances */
let _systemTTS: ITTSPlayer | null = null;
let _edgeTTS: ITTSPlayer | null = null;
let _dashscopeTTS: ITTSPlayer | null = null;
let _xiaomiTTS: ITTSPlayer | null = null;
let _openAICompatibleTTS: ITTSPlayer | null = null;
let _coordinator: TTSCoordinator | null = null;
let _sessionSegments: string[] = [];
let _sessionCurrentIndex = 0;
let _sleepTimerHandle: ReturnType<typeof setTimeout> | null = null;
/** Voice the active DashScope run is synthesizing with; lets resume() decide whether
 *  it can true-resume (voice unchanged) or must re-speak (voice changed). */
let _dashscopeActiveVoice: string | undefined;

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

  const profiles = sourceProfiles.map((profile) =>
    profile.id === targetProfileId ? { ...profile, ...profileUpdates } : profile,
  );

  return { ...updates, profiles };
}

function getPlayerForConfig(config: TTSConfig): ITTSPlayer {
  if (config.engine === "dashscope" && config.dashscopeApiKey) {
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
  /** Current playback state */
  playState: TTSPlayState;
  /** Current text being spoken */
  currentText: string;
  /** TTS configuration (persisted) */
  config: TTSConfig;
  /** Callback invoked when current text finishes playing naturally (not by stop) */
  onEnd: (() => void) | null;
  /** Index of the currently-speaking chunk (0-based) */
  currentChunkIndex: number;
  /** Total number of chunks for the current text */
  totalChunks: number;
  /** Title of the book currently being read (for floating bubble display) */
  currentBookTitle: string;
  /** Chapter title currently being read (for floating bubble display) */
  currentChapterTitle: string;
  /** Book ID currently being read (for navigation back to reader) */
  currentBookId: string;
  /** Current reading CFI for jump-back from floating mini-player */
  currentLocationCfi: string;
  /** Absolute timestamp when playback should stop automatically */
  sleepTimerEndsAt: number | null;
  /** Original timer length selected by the user, in minutes */
  sleepTimerDurationMinutes: number | null;

  // Actions
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
  /** Jump to a specific chunk index within the current session, restarting speech from that point */
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
      config: DEFAULT_TTS_CONFIG,
      onEnd: null,
      currentChunkIndex: 0,
      totalChunks: 0,
      currentBookTitle: "",
      currentChapterTitle: "",
      currentBookId: "",
      currentLocationCfi: "",
      sleepTimerEndsAt: null,
      sleepTimerDurationMinutes: null,

      play: (text: string | string[]) => {
        clearRespeakTimer();
        const config = normalizeTTSConfig(get().config);
        _dashscopeActiveVoice = config.dashscopeVoice;
        const segments = Array.isArray(text)
          ? text.map((item) => item.trim()).filter(Boolean)
          : [text.trim()].filter(Boolean);
        const sessionSegments =
          segments.length > 0
            ? segments
            : [Array.isArray(text) ? text.join(" ").trim() : text.trim()].filter(Boolean);
        _sessionSegments = sessionSegments;
        _sessionCurrentIndex = 0;
        set({
          playState: "loading",
          currentText: sessionSegments.join(" "),
          currentChunkIndex: 0,
          totalChunks: sessionSegments.length,
        });

        const player = getPlayerForConfig(config);
        _coordinator = new TTSCoordinator(config, undefined, {
          onStateChange: (state) =>
            set({
              playState:
                state.status === "playing"
                  ? "playing"
                  : state.status === "paused"
                    ? "paused"
                    : state.status === "loading"
                      ? "loading"
                      : "stopped",
            }),
          onSegment: (index, total) => {
            _sessionCurrentIndex = index;
            set({ currentChunkIndex: index, totalChunks: total });
          },
          onEnd: () => {
            get().onEnd?.();
          },
          onError: (error) => {
            console.error("[TTS] coordinator error", error);
            set({ playState: "stopped" });
          },
        });
        _coordinator.play(text, new LegacyPlayerProvider(player, config.engine));
      },

      pause: () => {
        clearRespeakTimer();
        const { playState } = get();
        if (playState !== "playing" && playState !== "loading") return;
        _coordinator?.pause();
      },

      resume: () => {
        const { playState } = get();
        if (playState !== "paused") return;
        _coordinator?.resume();
      },

      stop: () => {
        clearSleepTimerHandle();
        clearRespeakTimer();
        _coordinator?.stop();
        _coordinator = null;
        _sessionSegments = [];
        _sessionCurrentIndex = 0;
        _dashscopeActiveVoice = undefined;
        set({
          playState: "stopped",
          currentText: "",
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
        const { playState, currentText, play, pause, resume } = get();
        if (playState === "playing" || playState === "loading") {
          pause();
        } else if (playState === "paused") {
          resume();
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
        const engineChanged =
          updates.engine !== undefined && nextConfig.engine !== previousConfig.engine;
        const wasPlaying = isActivePlay(get().playState);
        set({ config: nextConfig });
        _coordinator?.updateConfig(nextConfig);

        if (engineChanged && wasPlaying) {
          clearRespeakTimer();
          const activePlayer = getPlayerForConfig(previousConfig);
          activePlayer.onStateChange = undefined;
          activePlayer.onChunkChange = undefined;
          activePlayer.onEnd = undefined;
          activePlayer.onError = undefined;
          activePlayer.stop();
          _coordinator = null;
          _dashscopeActiveVoice = undefined;
          set({ playState: "stopped" });
          return;
        }

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

      setOnEnd: (cb) => set({ onEnd: cb }),

      setCurrentBook: (title, chapter, bookId) =>
        set({ currentBookTitle: title, currentChapterTitle: chapter, currentBookId: bookId ?? "" }),

      setCurrentLocation: (cfi) => set({ currentLocationCfi: cfi ?? "" }),

      setChunkProgress: (index, total) => set({ currentChunkIndex: index, totalChunks: total }),

      jumpToChunk: (index: number) => {
        clearRespeakTimer();
        if (index < 0 || index >= _sessionSegments.length) return;
        if (_coordinator) {
          _coordinator.jumpTo({ offset: _sessionSegments.slice(0, index).join(" ").length });
          return;
        }
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
