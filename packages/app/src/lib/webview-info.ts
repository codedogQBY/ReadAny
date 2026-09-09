/**
 * Detect the web engine (and its version) the app is running in, for display
 * in Settings → About. This mirrors the engine axis our reader features vary
 * on (@layer/:has/execCommand/clipboard all behave differently per engine),
 * so bug reports can name the engine instead of "it doesn't work".
 *
 * Version floors differ per engine (e.g. :has() needs WebView2 ≥ 105 /
 * WebKitGTK ≥ 2.36), which is exactly why the exact build matters.
 *
 * Detection is user-agent based. UA strings are not a security boundary here —
 * this is display-only diagnostics.
 *
 * UA reference per platform (Tauri v2):
 *  - Windows (WebView2):  `... Windows NT 10.0 ... AppleWebKit/537.36 ... Chrome/138.0.0.0 Safari/537.36 Edg/138.0.3351.65`
 *  - macOS (WKWebView):   `... Macintosh ... AppleWebKit/605.1.15 ... Version/17.4 Safari/605.1.15`
 *  - iOS (WKWebView):     `... iPhone ... Version/17.4 Mobile/15E148 Safari/604.1`
 *  - Android (WebView):   `... Android 14; ...; wv) ... Chrome/138.0.0.0 ... Version/4.0 ...`
 *  - Linux (WebKitGTK):   `... X11; Linux x86_64 ... AppleWebKit/605.1.15 ...`
 *
 * Note the frozen `605.1.15` on WebKit builds: the AppleWebKit token does NOT
 * track the real WebKit version there, so Linux falls back to a versionless
 * label (the real version lives in the system package, not the UA).
 */

export interface WebviewInfo {
  /** Engine/brand name, e.g. "WebView2", "WebKit", "Android WebView". */
  engine: string;
  /** Full version string, or "" when the UA cannot provide a reliable one. */
  version: string;
}

const match = (ua: string, pattern: RegExp): string => pattern.exec(ua)?.[1] ?? "";

/** True when running inside a Tauri webview (vs. plain `vite` dev in a browser). */
export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function getWebviewInfo(ua: string = navigator.userAgent): WebviewInfo {
  const inTauri = isTauriRuntime();

  // ── Tauri desktop/mobile shells ─────────────────────────────────────────
  if (inTauri) {
    // Windows: WebView2 is Edge-based; `Edg/` carries the real runtime version.
    if (/Windows NT/.test(ua) && /Edg\//.test(ua)) {
      return { engine: "WebView2", version: match(ua, /Edg\/([0-9.]+)/) };
    }
    // Android: the system WebView identifies as Chrome with the `; wv)` token.
    if (/Android/.test(ua) && /;\s*wv\)/.test(ua)) {
      return { engine: "Android WebView", version: match(ua, /Chrome\/([0-9.]+)/) };
    }
    // iOS WKWebView: `Version/` tracks the system WebKit (unlike macOS' frozen
    // AppleWebKit token) — e.g. Version/17.4.
    if (/iPhone|iPad|iPod/.test(ua)) {
      const version = match(ua, /Version\/([0-9.]+)/);
      return { engine: "WebKit", version };
    }
    // macOS WKWebView: `Version/` follows the system WebKit release
    // (e.g. Version/17.4); the AppleWebKit token is frozen at 605.1.15.
    if (/Macintosh/.test(ua)) {
      return { engine: "WebKit", version: match(ua, /Version\/([0-9.]+)/) };
    }
    // Linux WebKitGTK: the UA carries no reliable version (frozen tokens), so
    // report the engine without one — the real version is the system's
    // libwebkit2gtk package.
    if (/Linux|X11/.test(ua)) {
      return { engine: "WebKitGTK", version: "" };
    }
  }

  // ── Generic browsers (plain `vite` dev in a desktop browser) ────────────
  if (/Edg\//.test(ua)) return { engine: "Edge", version: match(ua, /Edg\/([0-9.]+)/) };
  if (/OPR\//.test(ua)) return { engine: "Opera", version: match(ua, /OPR\/([0-9.]+)/) };
  if (/Firefox\//.test(ua)) return { engine: "Firefox", version: match(ua, /Firefox\/([0-9.]+)/) };
  if (/CriOS\//.test(ua)) return { engine: "Chrome iOS", version: match(ua, /CriOS\/([0-9.]+)/) };
  if (/Chrome\//.test(ua)) return { engine: "Chrome", version: match(ua, /Chrome\/([0-9.]+)/) };
  if (/Safari\//.test(ua)) {
    return { engine: "Safari", version: match(ua, /Version\/([0-9.]+)/) };
  }
  return { engine: "", version: "" };
}

/** "WebView2 138.0.3351.65" / "WebKit 17.4" / "WebKitGTK" — "" when unknown. */
export function formatWebviewInfo(ua: string = navigator.userAgent): string {
  const { engine, version } = getWebviewInfo(ua);
  return engine ? (version ? `${engine} ${version}` : engine) : "";
}
