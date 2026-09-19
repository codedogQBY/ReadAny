/**
 * Web-engine detection for the desktop app (Settings → About). The parsing
 * itself lives in core (packages/core/src/utils/webview-info.ts) so the mobile
 * app can parse the reader WebView's UA with identical results; this wrapper
 * adds the Tauri-runtime check and the runtime version query.
 *
 * Inside the Tauri runtime, BOTH the engine label and the version come from
 * the runtime query (`tauri::webview_version()` + an OS→engine mapping):
 * the User-Agent is reduced to a stub on Windows WebView2 (UA Reduction) and
 * carries frozen fallback tokens for the WebKit engines, so the runtime is
 * the only reliable source on every desktop platform. The UA parse is the
 * fallback path — plain `vite` dev in a browser or a failed command — where
 * the version is reduced on WebView2 and frozen on WebKit.
 *
 * Version floors differ per engine (e.g. :has() needs WebView2 ≥ 105 /
 * WebKitGTK ≥ 2.36), which is exactly why the exact build matters. Detection
 * is display-only diagnostics, not a security boundary.
 */

import { invoke } from "@tauri-apps/api/core";
import { formatWebviewInfo, parseWebviewInfo } from "@readany/core/utils/webview-info";
import type { WebviewInfo } from "@readany/core/utils/webview-info";

/** True when running inside a Tauri webview (vs. plain `vite` dev in a browser). */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function getWebviewInfo(ua: string = navigator.userAgent): WebviewInfo {
  return parseWebviewInfo(ua, isTauriRuntime());
}

/**
 * Display label for Settings → About, async because the real build number
 * needs a round-trip to the Rust runtime. Inside the Tauri runtime the
 * command's OS→engine mapping + runtime build is the authority (it answers
 * even when the UA parse comes up empty); the UA parse is the fallback when
 * the command is unavailable — plain `vite` dev in a browser, or a failed
 * invoke — with the version reduced on WebView2 in that path.
 */
export async function getWebviewLabel(): Promise<string> {
  if (isTauriRuntime()) {
    try {
      const native = await invoke<WebviewInfo | null>("get_webview_version");
      // The runtime's OS→engine mapping is the desktop authority — prefer it
      // over the UA parse so the two can never disagree on the same machine.
      if (native?.engine && native.version) {
        return formatWebviewInfo({ engine: native.engine, version: native.version });
      }
    } catch (error) {
      console.warn("[webview-info] get_webview_version failed, falling back to UA:", error);
    }
  }
  const { engine, version } = getWebviewInfo();
  return formatWebviewInfo({ engine, version });
}
