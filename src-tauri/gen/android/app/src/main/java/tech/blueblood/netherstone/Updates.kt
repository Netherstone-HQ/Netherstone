package tech.blueblood.netherstone

import android.content.Context
import android.content.pm.PackageManager
import android.content.pm.Signature
import android.os.Build
import java.io.File

/** Whether `apk` is this app, signed with this app's key. */
internal fun Context.isThisApp(apk: File): Boolean =
  if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) signedAsThisApp(apk) else signedAsThisAppBeforeP(apk)

/** Several signers must all be this app's; one signer may have moved on from this app's key. */
@Suppress("DEPRECATION")
private fun Context.signedAsThisApp(apk: File): Boolean {
  val archive = packageManager.getPackageArchiveInfo(apk.path, PackageManager.GET_SIGNING_CERTIFICATES) ?: return false
  val signing = archive.signingInfo ?: return false
  val several = signing.hasMultipleSigners()
  val signers = (if (several) signing.apkContentsSigners else signing.signingCertificateHistory).orEmpty()
  fun ours(signer: Signature) =
    packageManager.hasSigningCertificate(packageName, signer.toByteArray(), PackageManager.CERT_INPUT_RAW_X509)
  val signed = if (several) signers.all(::ours) else signers.any(::ours)
  return archive.packageName == packageName && signers.isNotEmpty() && signed
}

@Suppress("DEPRECATION")
private fun Context.signedAsThisAppBeforeP(apk: File): Boolean {
  val archive = packageManager.getPackageArchiveInfo(apk.path, PackageManager.GET_SIGNATURES) ?: return false
  val signers = archive.signatures.orEmpty().toSet()
  val ours = packageManager.getPackageInfo(packageName, PackageManager.GET_SIGNATURES).signatures.orEmpty().toSet()
  return archive.packageName == packageName && signers.isNotEmpty() && signers == ours
}
