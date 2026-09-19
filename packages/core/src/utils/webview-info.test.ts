import { describe, expect, it } from "vitest";
import { formatWebviewInfo, parseWebviewInfo } from "./webview-info";

/** Real-world UA samples per engine/platform (see the header docs). */
const UAS = {
  windowsWebView2:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0",
  macosWKWebView:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  macosWKWebViewNoVersion:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)",
  iosWKWebView:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  androidWebView:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.7204.67 Mobile Safari/537.36",
  androidNoWv:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36",
  linuxWebKitGTK:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  chromeDesktop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
} as const;

describe("parseWebviewInfo (in-app shell)", () => {
  it("maps a Windows UA to WebView2 with the Edg token version", () => {
    expect(parseWebviewInfo(UAS.windowsWebView2)).toEqual({
      engine: "WebView2",
      version: "138.0.0.0",
    });
  });

  it("maps an Android WebView UA (with wv marker) to Android WebView", () => {
    expect(parseWebviewInfo(UAS.androidWebView)).toEqual({
      engine: "Android WebView",
      version: "138.0.7204.67",
    });
  });

  it("maps an Android UA without the wv marker to Android WebView too", () => {
    // Some OEM builds omit `; wv)` — must not fall through to WebKitGTK.
    expect(parseWebviewInfo(UAS.androidNoWv).engine).toBe("Android WebView");
  });

  it("maps an iOS WKWebView UA without Version/ via the OS token", () => {
    const parsed = parseWebviewInfo(UAS.iosWKWebView);
    expect(parsed.engine).toBe("WebKit");
    expect(parsed.version).toBe("17.4");
  });

  it("maps a macOS WKWebView UA via the Version/ token", () => {
    expect(parseWebviewInfo(UAS.macosWKWebView)).toEqual({
      engine: "WebKit",
      version: "17.4",
    });
  });

  it("keeps the macOS label versionless when no Version/ token exists", () => {
    const parsed = parseWebviewInfo(UAS.macosWKWebViewNoVersion);
    expect(parsed.engine).toBe("WebKit");
    expect(parsed.version).toBe("");
  });

  it("maps a Linux WebKitGTK UA to WebKitGTK without a UA version", () => {
    const parsed = parseWebviewInfo(UAS.linuxWebKitGTK);
    expect(parsed.engine).toBe("WebKitGTK");
    expect(parsed.version).toBe("");
  });
});

describe("parseWebviewInfo (generic browsers, inAppShell=false)", () => {
  it("detects desktop Chrome", () => {
    expect(parseWebviewInfo(UAS.chromeDesktop, false)).toEqual({
      engine: "Chrome",
      version: "138.0.0.0",
    });
  });

  it("detects Firefox", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0";
    expect(parseWebviewInfo(ua, false).engine).toBe("Firefox");
  });

  it("returns empty for an unrecognizable UA", () => {
    expect(parseWebviewInfo("", false)).toEqual({ engine: "", version: "" });
  });
});

describe("formatWebviewInfo", () => {
  it("joins engine and version", () => {
    expect(formatWebviewInfo({ engine: "WebView2", version: "138.0.0.0" })).toBe(
      "WebView2 138.0.0.0",
    );
  });

  it("omits the version when empty", () => {
    expect(formatWebviewInfo({ engine: "WebKitGTK", version: "" })).toBe("WebKitGTK");
  });

  it("returns an empty string for an unknown engine", () => {
    expect(formatWebviewInfo({ engine: "", version: "" })).toBe("");
  });
});
