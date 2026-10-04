//! Where the GitHub sign-in is kept on this device.
//!
//! In the OS credential store wherever there is one: Windows Credential
//! Manager, macOS Keychain, or the Secret Service on Linux (GNOME Keyring,
//! KWallet). Some Linux desktops run no Secret Service at all. There the
//! token goes in a file only the user's account can read, in the app's data
//! folder and never inside a vault, or, if the user would rather not be
//! remembered, stays in memory until the app quits.
//!
//! Only a missing credential store falls back. A keyring that is locked or
//! refuses access reports its error, so a token the user expects in their
//! keyring never quietly lands in a file.

use serde::Serialize;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const KEYRING_SERVICE: &str = "com.netherstone.app.github";
const KEYRING_USER: &str = "default";
const TOKEN_FILE: &str = "github-token";

/// Where the sign-in is kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TokenStorage {
    /// The OS credential store.
    Keyring,
    /// A file only the user's account can read, because there is no keyring.
    File,
    /// Memory only, until the app quits.
    Memory,
}

/// A sign-in made without saving it, kept for this run of the app.
static MEMORY_TOKEN: Mutex<Option<String>> = Mutex::new(None);

/// The credential store, narrowed to the one entry the app uses.
trait Keyring {
    fn get(&self) -> Result<Option<String>, String>;
    fn set(&self, token: &str) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}

struct OsKeyring;

impl OsKeyring {
    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
            .map_err(|e| format!("Secure storage is unavailable: {}", e))
    }

    /// The OS store, or `None` when this device has none. The store is set
    /// up once per run, and setting it up only fails when there is no store
    /// to talk to (no Secret Service on Linux), not when it is locked.
    fn open() -> Option<Self> {
        keyring::Entry::store_status().is_ok().then_some(Self)
    }
}

/// A keyring error worded for the user. A locked keyring whose unlock
/// prompt was dismissed, or that has nothing to show one, is the usual cause.
fn keyring_error(action: &str, error: keyring::Error) -> String {
    format!(
        "Couldn't {action} the GitHub sign-in in your keyring. If it's locked, unlock it and try again. ({error})"
    )
}

impl Keyring for OsKeyring {
    fn get(&self) -> Result<Option<String>, String> {
        match Self::entry()?.get_password() {
            Ok(token) => Ok(Some(token)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(keyring_error("read", e)),
        }
    }

    fn set(&self, token: &str) -> Result<(), String> {
        Self::entry()?
            .set_password(token)
            .map_err(|e| keyring_error("save", e))
    }

    fn delete(&self) -> Result<(), String> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(keyring_error("remove", e)),
        }
    }
}

/// Everywhere a token can be, for one decision.
struct Stores<'a> {
    keyring: Option<&'a dyn Keyring>,
    /// The app's data folder, which holds the token file when there is no
    /// keyring.
    dir: &'a Path,
    memory: &'a Mutex<Option<String>>,
}

fn data_dir() -> Result<PathBuf, String> {
    Ok(crate::db::get_db_path()?
        .parent()
        .ok_or_else(|| "Failed to determine AppData directory".to_string())?
        .to_path_buf())
}

fn with_stores<T>(run: impl FnOnce(&Stores) -> Result<T, String>) -> Result<T, String> {
    let keyring = OsKeyring::open();
    let dir = data_dir()?;
    run(&Stores {
        keyring: keyring.as_ref().map(|k| k as &dyn Keyring),
        dir: &dir,
        memory: &MEMORY_TOKEN,
    })
}

/// The stored token and where it is kept, if the user is signed in.
pub fn load() -> Result<Option<(String, TokenStorage)>, String> {
    with_stores(load_from)
}

/// Keeps the token: in the keyring when there is one; otherwise in the token
/// file, or only in memory when `remember` is false.
pub fn save(token: &str, remember: bool) -> Result<TokenStorage, String> {
    with_stores(|stores| save_to(stores, token, remember))
}

/// Forgets the token wherever it is kept.
pub fn clear() -> Result<(), String> {
    with_stores(clear_in)
}

/// Whether this device has a credential store to keep the sign-in in.
pub fn keyring_available() -> bool {
    OsKeyring::open().is_some()
}

fn lock_memory(
    memory: &Mutex<Option<String>>,
) -> Result<std::sync::MutexGuard<'_, Option<String>>, String> {
    memory.lock().map_err(|e| e.to_string())
}

