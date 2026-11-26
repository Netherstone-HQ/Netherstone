package tech.blueblood.netherstone

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.Environment
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
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

/** How wry names the photos the camera takes for the page, in the pictures folder. */
private const val CAMERA_PHOTO_PREFIX = "JPEG_"
private const val CAMERA_PHOTO_SUFFIX = ".jpg"

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

/** `adapter`, calling `finished` once printing ends. */
private class ReleasingAdapter(
  private val adapter: PrintDocumentAdapter,
  private val finished: () -> Unit,
) : PrintDocumentAdapter() {
  override fun onStart() = adapter.onStart()

  override fun onLayout(
    old: PrintAttributes?,
    new: PrintAttributes,
    cancel: CancellationSignal?,
    callback: LayoutResultCallback,
    extras: Bundle?,
  ) = adapter.onLayout(old, new, cancel, callback, extras)

  override fun onWrite(
    pages: Array<out PageRange>,
    destination: ParcelFileDescriptor,
    cancel: CancellationSignal?,
    callback: WriteResultCallback,
  ) = adapter.onWrite(pages, destination, cancel, callback)

  override fun onFinish() {
    adapter.onFinish()
    finished()
  }
}

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    if (savedInstanceState == null) {
      // What the page took in the app's last run has been imported or saved.
      File(cacheDir, "${Incoming.FOLDER}/${Incoming.TAKEN}").deleteRecursively()
      removeCameraPhotos()
      takeIn(intent)
    }
  }

  /** The camera's photos from earlier runs: the page saved each where it belongs. */
  private fun removeCameraPhotos() {
    getExternalFilesDir(Environment.DIRECTORY_PICTURES)
      ?.listFiles { file -> file.isFile && file.name.startsWith(CAMERA_PHOTO_PREFIX) && file.name.endsWith(CAMERA_PHOTO_SUFFIX) }
      ?.forEach { it.delete() }
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    takeIn(intent)
  }

  /** Copies what another app opened or shared into the cache, then tells the page. */
  private fun takeIn(intent: Intent?) {
    val incoming = intent?.let { Incoming.of(it) } ?: return
    Thread {
      incoming.saveTo(cacheDir, contentResolver)
      runOnUiThread {
        page?.dispatch(incoming.kind)
      }
    }.start()
  }

  /** The app's page, once there is one. */
  private var page: WebView? = null

  // The WebView keeps its page "visible" in the background, so the page is
  // told itself, to save before Android may stop the app (useAutosave.ts).
  override fun onStop() {
    page?.dispatch("apphidden")
    super.onStop()
  }

  override fun onWebViewCreate(webView: WebView) {
    page = webView
    if (BuildConfig.INSPECTABLE) {
      WebView.setWebContentsDebuggingEnabled(true)
      // scripts/android-ui-check.mjs waits for this line.
      Log.i("Netherstone", "WebView inspectable")
    }
    // A page opens a window only on a tap; see phone_navigation.rs.
    webView.settings.javaScriptCanOpenWindowsAutomatically = false
    webView.addJavascriptInterface(PageBridge(webView), "NetherstoneAndroid")
    fitAboveKeyboard(webView)
    // Picked files go through PickerChromeClient. Before Android 8 wry's
    // client can't be read, so it stays.
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
   * The folder picker for a vault in shared storage (see SharedFolders.kt).
   * "unusable" is a folder with no path, such as a cloud app's.
   */
  private val folderPicker =
    registerForActivityResult(ActivityResultContracts.OpenDocumentTree()) { tree ->
      val path = tree?.let { SharedFolders.pathOf(it) }
      if (path != null) SharedFolders.keep(cacheDir, path)
      val outcome = if (tree == null) "cancelled" else if (path == null) "unusable" else "picked"
      page?.dispatch("folderpicked", "'$outcome'")
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
          Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri()),
        )
      }
    }

    /** Offers an export to other apps. Only the share folder's files, so a page can't send others. */
    @JavascriptInterface
    fun shareFile(path: String, mimeType: String) {
      val shared = File(cacheDir, SHARE_FOLDER).canonicalFile
      val file = File(path).canonicalFile
      if (file.parentFile != shared || !file.isFile) {
        Log.w("Netherstone", "Not shared: $path isn't an export to share")
        return
      }
      val uri = providedUri(file)
      val send = Intent(Intent.ACTION_SEND).apply {
        type = mimeType
        putExtra(Intent.EXTRA_STREAM, uri)
        putExtra(Intent.EXTRA_TITLE, file.name)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      runOnUiThread { startActivity(Intent.createChooser(send, null)) }
    }

    /** Opens the print screen with an export's page; `geometry` is its size and margins as JSON. */
    @JavascriptInterface
    fun printPage(html: String, jobName: String, geometry: String) {
      runOnUiThread { printHtml(html, jobName, JSONObject(geometry)) }
    }

    /** Shows an http(s) page over the app in a custom tab. */
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
     * Hands the downloaded update to the installer. Until Netherstone may
     * install apps, opens that setting instead and returns false.
     */
    @JavascriptInterface
    fun installUpdate(): Boolean {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !packageManager.canRequestPackageInstalls()) {
        runOnUiThread {
          startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, packageUri()))
        }
        return false
      }
      val apk = File(cacheDir, "$UPDATE_FOLDER/$UPDATE_FILE")
      if (!apk.isFile) return false
      val uri = providedUri(apk)
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

  /** The page being printed, kept until printing ends. */
  private var printView: WebView? = null

  /** Loads `html` in its own WebView and prints it once the page asks for `ready`. */
  private fun printHtml(html: String, jobName: String, geometry: JSONObject) {
    val view = WebView(this)
    view.settings.javaScriptEnabled = true
    view.webViewClient = object : WebViewClient() {
      override fun shouldInterceptRequest(page: WebView, request: WebResourceRequest): WebResourceResponse? {
        if (request.url.toString() != "$PRINT_ORIGIN/ready") return null
        runOnUiThread {
          val manager = getSystemService(PRINT_SERVICE) as PrintManager
          val adapter = ReleasingAdapter(page.createPrintDocumentAdapter(jobName)) { printView = null }
          manager.print(jobName, adapter, printAttributes(geometry))
        }
        return WebResourceResponse("text/plain", "utf-8", ByteArrayInputStream(ByteArray(0)))
      }
    }
    printView = view
    view.loadDataWithBaseURL("$PRINT_ORIGIN/page.html", html, "text/html", "utf-8", null)
  }

  /**
   * Edge to edge, the keyboard covers the page, so the frame is padded by its
   * height instead. The page gets the keyboard and bar sizes in CSS px
   * (system-insets.ts).
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
        webView.dispatch("systeminsets", json)
      }
      insets
    }
  }
}
