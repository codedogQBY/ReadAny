import { useWebviewInfoStore } from "@/stores/webview-info-store";
import { View } from "react-native";
import { WebView } from "react-native-webview";

const PROBE_HTML =
  "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width, initial-scale=1'></head><body></body></html>";

// Runs in the probe page and posts the WebView's own UA back to RN.
const INJECTED_JS =
  "ReactNativeWebView.postMessage(JSON.stringify({ type: 'readany-ua', ua: navigator.userAgent })); true;";

/**
 * A 0×0 hidden WebView that reports the system WebView's real
 * navigator.userAgent to the webview-info store, then unmounts.
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
            };
            if (msg.type === "readany-ua" && msg.ua) {
              useWebviewInfoStore.getState().setUa(msg.ua);
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
