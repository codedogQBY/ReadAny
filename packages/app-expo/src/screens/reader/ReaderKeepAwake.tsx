import { useKeepAwake } from "expo-keep-awake";
import { Platform } from "react-native";

interface ReaderKeepAwakeProps {
  enabled: boolean;
  isFocused: boolean;
}

function NativeReaderKeepAwakeClaim() {
  useKeepAwake("readany-reader");
  return null;
}

/** Owns Android's native keep-screen-on claim only while the reader is visible. */
export function ReaderKeepAwake({ enabled, isFocused }: ReaderKeepAwakeProps) {
  if (Platform.OS !== "android" || !enabled || !isFocused) return null;
  return <NativeReaderKeepAwakeClaim />;
}
