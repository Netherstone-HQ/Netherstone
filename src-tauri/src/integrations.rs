//! Netherstone in the rest of the system: the Open with entry for the files
//! it imports, "Open as Netherstone vault" on folders, and the `netherstone`
//! terminal command. Each part is on until the user turns it off in Settings,
//! and launch puts back any that went missing.
//!
//! Windows keeps each one in the user's registry, so the app writes and
//! removes them itself (and the uninstaller removes what's left). macOS lists
//! the app in Open With from its Info.plist, and its terminal command is a
//! script in /usr/local/bin. Linux gets all three from its package. A part
//! the system decides for itself is `None` here, and Settings doesn't show it.
//!
//! Everything written is fixed here; the window only says on or off.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

/// Beside the app's database: the parts the user turned off, one a line, so
/// launch leaves them off.
const TURNED_OFF: &str = "integrations-off.txt";

/// Which parts are on. `None`: not something the app switches here.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Integrations {
    pub open_with: Option<bool>,
    pub folder_menu: Option<bool>,
    pub terminal: Option<bool>,
}

impl Integrations {
    fn of(&self, integration: Integration) -> Option<bool> {
        match integration {
            Integration::OpenWith => self.open_with,
            Integration::FolderMenu => self.folder_menu,
            Integration::Terminal => self.terminal,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Integration {
    OpenWith,
    FolderMenu,
    Terminal,
}

impl Integration {
    const ALL: [Self; 3] = [Self::OpenWith, Self::FolderMenu, Self::Terminal];

    fn name(self) -> &'static str {
        match self {
            Self::OpenWith => "openWith",
            Self::FolderMenu => "folderMenu",
            Self::Terminal => "terminal",
        }
    }
}

#[tauri::command(async)]
pub fn integrations_get(_app: tauri::AppHandle) -> Integrations {
    #[cfg(windows)]
    return windows::get();
    #[cfg(target_os = "macos")]
    return Integrations {
        terminal: Some(macos::terminal_on(&_app)),
        ..Default::default()
    };
    #[cfg(not(any(windows, target_os = "macos")))]
    Integrations::default()
}

#[tauri::command(async)]
pub fn integrations_set(
    app: tauri::AppHandle,
    integration: Integration,
    on: bool,
) -> Result<(), String> {
    remember(&turned_off_path()?, integration, on)?;
    set(&app, integration, on)
}

/// Turns on, without asking anything, each part the user hasn't turned off.
/// Release builds only: a dev build would point them at itself.
pub fn turn_on_defaults(app: &tauri::AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }
    let turned_off = match turned_off_path() {
        Ok(path) => turned_off(&path),
        Err(error) => {
            eprintln!("[Netherstone] Couldn't read which integrations are off: {error}");
            return;
        }
    };
    let now = integrations_get(app.clone());
    for integration in to_turn_on(&now, &turned_off) {
        if !quiet() {
            continue;
        }
        if let Err(error) = set(app, integration, true) {
            eprintln!(
                "[Netherstone] Couldn't turn on {}: {error}",
                integration.name()
            );
        }
    }
}

/// The parts the system offers that are off and that the user didn't turn off.
fn to_turn_on(now: &Integrations, turned_off: &[Integration]) -> Vec<Integration> {
    Integration::ALL
        .into_iter()
        .filter(|integration| now.of(*integration) == Some(false))
        .filter(|integration| !turned_off.contains(integration))
        .collect()
}

/// Whether turning a part on asks the user nothing. Only an administrator
/// can add the macOS command when the user can't write its folder.
fn quiet() -> bool {
    #[cfg(target_os = "macos")]
    return macos::user_can_write();
    #[cfg(not(target_os = "macos"))]
    true
}

fn set(_app: &tauri::AppHandle, integration: Integration, on: bool) -> Result<(), String> {
    #[cfg(windows)]
    return windows::set(integration, on);
    #[cfg(target_os = "macos")]
    return match integration {
        Integration::Terminal => macos::set_terminal(_app, on),
        _ => Err("macOS lists Netherstone in Open With itself".to_string()),
    };
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = (integration, on);
        Err("The Netherstone package sets these up on Linux".to_string())
    }
}

