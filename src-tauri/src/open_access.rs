//! Opening a file a shard links to in the app the computer uses for it.
//! Programs, scripts and shortcuts are never opened, so a shard from someone
//! else, or a script that got into the page, can't start one.

use std::path::Path;

use crate::db::attachments::extension_for_path;

/// Files that run something when opened, on Windows, macOS or Linux.
const PROGRAM_EXTENSIONS: &[&str] = &[
    // Windows
    "exe", "com", "bat", "cmd", "msi", "msp", "mst", "scr", "pif", "cpl", "lnk", "url", "reg",
    "vbs", "vbe", "js", "jse", "ws", "wsf", "wsc", "wsh", "ps1", "psm1", "psd1", "hta", "msc",
    "scf", "inf", "chm", "dll", "sys", "gadget", "application", "appref-ms", "appx", "appxbundle",
    "msix", "msixbundle", "library-ms", "settingcontent-ms", "diagcab", "xll",
    // macOS
    "app", "command", "tool", "terminal", "workflow", "action", "pkg", "mpkg", "scpt", "scptd",
    "applescript", "osax", "prefpane", "webloc", "inetloc", "fileloc",
    // Linux
    "desktop", "sh", "bash", "zsh", "csh", "ksh", "fish", "run", "bin", "appimage", "deb", "rpm",
    "flatpakref", "snap",
    // Anywhere an interpreter is installed
    "jar", "py", "pyw", "pl", "rb",
];

/// Checks that `path` is a file that may be opened: not a folder, and not a
/// program, script or shortcut.
pub fn check(path: &Path) -> Result<(), String> {
    let metadata =
        std::fs::metadata(path).map_err(|_| format!("{} isn't there", path.display()))?;
    if !metadata.is_file() {
        return Err(format!("{} isn't a file", path.display()));
    }
    if is_program(path, &metadata) {
        return Err(format!("Netherstone doesn't open programs: {}", path.display()));
    }
    Ok(())
}

fn is_program(path: &Path, metadata: &std::fs::Metadata) -> bool {
    let extension = extension_for_path(path);
    if PROGRAM_EXTENSIONS.contains(&extension.as_str()) {
        return true;
    }
    // A file with no extension that may run opens as a program on macOS
    // and Linux. One with an extension opens by its type.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if extension.is_empty() && metadata.permissions().mode() & 0o111 != 0 {
            return true;
        }
    }
    #[cfg(not(unix))]
    let _ = metadata;
    false
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::state::tests::temp_dir;

    #[test]
    fn documents_open_and_programs_dont() {
        let dir = temp_dir("open-access");
        std::fs::create_dir_all(dir.join("Tool.app")).unwrap();
        for name in ["report.pdf", "photo.PNG", "notes.txt", "sheet.xlsx", "run.exe", "a.LNK", "x.desktop", "y.command", "z.js"] {
            std::fs::write(dir.join(name), b"x").unwrap();
        }

        for name in ["report.pdf", "photo.PNG", "notes.txt", "sheet.xlsx"] {
            assert!(check(&dir.join(name)).is_ok(), "{name}");
        }
        for name in ["run.exe", "a.LNK", "x.desktop", "y.command", "z.js", "Tool.app", "missing.pdf"] {
            assert!(check(&dir.join(name)).is_err(), "{name}");
        }
    }

    #[cfg(unix)]
    #[test]
    fn files_that_may_run_open_only_by_their_type() {
        use std::os::unix::fs::PermissionsExt;
        let dir = temp_dir("open-access-mode");
        for name in ["tool", "report.pdf"] {
            let path = dir.join(name);
            std::fs::write(&path, b"x").unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        std::fs::write(dir.join("README"), b"x").unwrap();

        assert!(check(&dir.join("tool")).is_err());
        assert!(check(&dir.join("report.pdf")).is_ok());
        assert!(check(&dir.join("README")).is_ok());
    }
}
