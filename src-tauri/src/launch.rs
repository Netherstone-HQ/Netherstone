//! Files and folders handed to the app from outside it: the terminal
//! (`netherstone .`, `netherstone notes.md`), the system's Open with menu, the
//! folder right-click menu on Windows and a drop on the Dock on macOS.
//!
//! The paths only ever come from the system (the command line the app was
//! started with, the one a second launch passed on, or macOS's open event),
//! never from the window. A folder becomes a vault the way one picked in the
//! folder dialog does, and a file is imported the way one picked in the import
//! dialog is.
//!
//! Once the page runs, it can cause a launch itself: opening a file in its own
//! app (`open_file`) hands it back here when Netherstone is that app. So what
//! arrives after the window first took anything waits for the person to say
//! yes in a native dialog, which a script in the page can't click.

use serde::Serialize;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Emitter;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

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

/// Moves the app's current folder to its own data folder, once the command
/// line's paths are read against it. Started from inside a folder, as by
/// `netherstone .` or a folder's menu, the app would otherwise hold that
/// folder for as long as it runs, so it couldn't be deleted or renamed.
pub fn leave_current_folder() {
    let own = crate::db::get_db_path().ok().and_then(|db| db.parent().map(Path::to_path_buf));
    if let Some(own) = own
        && let Err(error) = std::env::set_current_dir(&own)
    {
        eprintln!("[Netherstone] Couldn't leave the folder the app started in: {}", error);
    }
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
    /// Set on the window's first take, once the page runs.
    page_running: AtomicBool,
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
            page_running: AtomicBool::new(false),
        }
    }

    /// Notes `paths`, as written relative to `cwd`. Ones that aren't there
    /// are left out. The last folder wins: only one vault is open at a time.
    pub fn add(&self, paths: &[PathBuf], cwd: &Path) -> bool {
        self.keep(resolve_all(paths, cwd))
    }

    /// Whether what arrives now needs the person's yes first.
    fn needs_confirming(&self) -> bool {
        self.page_running.load(Ordering::SeqCst)
    }

    fn keep(&self, paths: Vec<PathBuf>) -> bool {
        let mut added = false;
        for path in paths {
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
        self.page_running.store(true, Ordering::SeqCst);
        let vault = lock(&self.vault).take();
        if let Some(vault) = &vault {
            crate::vault_access::get().allow(vault);
        }
        let mut files = lock(&self.files);
        let (files, waiting) = if can_import {
            let files = std::mem::take(&mut *files);
            crate::import::picked().allow_files(&files);
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

/// Notes what a launch handed the app and tells the window, once the person
/// says yes when the page is already running.
pub fn receive(app: &tauri::AppHandle, paths: &[PathBuf], cwd: &Path) {
    let paths = resolve_all(paths, cwd);
    if paths.is_empty() {
        return;
    }
    if !get().needs_confirming() {
        keep_and_tell(app, paths);
        return;
    }
    let (message, button) = question(&paths);
    let handle = app.clone();
    app.dialog()
        .message(message)
        .title("Open in Netherstone")
        .buttons(MessageDialogButtons::OkCancelCustom(button.into(), "Cancel".into()))
        .show(move |yes| {
            if yes {
                keep_and_tell(&handle, paths);
            }
        });
}

fn keep_and_tell(app: &tauri::AppHandle, paths: Vec<PathBuf>) {
    if get().keep(paths)
        && let Err(error) = app.emit(EVENT, ())
    {
        eprintln!("[Netherstone] Couldn't tell the window about opened files: {}", error);
    }
}

/// The question for opening `paths`, and the button that says yes. Only the
/// last folder opens, as in `keep`.
fn question(paths: &[PathBuf]) -> (String, &'static str) {
    let folder = paths.iter().rev().find(|path| path.is_dir()).map(|path| name(path));
    let files: Vec<String> = paths.iter().filter(|path| !path.is_dir()).map(|path| name(path)).collect();
    match (folder, files.is_empty()) {
        (Some(folder), true) => (format!("Open {folder} as a vault?"), "Open"),
        (Some(folder), false) => (format!("Open {folder} as a vault and import {}?", names(&files)), "Open"),
        (None, _) => (format!("Import {}?", names(&files)), "Import"),
    }
}

/// `Report.md`, `Report.md and Plan.docx`, or `3 files`.
fn names(names: &[String]) -> String {
    match names {
        [one] => one.clone(),
        [first, second] => format!("{first} and {second}"),
        _ => format!("{} files", names.len()),
    }
}

fn resolve_all(paths: &[PathBuf], cwd: &Path) -> Vec<PathBuf> {
    paths.iter().filter_map(|path| resolve(path, cwd)).collect()
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

    #[test]
    fn asks_once_the_page_runs() {
        let launches = Launches::new();
        assert!(!launches.needs_confirming());
        launches.take(false);
        assert!(launches.needs_confirming());
    }

    #[test]
    fn asks_about_what_came_in() {
        let dir = temp_dir("launch-question");
        let folder = dir.join("Notes");
        std::fs::create_dir_all(&folder).unwrap();
        let files: Vec<PathBuf> = ["Report.md", "Plan.docx", "Scan.pdf"].iter().map(|name| dir.join(name)).collect();
        for file in &files {
            std::fs::write(file, b"x").unwrap();
        }

        assert_eq!(question(&[folder.clone()]), ("Open Notes as a vault?".into(), "Open"));
        assert_eq!(question(&files[..1]), ("Import Report.md?".into(), "Import"));
        assert_eq!(question(&files[..2]), ("Import Report.md and Plan.docx?".into(), "Import"));
        assert_eq!(
            question(&[folder, files[0].clone(), files[1].clone(), files[2].clone()]),
            ("Open Notes as a vault and import 3 files?".into(), "Open")
        );
    }
}
