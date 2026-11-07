//! Where the app keeps secrets on this device, one named entry per secret:
//! the GitHub sign-in today, keys for other services as they're added.
//!
//! In the OS credential store wherever there is one: Windows Credential
//! Manager, macOS Keychain, or the Secret Service on Linux (GNOME Keyring,
//! KWallet). Some Linux desktops run no Secret Service at all. There a secret
//! goes in a file only the user's account can read, in the app's data folder
//! and never inside a vault, or, if the user would rather not be remembered,
//! stays in memory until the app quits.
//!
//! Only a missing credential store falls back. A keyring that is locked or
//! refuses access reports its error, so a secret the user expects in their
//! keyring never quietly lands in a file.

use serde::Serialize;
use std::collections::BTreeMap;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// One secret the app keeps. Its names are where it's stored, so they never
/// change once released, or users would lose what they saved.
pub struct Credential {
    /// Names the entry in memory.
    id: &'static str,
    /// The OS credential store's service and account names for it.
    keyring_service: &'static str,
    keyring_user: &'static str,
    /// The file it's kept in, in the app's data folder, when there's no
    /// keyring.
    file: &'static str,
    /// What the user knows it as, for messages.
    label: &'static str,
}

pub const GITHUB: Credential = Credential {
    id: "github",
    keyring_service: "com.netherstone.app.github",
    keyring_user: "default",
    file: "github-token",
    label: "GitHub sign-in",
};

/// A key for an AI provider the assistant uses. Its names follow the
/// provider's id, so each provider keeps its own entry.
const fn ai_key(
    id: &'static str,
    keyring_service: &'static str,
    file: &'static str,
    label: &'static str,
) -> Credential {
    Credential {
        id,
        keyring_service,
        keyring_user: "default",
        file,
        label,
    }
}

pub const OPENAI_KEY: Credential = ai_key(
    "ai-openai",
    "com.netherstone.app.ai.openai",
    "ai-openai-key",
    "OpenAI key",
);
pub const ANTHROPIC_KEY: Credential = ai_key(
    "ai-anthropic",
    "com.netherstone.app.ai.anthropic",
    "ai-anthropic-key",
    "Anthropic key",
);
pub const GOOGLE_KEY: Credential = ai_key(
    "ai-google",
    "com.netherstone.app.ai.google",
    "ai-google-key",
    "Google key",
);
pub const OPENROUTER_KEY: Credential = ai_key(
    "ai-openrouter",
    "com.netherstone.app.ai.openrouter",
    "ai-openrouter-key",
    "OpenRouter key",
);
pub const CUSTOM_KEY: Credential = ai_key(
    "ai-custom",
    "com.netherstone.app.ai.custom",
    "ai-custom-key",
    "Custom server key",
);

/// Where a secret is kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Storage {
    /// The OS credential store.
    Keyring,
    /// A file only the user's account can read, because there is no keyring.
    File,
    /// Memory only, until the app quits.
    Memory,
}

type Memory = Mutex<BTreeMap<&'static str, String>>;

/// Secrets saved without being remembered, kept for this run of the app.
static MEMORY: Memory = Mutex::new(BTreeMap::new());

/// Secrets looked for in the keyring once this run, for keys saved before
/// the app marked where it keeps them.
type Checked = Mutex<std::collections::BTreeSet<&'static str>>;

static CHECKED: Checked = Mutex::new(std::collections::BTreeSet::new());

/// The credential store.
trait Keyring {
    fn get(&self, credential: &Credential) -> Result<Option<String>, String>;
    fn set(&self, credential: &Credential, secret: &str) -> Result<(), String>;
    fn delete(&self, credential: &Credential) -> Result<(), String>;
}

struct OsKeyring;

