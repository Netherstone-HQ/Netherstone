package tech.blueblood.netherstone

import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Message
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import java.io.File

/** The cache folder picked files are copied into for the page. */
private const val PICKED_FOLDER = "picked"

/**
 * Wry's chrome client, except for files picked from the phone (not taken
 * with the camera). Those are copied into the app's cache as soon as the
 * picker returns, and the page gets the copies.
 *
 * Handed the picker's own links, the WebView reads a file later, against
 * what it noted of it when picked; on a slow phone that note can be out of
 * date by then, and the read fails ("could not be read"). Copies the app
 * owns don't change.
 */
class PickerChromeClient(
  private val wry: WebChromeClient,
  private val activity: MainActivity,
) : WebChromeClient() {
  override fun onShowFileChooser(
    view: WebView,
    callback: ValueCallback<Array<Uri>?>,
    params: FileChooserParams,
  ): Boolean {
    // The camera, and a choice among several kinds, stay with wry.
    if (params.isCaptureEnabled || params.acceptTypes.count { it.isNotBlank() } > 1) {
      return wry.onShowFileChooser(view, callback, params)
    }
    val intent = params.createIntent()
    if (params.mode == FileChooserParams.MODE_OPEN_MULTIPLE) {
      intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
    }
    activity.pickForPage(intent) { picked ->
      if (picked.isEmpty()) {
        callback.onReceiveValue(null)
        return@pickForPage
      }
      Thread {
        val copies = copyForPage(picked)
        activity.runOnUiThread {
          callback.onReceiveValue(if (copies.isEmpty()) null else copies.toTypedArray())
        }
      }.start()
    }
    return true
  }

  /**
   * Copies `picked` into a new folder of the cache, the last pick's copies
   * cleared out, and returns the file provider's links to the copies.
   */
  private fun copyForPage(picked: List<Uri>): List<Uri> {
    val all = File(activity.cacheDir, PICKED_FOLDER)
    all.deleteRecursively()
    val folder = File(all, System.currentTimeMillis().toString())
    folder.mkdirs()
    val resolver = activity.contentResolver
    val taken = mutableSetOf<String>()
    return picked.mapNotNull { uri ->
      try {
        val file = File(folder, freeName(resolver.displayName(uri, "picked file"), taken))
        resolver.openInputStream(uri)?.use { input -> file.outputStream().use { input.copyTo(it) } }
          ?: return@mapNotNull null
        taken.add(file.name.lowercase())
        activity.providedUri(file)
      } catch (error: Exception) {
        Log.w("Netherstone", "Couldn't read a picked file: $uri", error)
        null
      }
    }
  }

  // Everything else is wry's.

  override fun onShowCustomView(view: View, callback: CustomViewCallback) =
    wry.onShowCustomView(view, callback)

  override fun onHideCustomView() = wry.onHideCustomView()

  override fun onPermissionRequest(request: PermissionRequest) = wry.onPermissionRequest(request)

  override fun getDefaultVideoPoster(): Bitmap? = wry.defaultVideoPoster

  override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult) =
    wry.onJsAlert(view, url, message, result)

  override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult) =
    wry.onJsConfirm(view, url, message, result)

  override fun onJsPrompt(
    view: WebView,
    url: String,
    message: String,
    defaultValue: String,
    result: JsPromptResult,
  ) = wry.onJsPrompt(view, url, message, defaultValue, result)

  override fun onGeolocationPermissionsShowPrompt(origin: String, callback: GeolocationPermissions.Callback) =
    wry.onGeolocationPermissionsShowPrompt(origin, callback)

  override fun onConsoleMessage(consoleMessage: ConsoleMessage) = wry.onConsoleMessage(consoleMessage)

  override fun onReceivedTitle(view: WebView, title: String) = wry.onReceivedTitle(view, title)

  override fun onCreateWindow(view: WebView, isDialog: Boolean, isUserGesture: Boolean, resultMsg: Message) =
    wry.onCreateWindow(view, isDialog, isUserGesture, resultMsg)
}
