package tech.blueblood.netherstone

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.OpenableColumns
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * What another app hands Netherstone: a file to open (Open with) or text,
 * links and files to save (Share). It's copied into the app's cache, where
 * src-tauri/src/incoming.rs takes it for the page, since the content links
 * Android gives are only readable here, and only for a while.
 *
 * Each arrival is a folder of its own, written under a `.part` name and
 * renamed once complete, so a half-copied one is never taken.
 */
class Incoming private constructor(
  /** `opened` or `shared`, the folder it goes in and the event the page hears. */
  val kind: String,
  private val streams: List<Uri>,
  private val text: String?,
  private val subject: String?,
) {
  companion object {
    /** The cache folder incoming.rs reads. */
    const val FOLDER = "incoming"

    /** A share's text, subject and its files' names and types, beside them. */
    private const val ABOUT = "share.json"

    /** What `intent` hands over, or null when it's nothing to take in. */
    fun of(intent: Intent): Incoming? =
      when (intent.action) {
        Intent.ACTION_VIEW -> intent.data?.let { Incoming("opened", listOf(it), null, null) }
        Intent.ACTION_SEND -> {
          val stream = intent.stream()
          val text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()
          if (stream == null && text.isNullOrBlank()) null
          else Incoming("shared", listOfNotNull(stream), text, intent.subject())
        }
        Intent.ACTION_SEND_MULTIPLE -> {
          val streams = intent.streams()
          if (streams.isEmpty()) null else Incoming("shared", streams, null, intent.subject())
        }
        else -> null
      }

    private fun Intent.subject() =
      (getStringExtra(Intent.EXTRA_SUBJECT) ?: getStringExtra(Intent.EXTRA_TITLE))?.takeIf { it.isNotBlank() }

    @Suppress("DEPRECATION")
    private fun Intent.stream(): Uri? =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
      else getParcelableExtra(Intent.EXTRA_STREAM)

    @Suppress("DEPRECATION")
    private fun Intent.streams(): List<Uri> =
      (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
      else getParcelableArrayListExtra(Intent.EXTRA_STREAM))?.filterNotNull() ?: emptyList()
  }

  /**
   * Copies it into `cache`/incoming/<kind>/<time>. Files that can't be read
   * are left out; the page says so when nothing came.
   */
  fun saveTo(cache: File, resolver: ContentResolver) {
    val kindFolder = File(cache, "$FOLDER/$kind")
    val stamp = System.currentTimeMillis().toString()
    val part = File(kindFolder, "$stamp.part")
    part.mkdirs()
    // The share's own note keeps its name.
    val taken = mutableSetOf(ABOUT)
    val files = JSONArray()
    for (uri in streams) {
      val name = freeName(displayName(resolver, uri), taken)
      try {
        resolver.openInputStream(uri)?.use { input ->
          File(part, name).outputStream().use { output -> input.copyTo(output) }
          taken.add(name.lowercase())
          files.put(JSONObject().put("name", name).put("type", resolver.getType(uri) ?: ""))
        }
      } catch (error: Exception) {
        android.util.Log.w("Netherstone", "Couldn't read what was shared: $uri", error)
      }
    }
    if (kind == "shared") {
      val about = JSONObject().put("files", files)
      text?.let { about.put("text", it) }
      subject?.let { about.put("subject", it) }
      File(part, ABOUT).writeText(about.toString())
    }
    part.renameTo(File(kindFolder, stamp))
  }

  /** The name the other app gives the file, made safe as a file name. */
  private fun displayName(resolver: ContentResolver, uri: Uri): String {
    val named =
      try {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
          if (cursor.moveToFirst()) cursor.getString(0) else null
        }
      } catch (error: Exception) {
        null
      } ?: uri.lastPathSegment
    val safe = named?.substringAfterLast('/')?.replace(Regex("[\\\\:*?\"<>|\\u0000-\\u001f]"), "_")?.trim()
    return if (safe.isNullOrEmpty() || safe.startsWith(".")) "shared file" else safe
  }

  /** `name`, or "name 2.ext" and so on when another file here has it. */
  private fun freeName(name: String, taken: Set<String>): String {
    if (name.lowercase() !in taken) return name
    val dot = name.lastIndexOf('.').takeIf { it > 0 } ?: name.length
    var count = 2
    while ("${name.substring(0, dot)} $count${name.substring(dot)}".lowercase() in taken) count += 1
    return "${name.substring(0, dot)} $count${name.substring(dot)}"
  }
}