impl OsKeyring {
    fn entry(credential: &Credential) -> Result<keyring::Entry, String> {
        keyring::Entry::new(credential.keyring_service, credential.keyring_user)
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
fn keyring_error(credential: &Credential, action: &str, error: keyring::Error) -> String {
    format!(
        "Couldn't {action} the {} in your keyring. If it's locked, unlock it and try again. ({error})",
        credential.label
    )
}

impl Keyring for OsKeyring {
    fn get(&self, credential: &Credential) -> Result<Option<String>, String> {
        match Self::entry(credential)?.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(keyring_error(credential, "read", e)),
        }
    }

    fn set(&self, credential: &Credential, secret: &str) -> Result<(), String> {
        Self::entry(credential)?
            .set_password(secret)
            .map_err(|e| keyring_error(credential, "save", e))
    }

    fn delete(&self, credential: &Credential) -> Result<(), String> {
        match Self::entry(credential)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(keyring_error(credential, "remove", e)),
        }
    }
}

/// Everywhere a secret can be, for one decision.
struct Stores<'a> {
    keyring: Option<&'a dyn Keyring>,
    /// The app's data folder, which holds the files when there is no
    /// keyring.
    dir: &'a Path,
    memory: &'a Memory,
    checked: &'a Checked,
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
        memory: &MEMORY,
        checked: &CHECKED,
    })
}

/// The saved secret and where it is kept, if there is one.
pub fn load(credential: &Credential) -> Result<Option<(String, Storage)>, String> {
    with_stores(|stores| load_from(stores, credential))
}

/// Keeps the secret: in the keyring when there is one; otherwise in its
/// file, or only in memory when `remember` is false.
pub fn save(credential: &Credential, secret: &str, remember: bool) -> Result<Storage, String> {
    with_stores(|stores| save_to(stores, credential, secret, remember))
}

/// Forgets the secret wherever it is kept.
pub fn clear(credential: &Credential) -> Result<(), String> {
    with_stores(|stores| clear_in(stores, credential))
}

/// Where the secret is kept, if there is one, without reading it: reading
/// the keyring can ask the user to unlock it or let the app in. Only a
/// secret saved before the app marked where it keeps them is looked for,
/// once a run.
pub fn kept(credential: &Credential) -> Result<Option<Storage>, String> {
    with_stores(|stores| kept_in(stores, credential))
}

/// Whether this device has a credential store to keep secrets in.
pub fn keyring_available() -> bool {
    OsKeyring::open().is_some()
}

fn lock_memory(
    memory: &Memory,
) -> Result<std::sync::MutexGuard<'_, BTreeMap<&'static str, String>>, String> {
    memory.lock().map_err(|e| e.to_string())
}

/// The file that says a secret is in the keyring, so where it's kept is
/// known without reading it.
fn keyring_marker(dir: &Path, credential: &Credential) -> PathBuf {
    dir.join(format!("{}.in-keyring", credential.file))
}

fn mark_in_keyring(dir: &Path, credential: &Credential, in_keyring: bool) -> Result<(), String> {
    let marker = keyring_marker(dir, credential);
    let result = match in_keyring {
        true => std::fs::write(&marker, b""),
        false => std::fs::remove_file(&marker),
    };
    match result {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(format!(
            "Couldn't save where the {} is: {}",
            credential.label, e
        )),
        _ => Ok(()),
    }
}

fn kept_in(stores: &Stores, credential: &Credential) -> Result<Option<Storage>, String> {
    if lock_memory(stores.memory)?.contains_key(credential.id) {
        return Ok(Some(Storage::Memory));
    }
    if stores.dir.join(credential.file).exists() {
        return Ok(Some(Storage::File));
    }
    if stores.keyring.is_none() {
        return Ok(None);
    }
    if keyring_marker(stores.dir, credential).exists() {
        return Ok(Some(Storage::Keyring));
    }
    // Saved before the marker was: looked for once a run, which marks it.
    let first_look = stores
        .checked
        .lock()
        .map_err(|e| e.to_string())?
        .insert(credential.id);
    if first_look {
        return Ok(load_from(stores, credential)?.map(|(_, storage)| storage));
    }
    Ok(None)
}

