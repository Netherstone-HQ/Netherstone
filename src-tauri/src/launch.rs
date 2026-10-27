//! Files and folders handed to the app from outside it: the terminal
//! (`netherstone .`, `netherstone notes.md`), the system's Open with menu, the
//! folder right-click menu on Windows and a drop on the Dock on macOS.
//!
//! The paths only ever come from the system (the command line the app was
//! started with, the one a second launch passed on, or macOS's open event),
//! never from the window. A folder becomes a vault the way one picked in the
//! folder dialog does, and a file is imported the way one picked in the import
//! dialog is, so a script that got into the page can't use this to reach
//! anything.

use serde::Serialize;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Emitter;

/// What the app was started to do.
#[derive(Debug, PartialEq)]
pub enum Command {
    /// `Netherstone mcp`: the MCP server AI apps start, with no window.
    Mcp,
    /// The app, with any files and folders to open, as written.
    Open(Vec<PathBuf>),
}

/// Reads the command line, without the program's own path.
pub fn parse(args: impl IntoIterator<Item = OsString>) -> Command {
    let mut args = args.into_iter().peekable();
    if args.peek().is_some_and(|first| first == "mcp") {
        return Command::Mcp;
    }
    // Flags are left for the system and the webview.
    Command::Open(
        args.filter(|arg| !arg.to_string_lossy().starts_with('-'))
            .map(PathBuf::from)
            .collect(),
    )
}

/// The event the window listens for to take what came in.
pub const EVENT: &str = "launch";

/// What the window takes: a folder to open as the vault, files to import
/// into it, and the names of files waiting until it can import.
#[derive(Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Taken {
    pub vault: Option<String>,
    pub files: Vec<String>,
    pub waiting: Vec<String>,
}

/// Folders and files handed to the app and not yet taken by the window.
pub struct Launches {
    vault: Mutex<Option<PathBuf>>,
    files: Mutex<Vec<PathBuf>>,
}

static LAUNCHES: Launches = Launches::new();

pub fn get() -> &'static Launches {
    &LAUNCHES
}

impl Launches {
    const fn new() -> Self {
        Self {
            vault: Mutex::new(None),
            files: Mutex::new(Vec::new()),
        }
    }

    /// Notes `paths`, as written relative to `cwd`. Ones that aren't there
    /// are left out. The last folder wins: only one vault is open at a time.
    pub fn add(&self, paths: &[PathBuf], cwd: &Path) -> bool {
        let mut added = false;
        for path in paths.iter().filter_map(|path| resolve(path, cwd)) {
            if path.is_dir() {
                *lock(&self.vault) = Some(path);
            } else {
                let mut files = lock(&self.files);
                if !files.contains(&path) {
                    files.push(path);
                }
            }
            added = true;
        }
        added
    }

    /// Hands the window what came in. The folder may then open as a vault,
    /// and the files, when `can_import`, may be read by the import; files
    /// that can't be imported yet stay for the next take.
    pub fn take(&self, can_import: bool) -> Taken {
        let vault = lock(&self.vault).take();
        if let Some(vault) = &vault {
            crate::vault_access::get().allow(vault);
        }
        let mut files = lock(&self.files);
        let (files, waiting) = if can_import {
            let files = std::mem::take(&mut *files);
            crate::import::picked().allow(&files);
            (files, Vec::new())
        } else {
            (Vec::new(), files.iter().map(|path| name(path)).collect())
        };
        Taken {
            vault: vault.map(|path| text(&path)),
            files: files.iter().map(|path| text(path)).collect(),
            waiting,
        }
    }
}

/// Notes what a launch handed the app and tells the window.
pub fn receive(app: &tauri::AppHandle, paths: &[PathBuf], cwd: &Path) {
    if get().add(paths, cwd)
        && let Err(error) = app.emit(EVENT, ())
    {
        eprintln!("[Netherstone] Couldn't tell the window about opened files: {}", error);
    }
}

/// `path` made absolute against `cwd`, with `.` and `..` worked out, if it's
/// there.
fn resolve(path: &Path, cwd: &Path) -> Option<PathBuf> {
    let path = cwd.join(path);
    // Windows' canonical form starts with `\\?\`, which no other path in the
    // app has; `absolute` works out `..` there without it.
    #[cfg(windows)]
    let path = std::path::absolute(&path).ok().filter(|path| path.exists())?;
    #[cfg(not(windows))]
    let path = path.canonicalize().ok()?;
    Some(path)
}

fn text(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

fn name(path: &Path) -> String {
    path.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| text(path))
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::state::tests::temp_dir;

    fn args(list: &[&str]) -> Vec<OsString> {
        list.iter().map(OsString::from).collect()
    }

    #[test]
    fn reads_the_command_line() {
        assert_eq!(parse(args(&["mcp"])), Command::Mcp);
        assert_eq!(parse(args(&[])), Command::Open(vec![]));
        assert_eq!(
            parse(args(&[".", "-psn_0_123", "notes.md", "mcp"])),
            Command::Open(vec![PathBuf::from("."), PathBuf::from("notes.md"), PathBuf::from("mcp")])
        );
    }

    #[test]
    fn folders_open_and_files_wait_for_a_vault() {
        let dir = temp_dir("launch");
        let (vault, other) = (dir.join("Vault"), dir.join("Other"));
        std::fs::create_dir_all(&vault).unwrap();
        std::fs::create_dir_all(&other).unwrap();
        std::fs::write(vault.join("Report.md"), b"x").unwrap();
        let launches = Launches::new();

        let added = launches.add(
            &[PathBuf::from("Other"), PathBuf::from("Vault/../Vault"), PathBuf::from("Vault/Report.md"), PathBuf::from("missing.md")],
            &dir,
        );
        assert!(added);
        assert!(!launches.add(&[PathBuf::from("missing.md")], &dir));

        let vault = vault.canonicalize().unwrap();
        let report = vault.join("Report.md");
        let taken = launches.take(false);
        assert_eq!(taken.vault, Some(text(&vault)));
        assert_eq!(taken.files, Vec::<String>::new());
        assert_eq!(taken.waiting, vec!["Report.md".to_string()]);

        let taken = launches.take(true);
        assert_eq!(taken, Taken { vault: None, files: vec![text(&report)], waiting: vec![] });
        assert!(crate::import::picked().check(&report).is_ok());
        assert_eq!(launches.take(true), Taken::default());
    }
}
