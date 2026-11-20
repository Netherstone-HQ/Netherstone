//! Throwaway spike: runs public/mic-spike.html when NETHERSTONE_MIC_SPIKE is
//! set, and writes what it records and reports to that folder.

use tauri::{Runtime, Webview};

fn out_dir() -> Option<std::path::PathBuf> {
    std::env::var_os("NETHERSTONE_MIC_SPIKE").map(Into::into)
}

pub fn redirect<R: Runtime>(view: &Webview<R>) {
    if out_dir().is_none() || view.label() != "main" {
        return;
    }
    let seconds = std::env::var("NETHERSTONE_MIC_SPIKE_SECONDS").unwrap_or_else(|_| "60".into());
    let script = format!(
        "if (!location.pathname.includes('mic-spike')) location.replace('/mic-spike.html?seconds={seconds}')"
    );
    let _ = view.eval(script);
}

#[tauri::command]
pub async fn spike_save(app: tauri::AppHandle, name: String, bytes: Vec<u8>, last: bool) -> Result<String, String> {
    let dir = out_dir().ok_or("spike off")?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let safe: String = name.chars().filter(|c| c.is_ascii_alphanumeric() || ".-_".contains(*c)).collect();
    let path = dir.join(safe);
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    {
        use tauri::Manager;
        let _ = app.asset_protocol_scope().allow_file(&path);
    }
    if last {
        app.exit(0);
    }
    Ok(path.display().to_string())
}