fn load_from(
    stores: &Stores,
    credential: &Credential,
) -> Result<Option<(String, Storage)>, String> {
    if let Some(secret) = lock_memory(stores.memory)?.get(credential.id).cloned() {
        return Ok(Some((secret, Storage::Memory)));
    }

    let file_secret = read_file(stores.dir, credential)?;
    let Some(keyring) = stores.keyring else {
        return Ok(file_secret.map(|secret| (secret, Storage::File)));
    };

    let keyring_secret = keyring.get(credential)?;
    // Keeps the marker true to the keyring, which can change outside the app.
    mark_in_keyring(stores.dir, credential, keyring_secret.is_some())?;
    if let Some(secret) = keyring_secret {
        return Ok(Some((secret, Storage::Keyring)));
    }

    // Saved to a file before this device had a keyring: move it in. If the
    // keyring won't take it yet, keep using the file the user chose.
    let Some(secret) = file_secret else {
        return Ok(None);
    };
    if keyring.set(credential, &secret).is_err() {
        return Ok(Some((secret, Storage::File)));
    }
    mark_in_keyring(stores.dir, credential, true)?;
    if remove_file(stores.dir, credential).is_err() {
        return Ok(Some((secret, Storage::File)));
    }
    Ok(Some((secret, Storage::Keyring)))
}

fn save_to(
    stores: &Stores,
    credential: &Credential,
    secret: &str,
    remember: bool,
) -> Result<Storage, String> {
    let storage = match stores.keyring {
        Some(keyring) => {
            keyring.set(credential, secret)?;
            mark_in_keyring(stores.dir, credential, true)?;
            remove_file(stores.dir, credential)?;
            Storage::Keyring
        }
        None if remember => {
            write_file(stores.dir, credential, secret)?;
            Storage::File
        }
        None => {
            remove_file(stores.dir, credential)?;
            lock_memory(stores.memory)?.insert(credential.id, secret.to_string());
            return Ok(Storage::Memory);
        }
    };
    lock_memory(stores.memory)?.remove(credential.id);
    Ok(storage)
}

fn clear_in(stores: &Stores, credential: &Credential) -> Result<(), String> {
    lock_memory(stores.memory)?.remove(credential.id);
    if let Some(keyring) = stores.keyring {
        keyring.delete(credential)?;
    }
    mark_in_keyring(stores.dir, credential, false)?;
    remove_file(stores.dir, credential)
}

fn read_file(dir: &Path, credential: &Credential) -> Result<Option<String>, String> {
    match std::fs::read_to_string(dir.join(credential.file)) {
        Ok(contents) => {
            let secret = contents.trim();
            Ok((!secret.is_empty()).then(|| secret.to_string()))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("Couldn't read the {}: {}", credential.label, e)),
    }
}

/// Writes the secret where only the user's account can read it. Written to
/// a temporary file first, so a crash never leaves half a secret.
fn write_file(dir: &Path, credential: &Credential, secret: &str) -> Result<(), String> {
    let failed = |e: std::io::Error| format!("Couldn't save the {}: {}", credential.label, e);
    let path = dir.join(credential.file);
    let temporary = dir.join(format!("{}.tmp", credential.file));

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
    file.write_all(secret.as_bytes()).map_err(failed)?;
    file.sync_all().map_err(failed)?;
    drop(file);

    std::fs::rename(&temporary, &path).map_err(failed)
}

