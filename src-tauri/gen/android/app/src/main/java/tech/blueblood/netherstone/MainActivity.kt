package tech.blueblood.netherstone

import android.os.Bundle
import android.util.Log
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    if (BuildConfig.INSPECTABLE) {
      WebView.setWebContentsDebuggingEnabled(true)
      // scripts/android-ui-check.mjs waits for this line.
      Log.i("Netherstone", "WebView inspectable")
    }
    fitAboveKeyboard(webView)
  }

  /** The latest system insets, as `window.NetherstoneInsets.get()` returns them. */
  @Volatile private var insetsJson = "{}"

  /**
   * Edge to edge, the keyboard covers the page instead of shrinking it, so
   * the caret ends up under it. The page's frame is padded by the keyboard's
   * height instead, and the page is told, in CSS px: the keyboard's height
   * (0 while it's down) and the status and navigation bars it draws under
   * (bottom 0 while the keyboard is up, since the frame then ends above
   * them). src/lib/system-insets.ts reads them at start through
   * `NetherstoneInsets` and on each change through a `systeminsets` event.
   */
  private fun fitAboveKeyboard(webView: WebView) {
    webView.addJavascriptInterface(
      object {
        @JavascriptInterface fun get(): String = insetsJson
      },
      "NetherstoneInsets",
    )
    val frame = findViewById<View>(android.R.id.content)
    ViewCompat.setOnApplyWindowInsetsListener(frame) { view, insets ->
      val keyboard = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      view.updatePadding(bottom = keyboard)
      val density = resources.displayMetrics.density
      val json =
        "{\"keyboard\":${Math.round(keyboard / density)}," +
          "\"top\":${Math.round(bars.top / density)}," +
          "\"bottom\":${if (keyboard > 0) 0 else Math.round(bars.bottom / density)}}"
      if (json != insetsJson) {
        insetsJson = json
        webView.evaluateJavascript(
          "window.dispatchEvent(new CustomEvent('systeminsets',{detail:$json}))",
          null,
        )
      }
      insets
    }
  }
}