fn load_from(stores: &Stores) -> Result<Option<(String, TokenStorage)>, String> {
    if let Some(token) = lock_memory(stores.memory)?.clone() {
        return Ok(Some((token, TokenStorage::Memory)));
    }

    let file_token = read_token_file(stores.dir)?;
    let Some(keyring) = stores.keyring else {
        return Ok(file_token.map(|token| (token, TokenStorage::File)));
    };

    if let Some(token) = keyring.get()? {
        return Ok(Some((token, TokenStorage::Keyring)));
    }

    // Saved to a file before this device had a keyring: move it in. If the
    // keyring won't take it yet, keep using the file the user chose.
    let Some(token) = file_token else {
        return Ok(None);
    };
    if keyring.set(&token).is_err() || remove_token_file(stores.dir).is_err() {
        return Ok(Some((token, TokenStorage::File)));
    }
    Ok(Some((token, TokenStorage::Keyring)))
}

fn save_to(stores: &Stores, token: &str, remember: bool) -> Result<TokenStorage, String> {
    let storage = match stores.keyring {
        Some(keyring) => {
            keyring.set(token)?;
            remove_token_file(stores.dir)?;
            TokenStorage::Keyring
        }
        None if remember => {
            write_token_file(stores.dir, token)?;
            TokenStorage::File
        }
        None => {
            remove_token_file(stores.dir)?;
            *lock_memory(stores.memory)? = Some(token.to_string());
            return Ok(TokenStorage::Memory);
        }
    };
    *lock_memory(stores.memory)? = None;
    Ok(storage)
}

fn clear_in(stores: &Stores) -> Result<(), String> {
    *lock_memory(stores.memory)? = None;
    if let Some(keyring) = stores.keyring {
        keyring.delete()?;
    }
    remove_token_file(stores.dir)
}

fn read_token_file(dir: &Path) -> Result<Option<String>, String> {
    match std::fs::read_to_string(dir.join(TOKEN_FILE)) {
        Ok(contents) => {
            let token = contents.trim();
            Ok((!token.is_empty()).then(|| token.to_string()))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Couldn't read the GitHub sign-in: {}", e)),
    }
}

/// Writes the token where only the user's account can read it. Written to a
/// temporary file first, so a crash never leaves half a token.
fn write_token_file(dir: &Path, token: &str) -> Result<(), String> {
    let failed = |e: std::io::Error| format!("Couldn't save the GitHub sign-in: {}", e);
    let path = dir.join(TOKEN_FILE);
    let temporary = dir.join(format!("{TOKEN_FILE}.tmp"));

    let mut options = std::fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);

    let mut file = options.open(&temporary).map_err(failed)?;
    // The mode above only applies to a new file; a leftover one keeps its own.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))
            .map_err(failed)?;
    }
    file.write_all(token.as_bytes()).map_err(failed)?;
    file.sync_all().map_err(failed)?;
    drop(file);

    std::fs::rename(&temporary, &path).map_err(failed)
}

