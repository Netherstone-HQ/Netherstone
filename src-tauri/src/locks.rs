//! Locks shared by every Netherstone process on this device (the app, and
//! later the MCP server), so two of them never write at once.
//!
//! Each lock is a file held with an OS file lock, which the OS releases if the
//! process dies. A mutex in front of it serializes threads of this process.

use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

/// Held until dropped.
pub struct LockGuard {
    // Fields drop in order: the file lock goes first, then the mutex.
    _file: File,
    _thread: MutexGuard<'static, ()>,
}

fn hold(thread_lock: &'static Mutex<()>, path: &Path) -> Result<LockGuard, String> {
    // A panic while holding the lock leaves nothing half-done worth refusing over.
    let thread = thread_lock.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
    }
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(path)
        .map_err(|e| format!("Failed to open {}: {}", path.display(), e))?;
    file.lock()
        .map_err(|e| format!("Failed to lock {}: {}", path.display(), e))?;
    Ok(LockGuard {
        _file: file,
        _thread: thread,
    })
}

static VAULT_WRITES: Mutex<()> = Mutex::new(());
static HISTORY: Mutex<()> = Mutex::new(());
static SYNC: Mutex<()> = Mutex::new(());

fn app_dir() -> Result<PathBuf, String> {
    crate::db::get_db_path()?
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Failed to determine AppData directory".to_string())
}

/// Proof that `writes.lock` is held, which every write into a vault needs.
pub struct VaultWrites {
    _held: LockGuard,
}

/// Held while changing a vault's files: saving, creating, renaming, moving or
/// deleting them. Kept short: never held across Git or network work. Taken
/// after `history` when both are needed, never the other way round.
pub fn vault_writes() -> Result<VaultWrites, String> {
    hold(&VAULT_WRITES, &app_dir()?.join("writes.lock")).map(|held| VaultWrites { _held: held })
}

/// Held while using the vaults' Git repositories in `sync_root`: saving a
/// version, bringing a sync's changes in, settling a conflict. Never held
/// across network work.
pub fn history(sync_root: &Path) -> Result<LockGuard, String> {
    hold(&HISTORY, &sync_root.join("history.lock"))
}

/// Held for a whole sync, network included, so only one runs at a time.
/// Taken before `history`.
pub fn sync(sync_root: &Path) -> Result<LockGuard, String> {
    hold(&SYNC, &sync_root.join("sync.lock"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    #[test]
    fn a_second_holder_waits_for_the_first() {
        let dir = crate::sync::state::tests::temp_dir("locks");
        let first = history(&dir).unwrap();
        let released = Arc::new(AtomicBool::new(false));

        let waiter = {
            let (dir, released) = (dir.clone(), released.clone());
            std::thread::spawn(move || {
                let _second = history(&dir).unwrap();
                assert!(released.load(Ordering::SeqCst));
            })
        };

        std::thread::sleep(std::time::Duration::from_millis(100));
        released.store(true, Ordering::SeqCst);
        drop(first);
        waiter.join().unwrap();
    }

    #[test]
    fn another_handle_on_the_lock_file_is_refused_while_held() {
        // Stands in for another process: a separate handle on the same file.
        let dir = crate::sync::state::tests::temp_dir("locks-file");
        let guard = history(&dir).unwrap();
        let other = File::open(dir.join("history.lock")).unwrap();
        assert!(other.try_lock().is_err());
        drop(guard);
        assert!(other.try_lock().is_ok());
    }
}
