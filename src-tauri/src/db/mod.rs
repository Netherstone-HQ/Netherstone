pub mod ast_cache;
pub mod attachments;
pub mod indexer;
pub mod parser;
pub mod queries;
mod schema;

use rusqlite::{Connection, Result};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

pub use schema::init_schema;

/// Returns the path to the Netherstone database file in the OS's data directory.
///
/// Platform-specific locations:
/// - Windows: `%APPDATA%\com.netherstone.app\netherstone.db`
/// - macOS: `~/Library/Application Support/com.netherstone.app/netherstone.db`
/// - Linux: `~/.local/share/com.netherstone.app/netherstone.db`
pub fn get_db_path() -> Result<PathBuf, String> {
    let app_dir = dirs::data_dir()
        .ok_or_else(|| "Failed to determine AppData directory".to_string())?
        .join("com.netherstone.app");

    std::fs::create_dir_all(&app_dir)
        .map_err(|e| format!("Failed to create app directory: {}", e))?;

    Ok(app_dir.join("netherstone.db"))
}

/// Set once the schema and journal mode have been initialized for this process.
static SCHEMA_READY: Mutex<bool> = Mutex::new(false);

/// How long a connection waits for another connection's write lock before
/// failing. Commands run concurrently off the main thread, so short waits are
/// expected (e.g. an autosave landing during vault indexing).
const BUSY_TIMEOUT: Duration = Duration::from_secs(10);

/// Opens a connection to the Netherstone database.
///
/// Creates the database file and initializes the schema on the first call in
/// this process; later calls only apply per-connection settings.
pub fn open_connection() -> Result<Connection, String> {
    let db_path = get_db_path()?;

    let conn = Connection::open(&db_path).map_err(|e| format!("Failed to open database: {}", e))?;

    conn.busy_timeout(BUSY_TIMEOUT)
        .map_err(|e| format!("Failed to set database busy timeout: {}", e))?;

    // Enable foreign key constraints, and skip an fsync per write: with WAL
    // this stays crash-safe for the database file (it's only a rebuildable
    // index, not the source of truth).
    conn.execute_batch("PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;")
        .map_err(|e| format!("Failed to configure database connection: {}", e))?;

    let mut schema_ready = SCHEMA_READY
        .lock()
        .map_err(|e| format!("Failed to lock database init state: {}", e))?;

    if !*schema_ready {
        // WAL lets readers proceed while a write (e.g. indexing) is in progress.
        // The mode is persisted in the database file.
        conn.query_row("PRAGMA journal_mode = WAL", [], |_| Ok(()))
            .map_err(|e| format!("Failed to enable WAL journal mode: {}", e))?;

        init_schema(&conn).map_err(|e| format!("Failed to initialize schema: {}", e))?;
        *schema_ready = true;
    }

    Ok(conn)
}

/// Database connection wrapper that can be managed by Tauri state.
pub struct Database {
    conn: std::sync::Mutex<Connection>,
}

impl Database {
    /// Create a new database instance with an initialized connection.
    pub fn new() -> Result<Self, String> {
        let conn = open_connection()?;
        Ok(Self {
            conn: std::sync::Mutex::new(conn),
        })
    }

    /// Execute a closure with access to the database connection.
    pub fn with_connection<F, T>(&self, f: F) -> Result<T, String>
    where
        F: FnOnce(&Connection) -> Result<T, rusqlite::Error>,
    {
        let conn = self
            .conn
            .lock()
            .map_err(|e| format!("Failed to lock database: {}", e))?;

        f(&conn).map_err(|e| format!("Database error: {}", e))
    }
}
