package tech.blueblood.netherstone

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.os.Build
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * What another app hands Netherstone (Open with, Share), copied into the
 * cache for incoming.rs: Android's content links are only readable here,
 * and only for a while.
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

    /** Where incoming.rs moves what the page took, cleared on the next start. */
    const val TAKEN = "taken"

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

  /** Copies it into `cache`/incoming/<kind>/<time>, leaving out files that can't be read. */
  fun saveTo(cache: File, resolver: ContentResolver) {
    writeWhole(File(cache, "$FOLDER/$kind")) { part ->
      part.mkdirs()
      saveInto(part, resolver)
    }
  }

  private fun saveInto(part: File, resolver: ContentResolver) {
    // The share's own note keeps its name.
    val taken = mutableSetOf(ABOUT)
    val files = JSONArray()
    for (uri in streams) {
      val name = freeName(resolver.displayName(uri, "shared file"), taken)
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
  }
}
