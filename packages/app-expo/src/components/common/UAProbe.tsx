import { useWebviewInfoStore } from "@/stores/webview-info-store";
import { View } from "react-native";
import { WebView } from "react-native-webview";

const PROBE_HTML =
  "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width, initial-scale=1'></head><body></body></html>";

// The UA string is reduced (Chrome/138.0.0.0) on modern Chromium WebViews, so
// also ask Client Hints for the fullVersionList of the matching brand — the
// About screen then shows the real build (e.g. 138.0.7204.67) instead of
// x.0.0.0. Mirrors the desktop client-hints logic in lib/webview-info.ts.
const INJECTED_JS = `(async () => {
  let fullVersion = null;
  try {
    const uaData = navigator.userAgentData;
    if (uaData && typeof uaData.getHighEntropyValues === "function") {
      const { fullVersionList } = await uaData.getHighEntropyValues(["fullVersionList"]);
      const hit = (fullVersionList || []).find((b) => /Android WebView|Microsoft Edge/i.test(b.brand));
      if (hit) fullVersion = hit.version;
    }
  } catch (e) {}
  ReactNativeWebView.postMessage(JSON.stringify({ type: "readany-ua", ua: navigator.userAgent, fullVersion }));
})(); true;`;

/**
 * A 0×0 hidden WebView that reports the system WebView's real
 * navigator.userAgent (plus the full build via Client Hints) to the
 * webview-info store, then unmounts.
 *
 * The RN layer has no real UA (App.tsx polyfills "ReactNative"), and our only
 * other webview — the reader — mounts per book. This probe makes
 * Settings → About show the exact engine/build immediately at app startup,
 * before any book is opened.
 */
export function UAProbe() {
  const ua = useWebviewInfoStore((s) => s.ua);
  if (ua) return null;

  return (
    <View pointerEvents="none" style={{ height: 0, opacity: 0, width: 0 }}>
      <WebView
        source={{ html: PROBE_HTML }}
        injectedJavaScript={INJECTED_JS}
        onMessage={(event) => {
          try {
            const msg = JSON.parse(event.nativeEvent.data) as {
              type?: string;
              ua?: string;
              fullVersion?: string | null;
            };
            if (msg.type === "readany-ua" && msg.ua) {
              useWebviewInfoStore.getState().setUa(msg.ua, msg.fullVersion ?? undefined);
            }
          } catch {
            // ignore probe noise
          }
        }}
        style={{ height: 0, width: 0 }}
      />
    </View>
  );
}
