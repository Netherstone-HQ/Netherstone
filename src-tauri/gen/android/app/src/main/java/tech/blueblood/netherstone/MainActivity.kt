package tech.blueblood.netherstone

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.Settings
import android.util.Log
import android.view.View
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.FileProvider
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.updatePadding
import java.io.ByteArrayInputStream
import java.io.File
import org.json.JSONObject

/** The cache folder exports to share go in, as share_export_path names it. */
private const val SHARE_FOLDER = "shared"

/** Where phone_updater.rs downloads an update, in the cache. */
private const val UPDATE_FOLDER = "updates"
private const val UPDATE_FILE = "Netherstone.apk"

/** Where a page being printed seems to come from; nothing is served from it. */
private const val PRINT_ORIGIN = "https://print.netherstone.invalid"

/** Thousandths of an inch in a millimetre, as Android's print sizes count. */
private const val MILS_PER_MM = 1000 / 25.4

/** The print screen's page: the export's paper (A4 or US Letter), with its margins. */
private fun printAttributes(geometry: JSONObject): PrintAttributes {
  fun mils(key: String) = Math.round(geometry.getDouble(key) * MILS_PER_MM).toInt()
  val size = if (geometry.getString("pageSize") == "letter") PrintAttributes.MediaSize.NA_LETTER else PrintAttributes.MediaSize.ISO_A4
  val margins = PrintAttributes.Margins(mils("marginLeftMm"), mils("marginTopMm"), mils("marginRightMm"), mils("marginBottomMm"))
  return PrintAttributes.Builder().setMediaSize(size).setMinMargins(margins).build()
}

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    if (savedInstanceState == null) {
      // What the page took in the app's last run has been imported or saved.
      File(cacheDir, "${Incoming.FOLDER}/taken").deleteRecursively()
      takeIn(intent)
    }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    takeIn(intent)
  }

  /**
   * Copies what another app opened or shared with Netherstone into the
   * cache, then tells the page with an `opened` or `shared` event. A page
   * that starts later looks for it itself.
   */
  private fun takeIn(intent: Intent?) {
    val incoming = intent?.let { Incoming.of(it) } ?: return
    Thread {
      incoming.saveTo(cacheDir, contentResolver)
      runOnUiThread {
        page?.evaluateJavascript("window.dispatchEvent(new Event('${incoming.kind}'))", null)
      }
    }.start()
  }

  /**
   * The app's page, once there is one, told when the app goes out of sight
   * and when something comes in from another app.
   */
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

  /**
   * The folder picker for a vault in shared storage. What it picked is left
   * for src-tauri (see SharedFolders.kt), and the page hears `folderpicked`,
   * its `detail` "picked", "cancelled", or "unusable" for a folder with no
   * path, such as a cloud app's.
   */
  private val folderPicker =
    registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { tree ->
      val path = tree?.let { SharedFolders.pathOf(it) }
      if (path != null) SharedFolders.keep(cacheDir, path)
      val outcome = if (tree == null) "cancelled" else if (path == null) "unusable" else "picked"
      page?.evaluateJavascript(
        "window.dispatchEvent(new CustomEvent('folderpicked',{detail:'$outcome'}))",
        null,
      )
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

    /**
     * Opens Android's print screen with an export's print page, where it can
     * be printed or saved as a PDF. `geometry` is the page as the export
     * look says it: JSON with `pageSize` (`a4` or `letter`) and the four margins.
     */
    @JavascriptInterface
    fun printPage(html: String, jobName: String, geometry: String) {
      runOnUiThread { printHtml(html, jobName, JSONObject(geometry)) }
    }

    /**
     * Shows a web page over the app, in the phone's browser as a custom tab:
     * its title and site, a Close button that comes back here, and a menu
     * to go back, forward, reload, copy, share or open it in the browser.
     * Only http and https pages: anything else is left alone.
     */
    @JavascriptInterface
    fun openInApp(url: String) {
      val uri = Uri.parse(url)
      if (uri.scheme != "http" && uri.scheme != "https") return
      runOnUiThread {
        try {
          CustomTabsIntent.Builder().setShowTitle(true).build().launchUrl(this@MainActivity, uri)
        } catch (error: ActivityNotFoundException) {
          // No browser that shows custom tabs: the page opens in any browser.
          startActivity(Intent(Intent.ACTION_VIEW, uri))
        }
      }
    }

    /**
     * Hands the update phone_updater.rs downloaded to Android's installer.
     * The first time, Android must let Netherstone install apps: that
     * setting opens instead, and this returns false to try again after.
     */
    @JavascriptInterface
    fun installUpdate(): Boolean {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
        runOnUiThread {
          startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.fromParts("package", packageName, null)))
        }
        return false
      }
      val apk = File(cacheDir, "$UPDATE_FOLDER/$UPDATE_FILE")
      if (!apk.isFile) return false
      val uri = FileProvider.getUriForFile(this@MainActivity, "$packageName.fileprovider", apk)
      val install = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(uri, "application/vnd.android.package-archive")
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      runOnUiThread { startActivity(install) }
      return true
    }

    /** Whether vaults may live in shared storage: "All files access". */
    @JavascriptInterface fun hasAllFilesAccess(): Boolean = SharedFolders.hasAccess(this@MainActivity)

    /** The settings screen where "All files access" is given. */
    @JavascriptInterface
    fun askAllFilesAccess() {
      runOnUiThread { SharedFolders.askAccess(this@MainActivity) }
    }

    /** Shows the system's folder picker, in Documents; see `folderPicker`. */
    @JavascriptInterface
    fun pickFolder() {
      runOnUiThread { folderPicker.launch(SharedFolders.DOCUMENTS) }
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

  /** The page being printed, kept until the print screen has it. */
  private var printView: WebView? = null

  /**
   * Loads `html` in a WebView of its own and, once the page says its fonts
   * and pictures are ready (it asks for `ready`, as for the desktop's PDF),
   * hands it to the print screen on a page of the export's size, with its
   * margins.
   */
  private fun printHtml(html: String, jobName: String, geometry: JSONObject) {
    val view = WebView(this)
    view.settings.javaScriptEnabled = true
    view.webViewClient = object : WebViewClient() {
      override fun shouldInterceptRequest(page: WebView, request: WebResourceRequest): WebResourceResponse? {
        if (request.url.toString() != "$PRINT_ORIGIN/ready") return null
        runOnUiThread {
          val manager = getSystemService(PRINT_SERVICE) as PrintManager
          manager.print(jobName, page.createPrintDocumentAdapter(jobName), printAttributes(geometry))
        }
        return WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))
      }
    }
    printView = view
    view.loadDataWithBaseURL("$PRINT_ORIGIN/page.html", html, "text/html", "utf-8", null)
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
