package tech.blueblood.netherstone

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.webkit.WebView
import androidx.core.content.FileProvider
import java.io.File

/** The name another app gives `uri`, made safe as a file name, or `fallback`. */
internal fun ContentResolver.displayName(uri: Uri, fallback: String): String {
  val named =
    try {
      query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0) else null
      }
    } catch (error: Exception) {
      null
    } ?: uri.lastPathSegment
  val safe = named?.substringAfterLast('/')?.replace(Regex("[\\\\:*?\"<>|\\u0000-\\u001f]"), "_")?.trim()
  return if (safe.isNullOrEmpty() || safe.startsWith(".")) fallback else safe
}

/** `name`, or "name 2.ext" and so on while `taken` (lower case) has it. */
internal fun freeName(name: String, taken: Set<String>): String {
  if (name.lowercase() !in taken) return name
  val dot = name.lastIndexOf('.').takeIf { it > 0 } ?: name.length
  var count = 2
  while ("${name.substring(0, dot)} $count${name.substring(dot)}".lowercase() in taken) count += 1
  return "${name.substring(0, dot)} $count${name.substring(dot)}"
}

/**
 * Writes a time-named entry in `folder` under a `.part` name, then renames
 * it, so incoming.rs never takes a half-written one.
 */
internal fun writeWhole(folder: File, write: (File) -> Unit) {
  folder.mkdirs()
  val stamp = System.currentTimeMillis().toString()
  val part = File(folder, "$stamp.part")
  write(part)
  part.renameTo(File(folder, stamp))
}

/** A link other apps can read `file` through. */
internal fun Context.providedUri(file: File): Uri =
  FileProvider.getUriForFile(this, "$packageName.fileprovider", file)

/** This app, for the system settings screens about it. */
internal fun Context.packageUri(): Uri = Uri.fromParts("package", packageName, null)

/** Fires `event` on the page's window, with `detail` (JSON) when given. */
internal fun WebView.dispatch(event: String, detail: String? = null) {
  val script =
    if (detail == null) "window.dispatchEvent(new Event('$event'))"
    else "window.dispatchEvent(new CustomEvent('$event',{detail:$detail}))"
  evaluateJavascript(script, null)
}
