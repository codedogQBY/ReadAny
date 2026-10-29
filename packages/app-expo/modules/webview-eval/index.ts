import { requireNativeModule } from "expo";
import { Platform } from "react-native";

interface WebViewEvalModule {
  evaluate(viewTag: number, script: string): Promise<void>;
}

function resolveModule(): WebViewEvalModule | null {
  if (Platform.OS !== "android") return null;
  try {
    return requireNativeModule<WebViewEvalModule>("WebViewEval");
  } catch {
    return null;
  }
}

const mod = resolveModule();

/**
 * Runs `script` in the WebView found at or below the React view `viewTag`, straight from the
 * main thread's message queue. `WebView.injectJavaScript` waits for a display frame instead and
 * stalls while the app is in the background. Null where the native module is missing.
 */
export const evaluateInWebView: ((viewTag: number, script: string) => Promise<void>) | null = mod
  ? (viewTag, script) => mod.evaluate(viewTag, script)
  : null;
