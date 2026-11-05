//! Which vaults AI may use, for the MCP server and the app's own assistant
//! alike: the ones picked in Settings, while that way in is switched on.
//! Each has its own switch: Connect your AI apps for AI apps, the
//! assistant's own for the assistant.

use crate::db::settings::{self, KnownVault};
use crate::tools::Vault;
use rusqlite::Connection;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Way {
    AiApps,
    Assistant,
}

/// Whether `way` is switched on.
pub fn is_on(conn: &Connection, way: Way) -> Result<bool, String> {
    match way {
        Way::AiApps => settings::mcp_enabled(conn),
        Way::Assistant => settings::assistant_enabled(conn),
    }
    .map_err(|e| e.to_string())
}

/// The vault at `path`, if it's one picked for AI.
pub fn picked(conn: &Connection, path: &Path) -> Result<Option<KnownVault>, String> {
    Ok(settings::known_vault(conn, path)
        .map_err(|e| e.to_string())?
        .filter(|vault| vault.ai_allowed))
}

/// `known`, ready for the tools, while its folder is still there.
pub fn open(known: KnownVault) -> Result<Vault, String> {
    if !known.path.is_dir() {
        return Err(format!(
            "The vault {} isn't at {} anymore",
            known.name(),
            known.path.display()
        ));
    }
    Ok(Vault::new(known.path, crate::sync::sync_root()?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_picked_vaults_while_their_way_is_on() {
        let dir = crate::sync::state::tests::temp_dir("ai-vaults");
        let conn = Connection::open(dir.join("db.sqlite")).unwrap();
        crate::db::init_schema(&conn).unwrap();
        let vault = dir.join("Vault");
        std::fs::create_dir_all(&vault).unwrap();
        settings::record_opened_vault(&conn, &vault, None).unwrap();

        assert!(picked(&conn, &vault).unwrap().is_none());
        settings::set_vault_ai_allowed(&conn, &vault, true).unwrap();
        assert!(picked(&conn, &vault).unwrap().is_some());
        assert!(picked(&conn, &dir.join("Other")).unwrap().is_none());

        // Each way has its own switch.
        settings::set_assistant_enabled(&conn, true).unwrap();
        assert!(is_on(&conn, Way::Assistant).unwrap());
        assert!(!is_on(&conn, Way::AiApps).unwrap());
    }
}
