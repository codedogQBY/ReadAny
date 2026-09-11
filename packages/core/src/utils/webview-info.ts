/**
 * Detect the web engine (and its version) from a user-agent string, for
 * display in Settings → About. Reader features vary per engine (@layer/:has
 * floors, execCommand, clipboard behavior), so bug reports need the engine
 * name and build, not just the app version.
 *
 * Shared by the desktop app (parses its own webview's UA) and the mobile app
 * (parses the reader WebView's UA, forwarded over the RN bridge).
 *
 * UA reference per platform (Tauri v2 desktop / system WebViews):
 *  - Windows (WebView2):  `... Windows NT 10.0 ... Chrome/138.0.0.0 Safari/537.36 Edg/138.0.3351.65`
 *  - macOS (WKWebView):   `... Macintosh ... AppleWebKit/605.1.15 ... Version/17.4 Safari/605.1.15`
 *  - iOS (WKWebView):     `... iPhone; CPU iPhone OS 17_4 like Mac OS X ... Mobile/15E148`
 *    (embedded WKWebView UAs often omit the `Version/` token entirely)
 *  - Android (WebView):   `... Android 14; ...; wv) ... Chrome/138.0.0.0 ... Version/4.0 ...`
 *    (some OEM builds omit the `; wv)` marker)
 *  - Linux (WebKitGTK):   `... X11; Linux x86_64 ... AppleWebKit/605.1.15 ...`
 *
 * Note the frozen `605.1.15` on WebKit builds: the AppleWebKit token does NOT
 * track the real WebKit version there, so Linux gets a versionless label (the
 * real version lives in the system libwebkit2gtk package, not the UA). On
 * Apple platforms prefer the `Version/` token, falling back to the `OS x_y`
 * token (the iOS/macOS release) when it is absent.
 */

export interface WebviewInfo {
  /** Engine/brand name, e.g. "WebView2", "WebKit", "Android WebView". */
  engine: string;
  /** Full version string, or "" when the UA cannot provide a reliable one. */
  version: string;
}

const match = (ua: string, pattern: RegExp): string => pattern.exec(ua)?.[1] ?? "";

/** Apple UAs carry the OS release as `OS 17_4` / `OS 10_15_7` (underscores). */
const appleOsVersion = (ua: string): string =>
  match(ua, /OS ([0-9]+(?:_[0-9]+)*)/).replace(/_/g, ".");

/**
 * @param ua the user-agent string to parse
 * @param inAppShell true when the UA comes from our own app shell (Tauri
 * desktop/mobile or the embedded reader WebView); switches on the
 * platform-specific engine labels. Generic browsers pass false.
 */
export function parseWebviewInfo(ua: string, inAppShell = true): WebviewInfo {
  if (inAppShell) {
    // Windows: WebView2 is Edge-based; `Edg/` carries the runtime version
    // (reduced by UA Reduction — see the Client Hints note in the desktop
    // wrapper for the full build).
    if (/Windows NT/.test(ua) && /Edg\//.test(ua)) {
      return { engine: "WebView2", version: match(ua, /Edg\/([0-9.]+)/) };
    }
    // Android: the system WebView identifies as Chrome with the `; wv)` token,
    // but some OEM builds omit it — any Android UA maps to the system WebView
    // (real Linux UAs never contain "Android", so this stays unambiguous).
    if (/Android/.test(ua)) {
      return { engine: "Android WebView", version: match(ua, /Chrome\/([0-9.]+)/) };
    }
    // Apple platforms: prefer the `Version/` token (Safari-style UAs); plain
    // embedded WKWebView UAs often omit it and only carry the `OS x_y` token.
    if (/iPhone|iPad|iPod/.test(ua)) {
      const version = match(ua, /Version\/([0-9.]+)/) || appleOsVersion(ua);
      return { engine: "WebKit", version };
    }
    if (/Macintosh/.test(ua)) {
      // macOS WKWebView UAs normally keep `Version/`; without it there is no
      // reliable WebKit version in the UA, so report the engine only (the
      // `OS 10_15_7` token here is the macOS release, not a WebKit build).
      return { engine: "WebKit", version: match(ua, /Version\/([0-9.]+)/) };
    }
    // Linux WebKitGTK: the UA carries no reliable version (frozen tokens).
    if (/Linux|X11/.test(ua)) {
      return { engine: "WebKitGTK", version: "" };
    }
    return { engine: "", version: "" };
  }

  // Generic browsers (plain dev server in a desktop browser).
  if (/Edg\//.test(ua)) return { engine: "Edge", version: match(ua, /Edg\/([0-9.]+)/) };
  if (/OPR\//.test(ua)) return { engine: "Opera", version: match(ua, /OPR\/([0-9.]+)/) };
  if (/Firefox\//.test(ua)) return { engine: "Firefox", version: match(ua, /Firefox\/([0-9.]+)/) };
  if (/CriOS\//.test(ua)) return { engine: "Chrome iOS", version: match(ua, /CriOS\/([0-9.]+)/) };
  if (/Chrome\//.test(ua)) return { engine: "Chrome", version: match(ua, /Chrome\/([0-9.]+)/) };
  if (/Safari\//.test(ua)) return { engine: "Safari", version: match(ua, /Version\/([0-9.]+)/) };
  return { engine: "", version: "" };
}

/** "WebView2 138.0.3351.65" / "WebKit 17.4" / "WebKitGTK" — "" when unknown. */
export function formatWebviewInfo(info: WebviewInfo): string {
  return info.engine ? (info.version ? `${info.engine} ${info.version}` : info.engine) : "";
}

/**
 * The two-line version info pasted into bug reports — the pair (app version +
 * web engine build) is what the issue template needs. Shared by the desktop
 * About card and the mobile About screen so the format cannot drift.
 */
export function buildVersionInfo(appVersion: string, webviewLabel: string): string {
  return [`ReadAny ${appVersion}`, webviewLabel].filter(Boolean).join("\n");
}
