import { NativeModule, requireNativeModule } from "expo";
import { Platform } from "react-native";

declare class SystemTtsSynthesisModule extends NativeModule {
  synthesizeToFile(
    text: string,
    options: {
      rate?: number;
      pitch?: number;
      language?: string;
      voice?: string;
    },
  ): Promise<string>;
}

const noop = {
  synthesizeToFile: async () => {
    throw new Error("SystemTtsSynthesis module is unavailable");
  },
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

export default mod;
