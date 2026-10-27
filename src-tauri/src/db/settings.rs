//! Settings every Netherstone process on this device reads: the app writes
//! them, and the MCP server (`Netherstone mcp`), which runs without the app,
//! reads them from the same database. They include the vaults the app has
//! opened, and which of them AI apps may use.

use rusqlite::{Connection, OptionalExtension, Row, params};
use std::path::{Path, PathBuf};

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

pub fn mcp_enabled(conn: &Connection) -> rusqlite::Result<bool> {
    Ok(get(conn, MCP_ENABLED)?.as_deref() == Some("1"))
}

pub fn set_mcp_enabled(conn: &Connection, enabled: bool) -> rusqlite::Result<()> {
    set(conn, MCP_ENABLED, if enabled { "1" } else { "0" })
}

// ── Vaults ───────────────────────────────────────────────────────────────────

/// A vault the app has opened on this device.
#[derive(Debug, Clone, PartialEq)]
pub struct KnownVault {
    pub path: PathBuf,
    /// Whether AI apps may use it. Off until it's picked in Settings.
    pub ai_allowed: bool,
    /// The drive it was on when last opened (`gone_vaults::drive_of`).
    pub drive: Option<u64>,
}

impl KnownVault {
    /// The vault's name, its folder's.
    pub fn name(&self) -> String {
        self.path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| self.path.to_string_lossy().into_owned())
    }

    fn from_row(row: &Row) -> rusqlite::Result<Self> {
        Ok(Self {
            path: PathBuf::from(row.get::<_, String>(0)?),
            ai_allowed: row.get(1)?,
            drive: row.get::<_, Option<i64>>(2)?.map(|drive| drive as u64),
        })
    }
}

/// Keeps `vault_path`, on `drive`, as the vault opened most recently.
pub fn record_opened_vault(conn: &Connection, vault_path: &Path, drive: Option<u64>) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT INTO vaults (path, open_order, drive)
         VALUES (?1, (SELECT COALESCE(MAX(open_order), 0) + 1 FROM vaults), ?2)
         ON CONFLICT(path) DO UPDATE SET open_order = excluded.open_order, drive = excluded.drive",
        params![vault_path.to_string_lossy(), drive.map(|drive| drive as i64)],
    )
    .map(|_| ())
}

pub fn known_vault(conn: &Connection, vault_path: &Path) -> rusqlite::Result<Option<KnownVault>> {
    conn.query_row(
        "SELECT path, ai_allowed, drive FROM vaults WHERE path = ?1",
        params![vault_path.to_string_lossy()],
        KnownVault::from_row,
    )
    .optional()
}

/// The vaults the app has opened, the most recent first, from `offset`, all
/// of them or `limit`. Only the ones AI apps may use when `ai_allowed_only`.
pub fn known_vaults(
    conn: &Connection,
    ai_allowed_only: bool,
    offset: usize,
    limit: Option<usize>,
) -> rusqlite::Result<Vec<KnownVault>> {
    // SQLite reads a negative limit as none.
    let limit = limit.map_or(-1, |limit| limit as i64);
    let mut statement = conn.prepare_cached(
        "SELECT path, ai_allowed, drive FROM vaults WHERE ai_allowed = 1 OR ?1 = 0
         ORDER BY open_order DESC LIMIT ?2 OFFSET ?3",
    )?;
    statement
        .query_map(params![ai_allowed_only, limit, offset as i64], KnownVault::from_row)?
        .collect()
}

/// Forgets the vault at `vault_path`, once its folder is gone.
pub fn forget_vault(conn: &Connection, vault_path: &Path) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM vaults WHERE path = ?1", params![vault_path.to_string_lossy()])
        .map(|_| ())
}

/// Lets AI apps use the vault at `vault_path`, or stops them. False when
/// the app has never opened it.
pub fn set_vault_ai_allowed(conn: &Connection, vault_path: &Path, allowed: bool) -> rusqlite::Result<bool> {
    let changed = conn.execute(
        "UPDATE vaults SET ai_allowed = ?2 WHERE path = ?1",
        params![vault_path.to_string_lossy(), allowed],
    )?;
    Ok(changed > 0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_schema(&conn).unwrap();
        conn
    }

    #[test]
    fn ai_apps_stay_off_until_turned_on() {
        let conn = db();
        assert!(!mcp_enabled(&conn).unwrap());
        set_mcp_enabled(&conn, true).unwrap();
        assert!(mcp_enabled(&conn).unwrap());
    }

    #[test]
    fn vaults_are_kept_newest_first_and_allowed_one_by_one() {
        let conn = db();
        let (one, two) = (Path::new("/v/One"), Path::new("/v/Two"));
        assert!(known_vaults(&conn, false, 0, None).unwrap().is_empty());

        record_opened_vault(&conn, one, None).unwrap();
        record_opened_vault(&conn, two, Some(7)).unwrap();
        record_opened_vault(&conn, one, None).unwrap();
        let paths = |vaults: Vec<KnownVault>| vaults.into_iter().map(|v| v.path).collect::<Vec<_>>();
        assert_eq!(paths(known_vaults(&conn, false, 0, None).unwrap()), [one, two]);
        assert_eq!(paths(known_vaults(&conn, false, 1, Some(1)).unwrap()), [two]);
        assert_eq!(known_vaults(&conn, false, 0, Some(1)).unwrap()[0].name(), "One");

        assert!(known_vaults(&conn, true, 0, None).unwrap().is_empty());
        assert!(set_vault_ai_allowed(&conn, two, true).unwrap());
        assert!(!set_vault_ai_allowed(&conn, Path::new("/v/Never"), true).unwrap());
        assert_eq!(paths(known_vaults(&conn, true, 0, None).unwrap()), [two]);
        let two = known_vault(&conn, two).unwrap().unwrap();
        assert!(two.ai_allowed);
        assert_eq!(two.drive, Some(7));
        assert!(!known_vaults(&conn, false, 0, Some(1)).unwrap()[0].ai_allowed);
    }
}