fn turned_off_path() -> Result<PathBuf, String> {
    Ok(crate::db::get_db_path()?.with_file_name(TURNED_OFF))
}

/// What the user turned off. Nothing yet when the file isn't there.
fn turned_off(path: &Path) -> Vec<Integration> {
    let text = std::fs::read_to_string(path).unwrap_or_default();
    Integration::ALL
        .into_iter()
        .filter(|integration| text.lines().any(|line| line.trim() == integration.name()))
        .collect()
}

/// Keeps the user's choice, so launch doesn't turn back on what they turned off.
fn remember(path: &Path, integration: Integration, on: bool) -> Result<(), String> {
    let mut off = turned_off(path);
    off.retain(|kept| *kept != integration);
    if !on {
        off.push(integration);
    }
    let text: String = off
        .iter()
        .map(|integration| format!("{}\n", integration.name()))
        .collect();
    std::fs::write(path, text).map_err(|e| format!("Couldn't save the integrations: {e}"))
}

#[cfg(windows)]
mod windows {
    use super::{Integration, Integrations};
    use std::path::PathBuf;
    use windows_registry::{CURRENT_USER, Key, Type};

    const CLASSES: &str = r"Software\Classes";
    /// The class Open with lists, never set as any type's default.
    const PROG_ID: &str = "Netherstone.Import";
    const EXTENSIONS: &[&str] = &["md", "txt", "pdf", "docx", "html"];
    /// A folder's menu, and the menu of the empty space inside one.
    const FOLDER_MENUS: &[&str] = &["Directory", r"Directory\Background"];
    const FOLDER_VERB: &str = "Netherstone";
    const ENVIRONMENT: &str = "Environment";
    /// Next to the app, holding only `netherstone.cmd`, so nothing else of
    /// the app becomes a command.
    const BIN: &str = "bin";

    fn exe() -> Result<PathBuf, String> {
        std::env::current_exe().map_err(|e| e.to_string())
    }

    fn command(argument: &str) -> Result<String, String> {
        Ok(format!("\"{}\" \"{argument}\"", exe()?.display()))
    }

    fn icon() -> Result<String, String> {
        Ok(format!("\"{}\",0", exe()?.display()))
    }

    fn application() -> Result<String, String> {
        let exe = exe()?;
        let name = exe
            .file_name()
            .ok_or("The app has no file name")?
            .to_string_lossy();
        Ok(format!(r"{CLASSES}\Applications\{name}"))
    }

    fn bin() -> Result<PathBuf, String> {
        Ok(exe()?.parent().ok_or("The app has no folder")?.join(BIN))
    }

    /// The value at `path`, if the key and value are there.
    fn read(path: &str, name: &str) -> Option<String> {
        CURRENT_USER
            .open(path)
            .and_then(|key| key.get_string(name))
            .ok()
    }

    fn create(path: &str) -> Result<Key, String> {
        CURRENT_USER.create(path).map_err(|e| e.to_string())
    }

    fn write(key: &Key, name: &str, value: &str) -> Result<(), String> {
        key.set_string(name, value).map_err(|e| e.to_string())
    }

    /// Removes the key at `path`, which may already be gone.
    fn remove(path: &str) {
        let _ = CURRENT_USER.remove_tree(path);
    }

    pub fn get() -> Integrations {
        let open_with = command("%1").ok().zip(read(
            &format!(r"{CLASSES}\{PROG_ID}\shell\open\command"),
            "",
        ));
        let folder = command("%V").ok().zip(read(
            &format!(r"{CLASSES}\Directory\shell\{FOLDER_VERB}\command"),
            "",
        ));
        Integrations {
            open_with: Some(open_with.is_some_and(|(ours, found)| ours == found)),
            folder_menu: Some(folder.is_some_and(|(ours, found)| ours == found)),
            // Dev builds have no bin folder to put on the PATH.
            terminal: bin()
                .ok()
                .filter(|bin| bin.is_dir())
                .map(|bin| path_entries().contains(&text(&bin))),
        }
    }

