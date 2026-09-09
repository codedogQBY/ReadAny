/**
 * Web-engine detection for the desktop app (Settings → About). The parsing
 * itself lives in core (packages/core/src/utils/webview-info.ts) so the mobile
 * app can parse the reader WebView's UA with identical results; this wrapper
 * only adds the Tauri-runtime check and the Chromium Client Hints lookup.
 *
 * Version floors differ per engine (e.g. :has() needs WebView2 ≥ 105 /
 * WebKitGTK ≥ 2.36), which is exactly why the exact build matters. Detection
 * is display-only diagnostics, not a security boundary.
 */

import { parseWebviewInfo } from "@readany/core/utils/webview-info";
import type { WebviewInfo } from "@readany/core/utils/webview-info";

/** True when running inside a Tauri webview (vs. plain `vite` dev in a browser). */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function getWebviewInfo(ua: string = navigator.userAgent): WebviewInfo {
  return parseWebviewInfo(ua, isTauriRuntime());
}

/**
 * Chromium's UA Reduction freezes the minor/build/patch numbers in the UA
 * string (Edg/152.0.0.0 on a 152.0.4191.62 runtime), so the UA-parsed version
 * is incomplete on WebView2/Chrome/Android WebView. The real build is only in
 * the User-Agent Client Hints `fullVersionList` (high-entropy), per brand:
 * WebView2 reports "Microsoft Edge", Android WebView reports "Android
 * WebView". Safari/Firefox/WebKitGTK have no client hints and keep the UA
 * value (or none at all for WebKitGTK).
 */
const CLIENT_HINT_BRANDS: Record<string, string> = {
  WebView2: "Microsoft Edge",
  Edge: "Microsoft Edge",
  "Android WebView": "Android WebView",
  Chrome: "Google Chrome",
};

async function getFullVersionFromClientHints(engine: string): Promise<string | null> {
  const brand = CLIENT_HINT_BRANDS[engine];
  if (!brand) return null;
  try {
    const uaData = (
      navigator as unknown as {
        userAgentData?: {
          getHighEntropyValues?: (
            hints: string[],
          ) => Promise<{ fullVersionList?: { brand: string; version: string }[] }>;
        };
      }
    ).userAgentData;
    const getHighEntropyValues = uaData?.getHighEntropyValues;
    if (typeof getHighEntropyValues !== "function") return null;
    const { fullVersionList } = await getHighEntropyValues.call(uaData, ["fullVersionList"]);
    return fullVersionList?.find((entry) => entry.brand === brand)?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * Display label for Settings → About, async because the full version needs a
 * round-trip through the Client Hints API on Chromium engines. Falls back to
 * the UA-parsed (reduced) version when Client Hints are unavailable.
 */
export async function getWebviewLabel(): Promise<string> {
  const { engine, version } = getWebviewInfo();
  if (!engine) return "";
  const fullVersion = (await getFullVersionFromClientHints(engine)) || version;
  return fullVersion ? `${engine} ${fullVersion}` : engine;
}