fn remove_token_file(dir: &Path) -> Result<(), String> {
    match std::fs::remove_file(dir.join(TOKEN_FILE)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Couldn't remove the GitHub sign-in: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[derive(Default)]
    struct FakeKeyring {
        token: RefCell<Option<String>>,
        /// Fails every call, like a keyring that is locked or refuses access.
        refuses: bool,
    }

    impl Keyring for FakeKeyring {
        fn get(&self) -> Result<Option<String>, String> {
            if self.refuses {
                return Err("locked".into());
            }
            Ok(self.token.borrow().clone())
        }

        fn set(&self, token: &str) -> Result<(), String> {
            if self.refuses {
                return Err("locked".into());
            }
            *self.token.borrow_mut() = Some(token.to_string());
            Ok(())
        }

        fn delete(&self) -> Result<(), String> {
            if self.refuses {
                return Err("locked".into());
            }
            *self.token.borrow_mut() = None;
            Ok(())
        }
    }

    fn temp_dir(name: &str) -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("netherstone-token-{}-{}", name, std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn stores<'a>(
        keyring: Option<&'a FakeKeyring>,
        dir: &'a Path,
        memory: &'a Mutex<Option<String>>,
    ) -> Stores<'a> {
        Stores {
            keyring: keyring.map(|k| k as &dyn Keyring),
            dir,
            memory,
        }
    }

    #[test]
    fn keeps_the_token_in_the_keyring_when_there_is_one() {
        let dir = temp_dir("keyring");
        let memory = Mutex::new(None);
        let keyring = FakeKeyring::default();
        let stores = stores(Some(&keyring), &dir, &memory);

        // Asking not to be remembered only matters without a keyring.
        assert_eq!(save_to(&stores, "tok", false), Ok(TokenStorage::Keyring));
        assert_eq!(keyring.token.borrow().as_deref(), Some("tok"));
        assert!(!dir.join(TOKEN_FILE).exists());
        assert_eq!(
            load_from(&stores),
            Ok(Some(("tok".to_string(), TokenStorage::Keyring)))
        );

        clear_in(&stores).unwrap();
        assert_eq!(load_from(&stores), Ok(None));
    }

    #[cfg(unix)]
    #[test]
    fn without_a_keyring_saves_a_file_only_the_user_can_read() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("file");
        let memory = Mutex::new(None);
        let stores = stores(None, &dir, &memory);

        // A leftover temporary file with loose permissions doesn't leak them.
        std::fs::write(dir.join(format!("{TOKEN_FILE}.tmp")), "old").unwrap();
        std::fs::set_permissions(
            dir.join(format!("{TOKEN_FILE}.tmp")),
            std::fs::Permissions::from_mode(0o644),
        )
        .unwrap();

        assert_eq!(save_to(&stores, "tok", true), Ok(TokenStorage::File));
        let mode = std::fs::metadata(dir.join(TOKEN_FILE))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
        assert_eq!(
            load_from(&stores),
            Ok(Some(("tok".to_string(), TokenStorage::File)))
        );

        clear_in(&stores).unwrap();
        assert!(!dir.join(TOKEN_FILE).exists());
        assert_eq!(load_from(&stores), Ok(None));
    }

    #[test]
    fn without_a_keyring_can_keep_the_token_for_this_run_only() {
        let dir = temp_dir("memory");
        let memory = Mutex::new(None);
        let this_run = stores(None, &dir, &memory);

        assert_eq!(save_to(&this_run, "tok", false), Ok(TokenStorage::Memory));
        assert!(!dir.join(TOKEN_FILE).exists());
        assert_eq!(
            load_from(&this_run),
            Ok(Some(("tok".to_string(), TokenStorage::Memory)))
        );

        // The next run of the app starts with empty memory.
        let empty = Mutex::new(None);
        assert_eq!(load_from(&stores(None, &dir, &empty)), Ok(None));
    }

    #[test]
    fn moves_a_file_token_into_a_keyring_that_appeared() {
        let dir = temp_dir("migrate");
        let memory = Mutex::new(None);
        write_token_file(&dir, "tok").unwrap();

        let keyring = FakeKeyring::default();
        let stores = stores(Some(&keyring), &dir, &memory);
        assert_eq!(
            load_from(&stores),
            Ok(Some(("tok".to_string(), TokenStorage::Keyring)))
        );
        assert_eq!(keyring.token.borrow().as_deref(), Some("tok"));
        assert!(!dir.join(TOKEN_FILE).exists());
    }

    #[test]
    fn a_keyring_that_refuses_reports_it_instead_of_writing_a_file() {
        let dir = temp_dir("refuses");
        let memory = Mutex::new(None);
        let keyring = FakeKeyring {
            refuses: true,
            ..FakeKeyring::default()
        };
        let stores = stores(Some(&keyring), &dir, &memory);

        assert!(save_to(&stores, "tok", true).is_err());
        assert!(!dir.join(TOKEN_FILE).exists());
        assert!(load_from(&stores).is_err());
    }

    #[test]
    fn keeps_using_the_file_if_a_new_keyring_wont_take_the_token() {
        let dir = temp_dir("migrate-refused");
        let memory = Mutex::new(None);
        write_token_file(&dir, "tok").unwrap();

        // Readable but refusing writes, like a keyring waiting to be unlocked.
        struct ReadOnly;
        impl Keyring for ReadOnly {
            fn get(&self) -> Result<Option<String>, String> {
                Ok(None)
            }
            fn set(&self, _: &str) -> Result<(), String> {
                Err("locked".into())
            }
            fn delete(&self) -> Result<(), String> {
                Ok(())
            }
        }
        let keyring = ReadOnly;
        let stores = Stores {
            keyring: Some(&keyring),
            dir: &dir,
            memory: &memory,
        };

        assert_eq!(
            load_from(&stores),
            Ok(Some(("tok".to_string(), TokenStorage::File)))
        );
        assert!(dir.join(TOKEN_FILE).exists());
    }

    #[test]
    fn ignores_an_empty_token_file() {
        let dir = temp_dir("empty");
        std::fs::write(dir.join(TOKEN_FILE), "\n").unwrap();
        assert_eq!(read_token_file(&dir), Ok(None));
    }
}