    pub fn set(integration: Integration, on: bool) -> Result<(), String> {
        match integration {
            Integration::OpenWith => set_open_with(on)?,
            Integration::FolderMenu => set_folder_menu(on)?,
            Integration::Terminal => return set_terminal(on),
        }
        notify_shell();
        Ok(())
    }

    fn set_open_with(on: bool) -> Result<(), String> {
        let application = application()?;
        if !on {
            for extension in EXTENSIONS {
                if let Ok(key) =
                    CURRENT_USER.open(format!(r"{CLASSES}\.{extension}\OpenWithProgids"))
                {
                    let _ = key.remove_value(PROG_ID);
                }
            }
            remove(&format!(r"{CLASSES}\{PROG_ID}"));
            remove(&application);
            return Ok(());
        }
        write(
            &create(&format!(r"{CLASSES}\{PROG_ID}"))?,
            "",
            "Netherstone",
        )?;
        write(
            &create(&format!(r"{CLASSES}\{PROG_ID}\DefaultIcon"))?,
            "",
            &icon()?,
        )?;
        write(
            &create(&format!(r"{CLASSES}\{PROG_ID}\shell\open\command"))?,
            "",
            &command("%1")?,
        )?;
        write(&create(&application)?, "FriendlyAppName", "Netherstone")?;
        write(
            &create(&format!(r"{application}\shell\open\command"))?,
            "",
            &command("%1")?,
        )?;
        let supported = create(&format!(r"{application}\SupportedTypes"))?;
        for extension in EXTENSIONS {
            write(&supported, &format!(".{extension}"), "")?;
            write(
                &create(&format!(r"{CLASSES}\.{extension}\OpenWithProgids"))?,
                PROG_ID,
                "",
            )?;
        }
        Ok(())
    }

    fn set_folder_menu(on: bool) -> Result<(), String> {
        for menu in FOLDER_MENUS {
            let verb = format!(r"{CLASSES}\{menu}\shell\{FOLDER_VERB}");
            if !on {
                remove(&verb);
                continue;
            }
            let key = create(&verb)?;
            write(&key, "", "Open as Netherstone vault")?;
            write(&key, "Icon", &icon()?)?;
            write(&create(&format!(r"{verb}\command"))?, "", &command("%V")?)?;
        }
        Ok(())
    }

    fn text(path: &std::path::Path) -> String {
        path.to_string_lossy().into_owned()
    }

    /// The user's PATH as written, `%VAR%` entries left as they are, or
    /// `None` when there is none. A PATH that's there but can't be read is an
    /// error, so it's never written back as if it were empty.
    fn path_value() -> Result<Option<(Type, String)>, String> {
        let Some(key) = found(CURRENT_USER.open(ENVIRONMENT))? else {
            return Ok(None);
        };
        let Some(kind) = found(key.get_type("Path"))? else {
            return Ok(None);
        };
        let value = key.get_hstring("Path").map_err(unreadable)?;
        let value = String::from_utf16(&value)
            .map_err(|_| "Couldn't read your PATH: it isn't valid text".to_string())?;
        Ok(Some((kind, value)))
    }

    /// `None` for a key or value that isn't there, an error for any other
    /// failure.
    fn found<T>(result: windows_registry::Result<T>) -> Result<Option<T>, String> {
        use ::windows::Win32::Foundation::ERROR_FILE_NOT_FOUND;
        match result {
            Ok(value) => Ok(Some(value)),
            Err(error) if error.code().0 == ERROR_FILE_NOT_FOUND.to_hresult().0 => Ok(None),
            Err(error) => Err(unreadable(error)),
        }
    }

