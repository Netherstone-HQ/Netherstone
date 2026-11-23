//! Gives libgit2 Android's trusted certificates, so GitHub backups can check
//! who they talk to. libgit2's OpenSSL looks for a certificate file or
//! folder that Android doesn't have in a form it reads: the system folder
//! names its files by an older hash, and a bundle built from it fails to load.
//! Each certificate is handed over in memory instead, once a run.

use foreign_types::ForeignType;
use openssl::x509::X509;
use std::path::Path;
use std::sync::Once;

/// The system's trusted certificates. Android 14 moved them to the updatable
/// Conscrypt module; older versions keep them in /system.
const CERT_DIRS: [&str; 2] = [
    "/apex/com.android.conscrypt/cacerts",
    "/system/etc/security/cacerts",
];

/// Loads the system certificates into libgit2. Call before any Git network
/// work; later calls do nothing.
pub fn trust_system_certificates() {
    static LOADED: Once = Once::new();
    LOADED.call_once(|| match load() {
        Ok(0) => eprintln!("[Netherstone] Found no system certificates for Git"),
        Ok(_) => {}
        Err(error) => eprintln!("[Netherstone] Loading system certificates for Git: {error}"),
    });
}

fn load() -> Result<usize, String> {
    let dir = CERT_DIRS
        .iter()
        .map(Path::new)
        .find(|dir| dir.is_dir())
        .ok_or("no system certificate folder")?;
    let entries = std::fs::read_dir(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    libgit2_sys::init();
    let mut added = 0;
    for entry in entries.flatten() {
        // Each file holds one certificate in PEM, followed by a text dump.
        let Ok(bytes) = std::fs::read(entry.path()) else {
            continue;
        };
        let Ok(cert) = X509::from_pem(&bytes) else {
            continue;
        };
        // libgit2 adds it to its OpenSSL store, which keeps its own reference.
        let result = unsafe {
            libgit2_sys::git_libgit2_opts(
                libgit2_sys::GIT_OPT_ADD_SSL_X509_CERT as std::os::raw::c_int,
                cert.as_ptr(),
            )
        };
        if result == 0 {
            added += 1;
        }
    }
    Ok(added)
}
