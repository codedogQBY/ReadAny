package expo.modules.webvieweval

import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Runs JavaScript in a react-native-webview without waiting for a display frame.
 *
 * `WebView.injectJavaScript` reaches the native view as a Fabric view command, and those are
 * executed from a Choreographer frame callback. With the app in the background there are no
 * frames, so the script is queued until the app is visible again. A message posted to the main
 * thread's handler runs regardless, and `evaluateJavascript` works on a WebView that is not
 * on screen.
 */
class WebViewEvalModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WebViewEval")

    // The result of the script is not returned; the page answers through postMessage.
    AsyncFunction("evaluate") { viewTag: Int, script: String ->
      val root = appContext.findView<View>(viewTag)
        ?: throw WebViewNotFoundException("No view with tag $viewTag")
      val webView = findWebView(root)
        ?: throw WebViewNotFoundException("No WebView below the view with tag $viewTag")
      webView.evaluateJavascript(script, null)
    }.runOnQueue(Queues.MAIN)
  }

  private fun findWebView(view: View): WebView? {
    if (view is WebView) return view
    if (view is ViewGroup) {
      for (index in 0 until view.childCount) {
        findWebView(view.getChildAt(index))?.let { return it }
      }
    }
    return null
  }
}

private class WebViewNotFoundException(message: String) : CodedException(message)