    fn unreadable(error: impl std::fmt::Display) -> String {
        format!("Couldn't read your PATH: {error}")
    }

    fn entries(value: &str) -> Vec<String> {
        value
            .split(';')
            .filter(|entry| !entry.is_empty())
            .map(str::to_string)
            .collect()
    }

    fn path_entries() -> Vec<String> {
        match path_value() {
            Ok(value) => value.map(|(_, value)| entries(&value)).unwrap_or_default(),
            Err(_) => Vec::new(),
        }
    }

    fn set_terminal(on: bool) -> Result<(), String> {
        let bin = text(&bin()?);
        let (kind, value) = path_value()?.unwrap_or((Type::ExpandString, String::new()));
        let mut entries: Vec<String> = entries(&value)
            .into_iter()
            .filter(|entry| !entry.eq_ignore_ascii_case(&bin))
            .collect();
        if on {
            entries.push(bin);
        }
        let key = create(ENVIRONMENT)?;
        let value = entries.join(";");
        match kind {
            Type::String => key.set_string("Path", &value),
            _ => key.set_expand_string("Path", &value),
        }
        .map_err(|e| e.to_string())?;
        environment_changed();
        Ok(())
    }

    /// Tells Explorer and new terminals about the change, without a sign-in.
    fn environment_changed() {
        use ::windows::Win32::Foundation::{LPARAM, WPARAM};
        use ::windows::Win32::UI::WindowsAndMessaging::{
            HWND_BROADCAST, SMTO_ABORTIFHUNG, SendMessageTimeoutW, WM_SETTINGCHANGE,
        };
        let name: Vec<u16> = "Environment\0".encode_utf16().collect();
        // Windows' own wait for a window that doesn't answer.
        const TIMEOUT_MS: u32 = 5000;
        unsafe {
            SendMessageTimeoutW(
                HWND_BROADCAST,
                WM_SETTINGCHANGE,
                WPARAM(0),
                LPARAM(name.as_ptr() as isize),
                SMTO_ABORTIFHUNG,
                TIMEOUT_MS,
                None,
            );
        }
    }

    fn notify_shell() {
        use ::windows::Win32::UI::Shell::{SHCNE_ASSOCCHANGED, SHCNF_IDLIST, SHChangeNotify};
        unsafe { SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None) };
    }
}

#[cfg(target_os = "macos")]
mod macos {
    //! A two-line script in /usr/local/bin that hands its arguments to the
    //! app through `open`, by the app's id, so it keeps working when the app
    //! moves. Only a script that is ours is ever removed.
    //!
    //! Where the user can write /usr/local/bin (Homebrew on Intel Macs), the
    //! script is written as the user, with no password. Otherwise the folder
    //! belongs to root, and only then is an administrator asked. Either way it
    //! goes to a new file first and is renamed over the command, so a link
    //! someone left there is replaced, never written through.

    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;
    use std::path::Path;

    const FOLDER: &str = "/usr/local/bin";
    const PATH: &str = "/usr/local/bin/netherstone";
    /// Readable and runnable by everyone, writable by the owner.
    const MODE: u32 = 0o755;

    fn script(app: &tauri::AppHandle) -> String {
        format!(
            "#!/bin/sh\nexec open -b {} \"$@\"\n",
            app.config().identifier
        )
    }

    pub fn terminal_on(app: &tauri::AppHandle) -> bool {
        std::fs::read_to_string(PATH).is_ok_and(|text| text == script(app))
    }

    pub fn set_terminal(app: &tauri::AppHandle, on: bool) -> Result<(), String> {
        if !on && !terminal_on(app) {
            return Ok(());
        }
        match (user_can_write(), on) {
            (true, true) => write_as_user(&script(app)).map_err(|e| e.to_string()),
            (true, false) => std::fs::remove_file(PATH).map_err(|e| e.to_string()),
            (false, _) => as_administrator(&script(app), on),
        }
    }

