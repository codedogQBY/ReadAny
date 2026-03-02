/**
 * TTS Store — Zustand store for TTS state and configuration.
 *
 * Manages:
 * - Playback state (playing/paused/stopped)
 * - TTS configuration (engine, voice, rate, pitch, DashScope key)
 * - Persists config to localStorage
 */
import { create } from "zustand";
import {
  type TTSConfig,
  DEFAULT_TTS_CONFIG,
  browserTTS,
  dashscopeTTS,
} from "@/lib/tts/tts-service";
import { withPersist } from "./persist";

export type TTSPlayState = "stopped" | "playing" | "paused" | "loading";

export interface TTSState {
  /** Current playback state */
  playState: TTSPlayState;
  /** Current text being spoken */
  currentText: string;
  /** TTS configuration (persisted) */
  config: TTSConfig;
  /** Callback invoked when current text finishes playing naturally (not by stop) */
  onEnd: (() => void) | null;

  // Actions
  play: (text: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  toggle: (text?: string) => void;
  updateConfig: (updates: Partial<TTSConfig>) => void;
  setPlayState: (state: TTSPlayState) => void;
  setOnEnd: (cb: (() => void) | null) => void;
}

export const useTTSStore = create<TTSState>()(
  withPersist("tts", (set, get) => ({
    playState: "stopped",
    currentText: "",
    config: DEFAULT_TTS_CONFIG,
    onEnd: null,

    play: (text: string) => {
      const { config, onEnd } = get();
      set({ playState: "loading", currentText: text });

      const onState = (state: "playing" | "paused" | "stopped") => {
        set({ playState: state });
      };

      const handleEnd = () => {
        // Re-read from store in case it was updated
        const currentOnEnd = get().onEnd;
        currentOnEnd?.();
      };

      if (config.engine === "dashscope" && config.dashscopeApiKey) {
        dashscopeTTS.onStateChange = onState;
        dashscopeTTS.onEnd = handleEnd;
        dashscopeTTS.speak(text, config);
      } else {
        browserTTS.onStateChange = onState;
        browserTTS.onEnd = handleEnd;
        browserTTS.speak(text, config);
      }
    },

    pause: () => {
      const { config } = get();
      if (config.engine === "dashscope" && config.dashscopeApiKey) {
        dashscopeTTS.pause();
      } else {
        browserTTS.pause();
      }
    },

    resume: () => {
      const { config } = get();
      if (config.engine === "dashscope" && config.dashscopeApiKey) {
        dashscopeTTS.resume();
      } else {
        browserTTS.resume();
      }
    },

    stop: () => {
      browserTTS.onEnd = undefined;
      dashscopeTTS.onEnd = undefined;
      browserTTS.stop();
      dashscopeTTS.stop();
      set({ playState: "stopped", currentText: "" });
    },

    toggle: (text?: string) => {
      const { playState, currentText, play, pause, resume, stop } = get();
      if (playState === "playing") {
        pause();
      } else if (playState === "paused") {
        resume();
      } else if (text) {
        play(text);
      } else if (currentText) {
        play(currentText);
      }
    },

    updateConfig: (updates) =>
      set((s) => ({
        config: { ...s.config, ...updates },
      })),

    setPlayState: (playState) => set({ playState }),

    setOnEnd: (cb) => set({ onEnd: cb }),
  })),
);
