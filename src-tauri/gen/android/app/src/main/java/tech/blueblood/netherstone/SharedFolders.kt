package tech.blueblood.netherstone

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.DocumentsContract
import android.provider.Settings
import java.io.File

/**
 * Vaults in a folder other apps can open, such as Documents. The vault's
 * files are read and written by path (src-tauri), which Android allows in
 * shared storage only with "All files access". The folder is picked with
 * the system's folder picker, and its link turned into that path.
 *
 * The picked path goes to src-tauri/src/incoming.rs through the cache, as
 * `incoming/folder/<time>`, so the page never names a folder itself.
 */
object SharedFolders {
  /** The storage the folder picker shows, and its Documents folder, where it opens. */
  private const val STORAGE = "com.android.externalstorage.documents"
  val DOCUMENTS: Uri = DocumentsContract.buildDocumentUri(STORAGE, "primary:${Environment.DIRECTORY_DOCUMENTS}")

  /** The cache folder incoming.rs reads picked folders from. */
  private const val FOLDER = "${Incoming.FOLDER}/folder"

  /**
   * Whether the app may read and write files in shared storage: "All files
   * access" from Android 11, the storage permission before.
   */
  fun hasAccess(context: Context): Boolean =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) Environment.isExternalStorageManager()
    else context.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED

  /** Asks for that access: its settings screen, or the permission prompt before Android 11. */
  fun askAccess(activity: Activity) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      activity.startActivity(
        Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION, activity.packageUri()),
      )
    } else {
      activity.requestPermissions(arrayOf(Manifest.permission.WRITE_EXTERNAL_STORAGE), ACCESS_REQUEST)
    }
  }

  /** The request code of the storage permission prompt. */
  private const val ACCESS_REQUEST = 41

  /**
   * The path of the folder the picker gave as `tree`: in the phone's own
   * storage, or on a memory card. Null for anything else, such as a cloud
   * app's folder, which has no path.
   */
  fun pathOf(tree: Uri): String? {
    if (tree.authority != STORAGE) return null
    val id = DocumentsContract.getTreeDocumentId(tree) ?: return null
    val volume = id.substringBefore(':')
    val relative = id.substringAfter(':', "")
    val root =
      if (volume == "primary") Environment.getExternalStorageDirectory()
      else File("/storage/$volume")
    val folder = if (relative.isEmpty()) root else File(root, relative)
    return folder.takeIf { it.isDirectory }?.path
  }

  /** Leaves `path` for incoming.rs, whole or not at all. */
  fun keep(cache: File, path: String) {
    writeWhole(File(cache, FOLDER)) { part -> part.writeText(path) }
  }
}