fn remove_file(dir: &Path, credential: &Credential) -> Result<(), String> {
    match std::fs::remove_file(dir.join(credential.file)) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Couldn't remove the {}: {}", credential.label, e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    use std::collections::HashMap;

    /// A keyring holding entries by service and account, like the OS one.
    #[derive(Default)]
    struct FakeKeyring {
        entries: RefCell<HashMap<(String, String), String>>,
        /// Fails every call, like a keyring that is locked or refuses access.
        refuses: bool,
    }

    fn key(credential: &Credential) -> (String, String) {
        (
            credential.keyring_service.to_string(),
            credential.keyring_user.to_string(),
        )
    }

    impl FakeKeyring {
        fn holding(service: &str, user: &str, secret: &str) -> Self {
            let keyring = Self::default();
            keyring
                .entries
                .borrow_mut()
                .insert((service.to_string(), user.to_string()), secret.to_string());
            keyring
        }

        fn secret(&self, credential: &Credential) -> Option<String> {
            self.entries.borrow().get(&key(credential)).cloned()
        }
    }

    impl Keyring for FakeKeyring {
        fn get(&self, credential: &Credential) -> Result<Option<String>, String> {
            if self.refuses {
                return Err("locked".into());
            }
            Ok(self.secret(credential))
        }

        fn set(&self, credential: &Credential, secret: &str) -> Result<(), String> {
            if self.refuses {
                return Err("locked".into());
            }
            self.entries
                .borrow_mut()
                .insert(key(credential), secret.to_string());
            Ok(())
        }

        fn delete(&self, credential: &Credential) -> Result<(), String> {
            if self.refuses {
                return Err("locked".into());
            }
            self.entries.borrow_mut().remove(&key(credential));
            Ok(())
        }
    }

    /// A second entry, to show entries stay apart.
    const OTHER: Credential = Credential {
        id: "other",
        keyring_service: "com.netherstone.app.other",
        keyring_user: "default",
        file: "other-key",
        label: "other key",
    };

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "netherstone-credentials-{}-{}",
            name,
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn stores<'a>(
        keyring: Option<&'a FakeKeyring>,
        dir: &'a Path,
        memory: &'a Memory,
    ) -> Stores<'a> {
        // Fresh for each call: what was looked for belongs to one run.
        let checked: &'a Checked = Box::leak(Box::default());
        Stores {
            keyring: keyring.map(|k| k as &dyn Keyring),
            dir,
            memory,
            checked,
        }
    }

    #[test]
    fn reads_the_github_sign_in_from_the_keychain_entry_earlier_versions_saved() {
        let dir = temp_dir("github-keyring");
        let memory = Memory::default();
        let keyring = FakeKeyring::holding("com.netherstone.app.github", "default", "tok");

        assert_eq!(
            load_from(&stores(Some(&keyring), &dir, &memory), &GITHUB),
            Ok(Some(("tok".to_string(), Storage::Keyring)))
        );
    }

    #[test]
    fn reads_the_github_sign_in_from_the_file_earlier_versions_saved() {
        let dir = temp_dir("github-file");
        let memory = Memory::default();
        std::fs::write(dir.join("github-token"), "tok\n").unwrap();

        assert_eq!(
            load_from(&stores(None, &dir, &memory), &GITHUB),
            Ok(Some(("tok".to_string(), Storage::File)))
        );
    }

    #[test]
    fn keeps_the_secret_in_the_keyring_when_there_is_one() {
        let dir = temp_dir("keyring");
        let memory = Memory::default();
        let keyring = FakeKeyring::default();
        let stores = stores(Some(&keyring), &dir, &memory);

        // Asking not to be remembered only matters without a keyring.
        assert_eq!(
            save_to(&stores, &GITHUB, "tok", false),
            Ok(Storage::Keyring)
        );
        assert_eq!(keyring.secret(&GITHUB).as_deref(), Some("tok"));
        assert!(!dir.join(GITHUB.file).exists());
        assert_eq!(
            load_from(&stores, &GITHUB),
            Ok(Some(("tok".to_string(), Storage::Keyring)))
        );

        clear_in(&stores, &GITHUB).unwrap();
        assert_eq!(load_from(&stores, &GITHUB), Ok(None));
    }

    #[test]
    fn says_where_a_secret_is_without_reading_the_keyring() {
        let dir = temp_dir("kept");
        let memory = Memory::default();
        let keyring = FakeKeyring::default();
        let open = stores(Some(&keyring), &dir, &memory);
        assert_eq!(kept_in(&open, &GITHUB), Ok(None));
        save_to(&open, &GITHUB, "tok", true).unwrap();

        // A keyring that would fail a read isn't asked.
        let locked = FakeKeyring {
            refuses: true,
            ..Default::default()
        };
        assert_eq!(
            kept_in(&stores(Some(&locked), &dir, &memory), &GITHUB),
            Ok(Some(Storage::Keyring))
        );

        // Gone from the keyring outside the app: the next read finds out.
        keyring.entries.borrow_mut().clear();
        assert_eq!(load_from(&open, &GITHUB), Ok(None));
        assert_eq!(kept_in(&open, &GITHUB), Ok(None));

        // Saved before markers: found by one look, then known without one.
        let older = FakeKeyring::holding("com.netherstone.app.github", "default", "tok");
        let first_run = stores(Some(&older), &dir, &memory);
        assert_eq!(kept_in(&first_run, &GITHUB), Ok(Some(Storage::Keyring)));
        older.entries.borrow_mut().clear();
        assert_eq!(kept_in(&first_run, &GITHUB), Ok(Some(Storage::Keyring)));
        clear_in(&first_run, &GITHUB).unwrap();
        // Nothing there: looked for once a run, not on every read.
        let none = FakeKeyring {
            refuses: true,
            ..Default::default()
        };
        let run = stores(Some(&none), &dir, &memory);
        assert!(kept_in(&run, &GITHUB).is_err());
        assert_eq!(kept_in(&run, &GITHUB), Ok(None));

        let without = stores(None, &dir, &memory);
        save_to(&without, &GITHUB, "tok", true).unwrap();
        assert_eq!(kept_in(&without, &GITHUB), Ok(Some(Storage::File)));
        save_to(&without, &OTHER, "tok", false).unwrap();
        assert_eq!(kept_in(&without, &OTHER), Ok(Some(Storage::Memory)));
        clear_in(&without, &GITHUB).unwrap();
        assert_eq!(kept_in(&without, &GITHUB), Ok(None));
    }

    #[test]
    fn keeps_each_entry_apart() {
        let dir = temp_dir("apart");
        let memory = Memory::default();
        let keyring = FakeKeyring::default();
        let with_keyring = stores(Some(&keyring), &dir, &memory);
        let without = stores(None, &dir, &memory);

        save_to(&with_keyring, &GITHUB, "tok", true).unwrap();
        save_to(&with_keyring, &OTHER, "key", true).unwrap();
        clear_in(&with_keyring, &OTHER).unwrap();
        assert_eq!(
            load_from(&with_keyring, &GITHUB),
            Ok(Some(("tok".to_string(), Storage::Keyring)))
        );
        assert_eq!(load_from(&with_keyring, &OTHER), Ok(None));

        save_to(&without, &GITHUB, "tok", true).unwrap();
        save_to(&without, &OTHER, "key", true).unwrap();
        assert_eq!(read_file(&dir, &GITHUB), Ok(Some("tok".to_string())));
        assert_eq!(read_file(&dir, &OTHER), Ok(Some("key".to_string())));
        clear_in(&without, &OTHER).unwrap();
        assert_eq!(read_file(&dir, &GITHUB), Ok(Some("tok".to_string())));

        save_to(&without, &GITHUB, "tok", false).unwrap();
        save_to(&without, &OTHER, "key", false).unwrap();
        clear_in(&without, &GITHUB).unwrap();
        assert_eq!(load_from(&without, &GITHUB), Ok(None));
        assert_eq!(
            load_from(&without, &OTHER),
            Ok(Some(("key".to_string(), Storage::Memory)))
        );
    }

    #[cfg(unix)]
    #[test]
    fn without_a_keyring_saves_a_file_only_the_user_can_read() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("file");
        let memory = Memory::default();
        let stores = stores(None, &dir, &memory);
        let temporary = dir.join(format!("{}.tmp", GITHUB.file));

        // A leftover temporary file with loose permissions doesn't leak them.
        std::fs::write(&temporary, "old").unwrap();
        std::fs::set_permissions(&temporary, std::fs::Permissions::from_mode(0o644)).unwrap();

        assert_eq!(save_to(&stores, &GITHUB, "tok", true), Ok(Storage::File));
        let mode = std::fs::metadata(dir.join(GITHUB.file))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
        assert_eq!(
            load_from(&stores, &GITHUB),
            Ok(Some(("tok".to_string(), Storage::File)))
        );

        clear_in(&stores, &GITHUB).unwrap();
        assert!(!dir.join(GITHUB.file).exists());
        assert_eq!(load_from(&stores, &GITHUB), Ok(None));
    }

    #[test]
    fn without_a_keyring_can_keep_the_secret_for_this_run_only() {
        let dir = temp_dir("memory");
        let memory = Memory::default();
        let this_run = stores(None, &dir, &memory);

        assert_eq!(
            save_to(&this_run, &GITHUB, "tok", false),
            Ok(Storage::Memory)
        );
        assert!(!dir.join(GITHUB.file).exists());
        assert_eq!(
            load_from(&this_run, &GITHUB),
            Ok(Some(("tok".to_string(), Storage::Memory)))
        );

        // The next run of the app starts with empty memory.
        let empty = Memory::default();
        assert_eq!(load_from(&stores(None, &dir, &empty), &GITHUB), Ok(None));
    }

    #[test]
    fn moves_a_file_secret_into_a_keyring_that_appeared() {
        let dir = temp_dir("migrate");
        let memory = Memory::default();
        write_file(&dir, &GITHUB, "tok").unwrap();

        let keyring = FakeKeyring::default();
        let stores = stores(Some(&keyring), &dir, &memory);
        assert_eq!(
            load_from(&stores, &GITHUB),
            Ok(Some(("tok".to_string(), Storage::Keyring)))
        );
        assert_eq!(keyring.secret(&GITHUB).as_deref(), Some("tok"));
        assert!(!dir.join(GITHUB.file).exists());
    }

    #[test]
    fn a_keyring_that_refuses_reports_it_instead_of_writing_a_file() {
        let dir = temp_dir("refuses");
        let memory = Memory::default();
        let keyring = FakeKeyring {
            refuses: true,
            ..FakeKeyring::default()
        };
        let stores = stores(Some(&keyring), &dir, &memory);

        assert!(save_to(&stores, &GITHUB, "tok", true).is_err());
        assert!(!dir.join(GITHUB.file).exists());
        assert!(load_from(&stores, &GITHUB).is_err());
    }

    #[test]
    fn keeps_using_the_file_if_a_new_keyring_wont_take_the_secret() {
        let dir = temp_dir("migrate-refused");
        let memory = Memory::default();
        write_file(&dir, &GITHUB, "tok").unwrap();

        // Readable but refusing writes, like a keyring waiting to be unlocked.
        struct ReadOnly;
        impl Keyring for ReadOnly {
            fn get(&self, _: &Credential) -> Result<Option<String>, String> {
                Ok(None)
            }
            fn set(&self, _: &Credential, _: &str) -> Result<(), String> {
                Err("locked".into())
            }
            fn delete(&self, _: &Credential) -> Result<(), String> {
                Ok(())
            }
        }
        let keyring = ReadOnly;
        let stores = Stores {
            keyring: Some(&keyring),
            dir: &dir,
            memory: &memory,
            checked: &Checked::default(),
        };

        assert_eq!(
            load_from(&stores, &GITHUB),
            Ok(Some(("tok".to_string(), Storage::File)))
        );
        assert!(dir.join(GITHUB.file).exists());
    }

    #[test]
    fn every_entry_has_its_own_names() {
        let all = [
            &GITHUB,
            &OPENAI_KEY,
            &ANTHROPIC_KEY,
            &GOOGLE_KEY,
            &OPENROUTER_KEY,
            &CUSTOM_KEY,
        ];
        for (i, a) in all.iter().enumerate() {
            for b in &all[i + 1..] {
                assert_ne!(a.id, b.id);
                assert_ne!(a.keyring_service, b.keyring_service);
                assert_ne!(a.file, b.file);
            }
        }
    }

    #[test]
    fn ignores_an_empty_file() {
        let dir = temp_dir("empty");
        std::fs::write(dir.join(GITHUB.file), "\n").unwrap();
        assert_eq!(read_file(&dir, &GITHUB), Ok(None));
    }
}
