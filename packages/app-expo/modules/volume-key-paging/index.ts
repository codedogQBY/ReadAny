import { NativeModule, requireNativeModule } from "expo";
import { Platform } from "react-native";

type VolumeKeyPagingEvents = {
  VolumeKeyPaging: (payload: { direction: "prev" | "next" }) => void;
};

declare class VolumeKeyPagingModule extends NativeModule<VolumeKeyPagingEvents> {
  setEnabled(enabled: boolean): void;
}

const noop = {
  setEnabled: () => {},
  addListener: () => ({ remove: () => {} }),
} as unknown as VolumeKeyPagingModule;

function resolveModule(): VolumeKeyPagingModule {
  if (Platform.OS !== "android") return noop;
  try {
    return requireNativeModule<VolumeKeyPagingModule>("VolumeKeyPaging");
  } catch {
    return noop;
  }
}

const mod: VolumeKeyPagingModule = resolveModule();

export default mod;