    /// Whether the user can write the folder, or make it when it isn't there.
    pub fn user_can_write() -> bool {
        let folder = Path::new(FOLDER);
        let existing = if folder.is_dir() {
            Some(folder)
        } else {
            folder.parent()
        };
        existing
            .and_then(|folder| tempfile_in(folder).ok())
            .is_some_and(|probe| std::fs::remove_file(probe).is_ok())
    }

    /// A new empty file in `folder`. `create_new` fails on anything already
    /// there, a link included.
    fn tempfile_in(folder: &Path) -> std::io::Result<std::path::PathBuf> {
        let path = folder.join(format!(".netherstone-{}", std::process::id()));
        std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;
        Ok(path)
    }

    fn write_as_user(script: &str) -> std::io::Result<()> {
        std::fs::create_dir_all(FOLDER)?;
        let temp = tempfile_in(Path::new(FOLDER))?;
        let written = (|| {
            let mut file = std::fs::OpenOptions::new().write(true).open(&temp)?;
            file.write_all(script.as_bytes())?;
            std::fs::set_permissions(&temp, std::fs::Permissions::from_mode(MODE))?;
            std::fs::rename(&temp, PATH)
        })();
        if written.is_err() {
            let _ = std::fs::remove_file(&temp);
        }
        written
    }

    /// Writes or removes the script as root, after the system asks for an
    /// administrator's password.
    fn as_administrator(script: &str, on: bool) -> Result<(), String> {
        let shell = if on {
            let lines = script
                .lines()
                .map(|line| format!("'{}'", line.replace('\'', r"'\''")))
                .collect::<Vec<_>>()
                .join(" ");
            format!(
                "mkdir -p {FOLDER} && t=$(mktemp {FOLDER}/.netherstone.XXXXXX) && printf '%s\\n' {lines} > \"$t\" && chmod {MODE:o} \"$t\" && mv -f \"$t\" {PATH}"
            )
        } else {
            format!("rm -f {PATH}")
        };
        let apple_script = format!(
            "do shell script \"{}\" with administrator privileges",
            shell.replace('\\', "\\\\").replace('"', "\\\"")
        );
        let output = std::process::Command::new("osascript")
            .args(["-e", &apple_script])
            .output()
            .map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn all_off() -> Integrations {
        Integrations {
            open_with: Some(false),
            folder_menu: Some(false),
            terminal: Some(false),
        }
    }

    fn file(name: &str) -> PathBuf {
        crate::sync::state::tests::temp_dir(name).join(TURNED_OFF)
    }

    #[test]
    fn turns_on_every_part_nobody_turned_off() {
        assert_eq!(to_turn_on(&all_off(), &[]), Integration::ALL);
    }

    #[test]
    fn leaves_off_what_the_user_turned_off() {
        assert_eq!(
            to_turn_on(&all_off(), &[Integration::Terminal]),
            [Integration::OpenWith, Integration::FolderMenu]
        );
    }

    #[test]
    fn skips_parts_already_on_or_not_offered() {
        let now = Integrations {
            open_with: Some(true),
            folder_menu: None,
            terminal: Some(false),
        };
        assert_eq!(to_turn_on(&now, &[]), [Integration::Terminal]);
    }

    #[test]
    fn nothing_is_turned_off_before_the_first_choice() {
        assert!(turned_off(&file("integrations-none")).is_empty());
    }

    #[test]
    fn remembers_turning_off_and_back_on() {
        let path = file("integrations-choices");
        remember(&path, Integration::Terminal, false).unwrap();
        remember(&path, Integration::OpenWith, false).unwrap();
        assert_eq!(
            turned_off(&path),
            [Integration::OpenWith, Integration::Terminal]
        );
        remember(&path, Integration::Terminal, true).unwrap();
        assert_eq!(turned_off(&path), [Integration::OpenWith]);
    }
}
