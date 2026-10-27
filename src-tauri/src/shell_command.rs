//! The `netherstone` terminal command on macOS, which Settings installs: a
//! two-line script in /usr/local/bin that hands its arguments to the app
//! through `open`, by the app's id, so it keeps working when the app moves.
//! Windows and Linux get theirs from the installer.
//!
//! The script is written here, never by the window, and only a script that is
//! ours is ever removed.

#[cfg(target_os = "macos")]
const PATH: &str = "/usr/local/bin/netherstone";

#[cfg(target_os = "macos")]
fn script(app: &tauri::AppHandle) -> String {
    format!("#!/bin/sh\nexec open -b {} \"$@\"\n", app.config().identifier)
}

/// Whether the terminal command is installed.
#[tauri::command(async)]
pub fn shell_command_installed(_app: tauri::AppHandle) -> bool {
    #[cfg(target_os = "macos")]
    return std::fs::read_to_string(PATH).is_ok_and(|text| text == script(&_app));
    #[cfg(not(target_os = "macos"))]
    false
}

/// Installs or removes the terminal command, after the system asks for an
/// administrator's password.
#[tauri::command(async)]
pub fn set_shell_command(_app: tauri::AppHandle, _install: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        let shell = if _install {
            let lines = script(&_app)
                .lines()
                .map(|line| format!("'{}'", line.replace('\'', r"'\''")))
                .collect::<Vec<_>>()
                .join(" ");
            format!("mkdir -p /usr/local/bin && printf '%s\\n' {lines} > {PATH} && chmod 755 {PATH}")
        } else {
            if !shell_command_installed(_app.clone()) {
                return Err(format!("{PATH} isn't Netherstone's"));
            }
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
    #[cfg(not(target_os = "macos"))]
    Err("The installer adds the terminal command on this system".to_string())
}
