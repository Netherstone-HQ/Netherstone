//! Settings commands for AI apps that use the vault over MCP.

use crate::{ai_apps, db};
use std::path::Path;

/// Whether AI apps may use the vault through the MCP server.
#[tauri::command(async)]
pub(crate) fn mcp_get_enabled() -> Result<bool, String> {
    db::settings::mcp_enabled(&db::open_connection()?).map_err(|e| e.to_string())
}

/// Lets AI apps use the vault through the MCP server, or stops them. A
/// server already running sees the change on its next call.
#[tauri::command(async)]
pub(crate) fn mcp_set_enabled(enabled: bool) -> Result<(), String> {
    db::settings::set_mcp_enabled(&db::open_connection()?, enabled).map_err(|e| e.to_string())
}

#[derive(serde::Serialize)]
pub(crate) struct McpVault {
    path: String,
    name: String,
    allowed: bool,
}

/// Every vault the app has opened, the most recent first, with whether AI
/// apps may use it.
#[tauri::command(async)]
pub(crate) fn mcp_vaults() -> Result<Vec<McpVault>, String> {
    let conn = db::open_connection()?;
    let vaults = db::settings::known_vaults(&conn, false, 0, None).map_err(|e| e.to_string())?;
    Ok(vaults
        .into_iter()
        .map(|vault| McpVault {
            name: vault.name(),
            path: vault.path.to_string_lossy().into_owned(),
            allowed: vault.ai_allowed,
        })
        .collect())
}

/// Lets AI apps use a vault the app has opened, or stops them.
#[tauri::command(async)]
pub(crate) fn mcp_set_vault_allowed(path: String, allowed: bool) -> Result<(), String> {
    let conn = db::open_connection()?;
    match db::settings::set_vault_ai_allowed(&conn, Path::new(&path), allowed) {
        Ok(true) => Ok(()),
        Ok(false) => Err("Netherstone hasn't opened that vault".to_string()),
        Err(error) => Err(error.to_string()),
    }
}

/// The AI apps Settings can connect, and which are installed and connected.
#[tauri::command(async)]
pub(crate) fn ai_apps() -> Result<Vec<ai_apps::AppStatus>, String> {
    ai_apps::statuses()
}

/// Sets up the AI app `id` to start the MCP server.
#[tauri::command(async)]
pub(crate) fn ai_app_connect(id: String) -> Result<(), String> {
    ai_apps::connect(&id)
}

/// The MCP server setup to paste into any other AI app.
#[tauri::command(async)]
pub(crate) fn mcp_setup() -> Result<String, String> {
    ai_apps::setup_snippet()
}
