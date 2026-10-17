import { NativeModule, requireNativeModule } from "expo";
import { Platform } from "react-native";

type SystemTtsSynthesisEvents = {
  SystemTtsPlayback: (payload: {
    type: "state" | "chunk" | "range" | "progress" | "next" | "previous" | "seek" | "error" | "end";
    state?: "playing" | "paused" | "stopped";
    index?: number;
    total?: number;
    start?: number;
    end?: number;
    position?: number;
    duration?: number;
    message?: string;
  }) => void;
};

declare class SystemTtsSynthesisModule extends NativeModule<SystemTtsSynthesisEvents> {
  getVoices(): Promise<
    Array<{
      identifier: string;
      name: string;
      language: string;
      quality: "Default" | "Enhanced";
    }>
  >;
  synthesizeToFile(
    text: string,
    options: {
      rate?: number;
      pitch?: number;
      language?: string;
      voice?: string;
    },
  ): Promise<string>;
  speak(
    segments: string[],
    options: {
      rate?: number;
      pitch?: number;
      language?: string;
      voice?: string;
    },
    startIndex: number,
  ): Promise<number>;
  setPlaybackOptions(options: {
    rate?: number;
    pitch?: number;
    language?: string;
    voice?: string;
  }): void;
  pause(): void;
  resume(): void;
  stopPlayback(): void;
  seekToChunk(index: number): void;
  append(segments: string[]): boolean;
  setMetadata(title: string, artist: string, album: string, artwork?: string): void;
}

const noop = {
  getVoices: async () => [],
  synthesizeToFile: async () => {
    throw new Error("SystemTtsSynthesis module is unavailable");
  },
  speak: async () => {
    throw new Error("SystemTtsSynthesis module is unavailable");
  },
  setPlaybackOptions: () => {},
  pause: () => {},
  resume: () => {},
  stopPlayback: () => {},
  seekToChunk: () => {},
  append: () => false,
  setMetadata: () => {},
  addListener: () => ({ remove: () => {} }),
} as unknown as SystemTtsSynthesisModule;

function resolveModule(): SystemTtsSynthesisModule {
  if (Platform.OS !== "android" && Platform.OS !== "ios") return noop;
  try {
    return requireNativeModule<SystemTtsSynthesisModule>("SystemTtsSynthesis");
  } catch {
    return noop;
  }
}

const mod = resolveModule();

export function isSystemTtsSynthesisAvailable(): boolean {
  return (Platform.OS === "android" || Platform.OS === "ios") && mod !== noop;
}

export function canUseSystemTtsDirectPlayback(): boolean {
  return Platform.OS === "android" && mod !== noop;
}

export default mod;
