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
