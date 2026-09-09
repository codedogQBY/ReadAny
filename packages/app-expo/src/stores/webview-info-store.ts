import { create } from "zustand";

interface WebviewInfoState {
  /**
   * navigator.userAgent of the reader WebView, forwarded once per page load
   * by reader.html over the RN bridge (`type: "readany-ua"`). The mobile app
   * itself has no real UA (App.tsx polyfills a "ReactNative" placeholder), so
   * the reader WebView is the source of truth for the engine/version shown in
   * Settings → About. Null until a book has been opened.
   */
  ua: string | null;
  setUa: (ua: string) => void;
}

export const useWebviewInfoStore = create<WebviewInfoState>((set) => ({
  ua: null,
  setUa: (ua) => set({ ua }),
}));
