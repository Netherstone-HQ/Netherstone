package tech.blueblood.netherstone

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.util.Log
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import java.io.File

/** The cache folder exports to share go in, as share_export_path names it. */
private const val SHARE_FOLDER = "shared"

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  /** The app's page, told when the app goes out of sight. */
  private var page: WebView? = null

  /**
   * The WebView keeps its page "visible" while the app is in the background,
   * so the page is told itself: an `apphidden` event once the app is out of
   * sight, when Android may stop it at any time. src/hooks/useAutosave.ts
   * saves then.
   */
  override fun onStop() {
    page?.evaluateJavascript("window.dispatchEvent(new Event('apphidden'))", null)
    super.onStop()
  }

  override fun onWebViewCreate(webView: WebView) {
    page = webView
    if (BuildConfig.INSPECTABLE) {
      WebView.setWebContentsDebuggingEnabled(true)
      // scripts/android-ui-check.mjs waits for this line.
      Log.i("Netherstone", "WebView inspectable")
    }
    webView.addJavascriptInterface(PageBridge(webView), "NetherstoneAndroid")
    fitAboveKeyboard(webView)
    // Once wry has set its chrome client, files picked for the page go
    // through PickerChromeClient. Before Android 8 the client can't be read,
    // so wry's stays.
    webView.post {
      val wry = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) webView.webChromeClient else null
      if (wry != null && wry !is PickerChromeClient) webView.webChromeClient = PickerChromeClient(wry, this)
    }
  }

  /** Where a pick for the page goes once the picker returns. */
  private var onPicked: ((List<Uri>) -> Unit)? = null

  private val picker =
    registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
      val data = result.data
      val picked =
        when {
          result.resultCode != RESULT_OK || data == null -> emptyList()
          data.clipData != null -> (0 until data.clipData!!.itemCount).map { data.clipData!!.getItemAt(it).uri }
          else -> listOfNotNull(data.data)
        }
      onPicked?.invoke(picked)
      onPicked = null
    }

  /** Shows a picker for the page (`intent`); `done` gets what was picked, or nothing. */
  fun pickForPage(intent: Intent, done: (List<Uri>) -> Unit) {
    onPicked = done
    try {
      picker.launch(intent)
    } catch (error: ActivityNotFoundException) {
      onPicked = null
      done(emptyList())
    }
  }

  /** The latest system insets, as `window.NetherstoneAndroid.insets()` returns them. */
  @Volatile private var insetsJson = "{}"

  /** What the page can ask of Android, as `window.NetherstoneAndroid`. */
  private inner class PageBridge(private val webView: WebView) {
    @JavascriptInterface fun insets(): String = insetsJson

    /** This app's page in the system settings, where its permissions are. */
    @JavascriptInterface
    fun openAppSettings() {
      runOnUiThread {
        startActivity(
          Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)),
        )
      }
    }

    /**
     * Offers a file to other apps through Android's share sheet. Only an
     * export in the app's cache folder for sharing (`share_export_path`)
     * is handed on, so a page script can't send any other file.
     */
    @JavascriptInterface
    fun shareFile(path: String, mimeType: String) {
      val shared = File(cacheDir, SHARE_FOLDER).canonicalFile
      val file = File(path).canonicalFile
      if (file.parentFile != shared || !file.isFile) {
        Log.w("Netherstone", "Not shared: $path isn't an export to share")
        return
      }
      val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.fileprovider", file)
      val send = Intent(Intent.ACTION_SEND).apply {
        type = mimeType
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_TITLE, file.name)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      runOnUiThread { startActivity(Intent.createChooser(send, null)) }
    }

    /** Shows or hides the keyboard, leaving focus and the caret where they are. */
    @JavascriptInterface
    fun setKeyboard(shown: Boolean) {
      runOnUiThread {
        val controller = WindowCompat.getInsetsController(window, webView)
        if (shown) controller.show(WindowInsetsCompat.Type.ime()) else controller.hide(WindowInsetsCompat.Type.ime())
      }
    }
  }

  /**
   * Edge to edge, the keyboard covers the page instead of shrinking it, so
   * the caret ends up under it. The page's frame is padded by the keyboard's
   * height instead, and the page is told, in CSS px: the keyboard's height
   * (0 while it's down) and the status and navigation bars it draws under
   * (bottom 0 while the keyboard is up, since the frame then ends above
   * them). src/lib/system-insets.ts reads them at start through
   * `NetherstoneAndroid` and on each change through a `systeminsets` event.
   */
  private fun fitAboveKeyboard(webView: WebView) {
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
