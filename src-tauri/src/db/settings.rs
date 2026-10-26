//! Settings every Netherstone process on this device reads: the app writes
//! them, and the MCP server (`Netherstone mcp`), which runs without the app,
//! reads them from the same database.

use rusqlite::{Connection, OptionalExtension, params};
use std::path::PathBuf;

/// The vault the app opened last, which the MCP server works on.
const LAST_VAULT: &str = "last_vault";
/// Whether AI apps may use the vault through the MCP server. Off unless
/// turned on in Settings.
const MCP_ENABLED: &str = "mcp_enabled";

fn get(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", params![key], |row| row.get(0))
        .optional()
}

fn set(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .map(|_| ())
}

pub fn last_vault(conn: &Connection) -> rusqlite::Result<Option<PathBuf>> {
    Ok(get(conn, LAST_VAULT)?.map(PathBuf::from))
}

pub fn set_last_vault(conn: &Connection, vault_path: &std::path::Path) -> rusqlite::Result<()> {
    set(conn, LAST_VAULT, &vault_path.to_string_lossy())
}

pub fn mcp_enabled(conn: &Connection) -> rusqlite::Result<bool> {
    Ok(get(conn, MCP_ENABLED)?.as_deref() == Some("1"))
}

pub fn set_mcp_enabled(conn: &Connection, enabled: bool) -> rusqlite::Result<()> {
    set(conn, MCP_ENABLED, if enabled { "1" } else { "0" })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_start_empty_and_keep_the_last_value() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_schema(&conn).unwrap();

        assert_eq!(last_vault(&conn).unwrap(), None);
        assert!(!mcp_enabled(&conn).unwrap());

        set_last_vault(&conn, std::path::Path::new("/v/One")).unwrap();
        set_last_vault(&conn, std::path::Path::new("/v/Two")).unwrap();
        set_mcp_enabled(&conn, true).unwrap();
        assert_eq!(last_vault(&conn).unwrap(), Some(PathBuf::from("/v/Two")));
        assert!(mcp_enabled(&conn).unwrap());
    }
}
