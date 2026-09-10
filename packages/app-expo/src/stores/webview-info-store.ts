import { formatWebviewInfo, parseWebviewInfo } from "@readany/core/utils/webview-info";
import { Platform } from "react-native";
import { create } from "zustand";

interface WebviewInfoState {
  /**
   * navigator.userAgent of the reader WebView, forwarded once per page load
   * by reader.html over the RN bridge (`type: "readany-ua"`), and at startup
   * by the hidden UAProbe webview. The mobile app itself has no real UA
   * (App.tsx polyfills a "ReactNative" placeholder), so the reader WebView is
   * the source of truth for the engine/version shown in Settings → About.
   */
  ua: string | null;
  /**
   * Full build from Client Hints (e.g. 138.0.7204.67) — the plain UA parse
   * yields a reduced x.0.0.0 on modern Chromium WebViews.
   */
  fullVersion: string | null;
  setUa: (ua: string, fullVersion?: string | null) => void;
}

export const useWebviewInfoStore = create<WebviewInfoState>((set) => ({
  ua: null,
  fullVersion: null,
  setUa: (ua, fullVersion) =>
    set({
      ua,
      // Reader bridge messages carry no fullVersion — keep the probe's value.
      ...(fullVersion !== undefined ? { fullVersion } : {}),
    }),
}));

/** Engine-only label when no UA has been reported yet. */
const FALLBACK_LABELS: Partial<Record<string, string>> = {
  ios: "WebKit",
  android: "Android WebView",
};

/**
 * Engine + build label for About and feedback payloads
 * ("Android WebView 138.0.7204.67"). Before the probe/bridge has reported a
 * UA, falls back to the engine name only.
 */
export function useWebviewLabel(): string {
  const ua = useWebviewInfoStore((s) => s.ua);
  const fullVersion = useWebviewInfoStore((s) => s.fullVersion);
  const parsed = ua ? parseWebviewInfo(ua) : null;
  // Key the fallback on a missing engine (not on a missing UA): an
  // unrecognized WebView UA must not make the label silently disappear.
  if (!parsed?.engine) {
    return FALLBACK_LABELS[Platform.OS] ?? "";
  }
  return formatWebviewInfo({ ...parsed, version: fullVersion ?? parsed.version });
}
