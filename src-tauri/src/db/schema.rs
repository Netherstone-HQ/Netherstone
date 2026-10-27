use rusqlite::Connection;

/// SQL schema for the Netherstone knowledge base index.
///
/// Tables:
/// - `files`: Core metadata and editor stats for each markdown file, keyed by
///   its vault
/// - `links`: Indexed outbound links including mentions, internal links, and external URLs
/// - `tags`: Extracted hashtags from file content, each with the text around
///   its first appearance
/// - `attachments`: Managed vault asset metadata for `_attachments` files
/// - `attachment_references`: Saved markdown references to managed attachments
/// - `ast_cache_index`: Path-to-content index for the content-addressed AST cache
/// - `ast_cache_blobs`: Content-addressed AST payload store keyed by hash + version
/// - `charts`: The charts drawn from tables in each file
/// - `drawing_embeds`: The drawings each file shows
/// - `writing_log`: Words each shard started and ended a day with, from saves
///   in the editor on this device. Never synced.
/// - `writing_log_start`: The day this device started counting for each vault
/// - `settings`: What every Netherstone process on this device reads, like
///   whether AI apps may connect (see `settings.rs`)
/// - `vaults`: Every vault the app has opened on this device, in the order
///   it last opened them, and whether AI apps may use each (see `settings.rs`)
/// - `fts_search`: FTS5 virtual table for full-text search
pub const SCHEMA: &str = r#"
-- ── Files ──────────────────────────────────────────────────────────────────

-- One database serves every vault, so each file names its vault, and what's
-- shown for a vault only reads its own rows.
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vault_path TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    last_modified INTEGER NOT NULL,
    last_indexed INTEGER NOT NULL,
    content_hash TEXT NOT NULL,
    word_count INTEGER DEFAULT 0,
    line_count INTEGER DEFAULT 0,
    character_count INTEGER DEFAULT 0,
    file_size INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_files_vault_path ON files(vault_path);
CREATE INDEX IF NOT EXISTS idx_files_path ON files(path);
CREATE INDEX IF NOT EXISTS idx_files_last_modified ON files(last_modified);

-- ── Links ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_file_id INTEGER NOT NULL,
    target_path TEXT NOT NULL,
    link_text TEXT,
    link_type TEXT NOT NULL CHECK(link_type IN ('mention', 'internal', 'external', 'email', 'phone', 'anchor', 'other')),
    is_valid INTEGER DEFAULT 0,
    FOREIGN KEY (source_file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_file_id);
CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_path);
-- Backlinks match a target with case ignored.
CREATE INDEX IF NOT EXISTS idx_links_target_nocase ON links(target_path COLLATE NOCASE);
CREATE INDEX IF NOT EXISTS idx_links_valid ON links(is_valid);

-- ── Tags ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL,
    tag TEXT NOT NULL,
    -- Where the tag first appears among the file's tags, from 0.
    position INTEGER NOT NULL DEFAULT 0,
    -- JSON list of text parts around that first appearance, or NULL when
    -- it can't be found.
    excerpt TEXT,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tags_file_id ON tags(file_id);
-- Tags keep the case they were typed in and are found with case ignored.
DROP INDEX IF EXISTS idx_tags_tag;
CREATE INDEX IF NOT EXISTS idx_tags_tag_nocase ON tags(tag COLLATE NOCASE);

-- ── Attachments ──────────────────────────────────────────────────────────────

-- One database serves every vault, so rows are keyed by vault and path.
CREATE TABLE IF NOT EXISTS attachments (
    vault_path TEXT NOT NULL,
    asset_path TEXT NOT NULL,
    hash TEXT NOT NULL,
    original_name TEXT NOT NULL,
    extension TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    sync_status TEXT NOT NULL CHECK(sync_status IN ('syncable', 'local_only', 'blocked', 'pending_review')),
    ref_count INTEGER NOT NULL DEFAULT 0,
    last_referenced_at INTEGER,
    gc_candidate_at INTEGER,
    PRIMARY KEY (vault_path, asset_path)
);

CREATE INDEX IF NOT EXISTS idx_attachments_hash ON attachments(vault_path, hash);
CREATE INDEX IF NOT EXISTS idx_attachments_sync_status ON attachments(sync_status);
CREATE INDEX IF NOT EXISTS idx_attachments_ref_count ON attachments(ref_count);
CREATE INDEX IF NOT EXISTS idx_attachments_gc_candidate_at ON attachments(gc_candidate_at);

CREATE TABLE IF NOT EXISTS attachment_references (
    file_path TEXT NOT NULL,
    vault_path TEXT NOT NULL,
    asset_path TEXT NOT NULL,
    reference_kind TEXT NOT NULL CHECK(reference_kind IN ('image', 'file', 'audio', 'video')),
    detected_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (file_path, asset_path),
    FOREIGN KEY (vault_path, asset_path) REFERENCES attachments(vault_path, asset_path) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attachment_references_file_path
    ON attachment_references(file_path);
CREATE INDEX IF NOT EXISTS idx_attachment_references_asset_path
    ON attachment_references(vault_path, asset_path);

-- ── AST Cache ───────────────────────────────────────────────────────────────
-- The first path-keyed table was never written by a release.

DROP TABLE IF EXISTS ast_cache;

-- Content-addressed path index.

CREATE TABLE IF NOT EXISTS ast_cache_index (
    file_path TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    cache_version INTEGER NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_ast_cache_index_content_hash
    ON ast_cache_index(content_hash);
CREATE INDEX IF NOT EXISTS idx_ast_cache_index_updated_at
    ON ast_cache_index(updated_at);

-- Content-addressed AST blob store.

CREATE TABLE IF NOT EXISTS ast_cache_blobs (
    content_hash TEXT NOT NULL,
    cache_version INTEGER NOT NULL,
    ast_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (content_hash, cache_version)
);

CREATE INDEX IF NOT EXISTS idx_ast_cache_blobs_updated_at
    ON ast_cache_blobs(updated_at);

-- ── Charts ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS charts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_id INTEGER NOT NULL,
    -- Empty for a chart named after its columns.
    title TEXT NOT NULL,
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_charts_file_id ON charts(file_id);

-- ── Drawing embeds ──────────────────────────────────────────────────────────

-- The drawings each shard shows, by the vault-relative path its image tag
-- names (`data-excalidraw`).
CREATE TABLE IF NOT EXISTS drawing_embeds (
    file_id INTEGER NOT NULL,
    drawing_path TEXT NOT NULL,
    PRIMARY KEY (file_id, drawing_path),
    FOREIGN KEY (file_id) REFERENCES files(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_drawing_embeds_drawing_path ON drawing_embeds(drawing_path);

-- ── Writing Log ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS writing_log (
    -- The local date, as YYYY-MM-DD.
    day TEXT NOT NULL,
    file_path TEXT NOT NULL,
    start_words INTEGER NOT NULL,
    end_words INTEGER NOT NULL,
    PRIMARY KEY (day, file_path)
);

CREATE INDEX IF NOT EXISTS idx_writing_log_file_path ON writing_log(file_path);

CREATE TABLE IF NOT EXISTS writing_log_start (
    vault_path TEXT PRIMARY KEY,
    started_on TEXT NOT NULL
);

-- ── Settings ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vaults (
    path TEXT PRIMARY KEY,
    -- Higher for a vault opened more recently.
    open_order INTEGER NOT NULL,
    ai_allowed INTEGER NOT NULL DEFAULT 0,
    -- The id of the drive it was on when last opened, to tell a vault
    -- that's gone from one whose drive isn't there (`gone_vaults`).
    drive INTEGER
);

CREATE INDEX IF NOT EXISTS idx_vaults_open_order ON vaults(open_order DESC);

-- ── Full-Text Search ────────────────────────────────────────────────────────

CREATE VIRTUAL TABLE IF NOT EXISTS fts_search USING fts5(
    path UNINDEXED,
    name,
    content
);
"#;

fn column_exists(conn: &Connection, table: &str, column: &str) -> Result<bool, rusqlite::Error> {
    let mut stmt = conn.prepare(&format!("PRAGMA table_info({})", table))?;
    let mut rows = stmt.query([])?;
    while let Some(row) = rows.next()? {
        let existing_column_name: String = row.get(1)?;
        if existing_column_name == column {
            return Ok(true);
        }
    }
    Ok(false)
}

/// Drops attachment tables from before rows named their vault. Those keyed
/// rows by `_attachments/<name>` alone, so two vaults with a file of the
/// same name shared one. The tables only mirror what is on disk and in the
/// shards, and the attachment check on opening a vault fills them again.
fn drop_attachment_tables_without_vault(conn: &Connection) -> Result<(), rusqlite::Error> {
    let has_table: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'attachments')",
        [],
        |row| row.get(0),
    )?;
    if has_table && !column_exists(conn, "attachments", "vault_path")? {
        conn.execute_batch(
            "DROP TABLE IF EXISTS attachment_references; DROP TABLE attachments;",
        )?;
    }
    Ok(())
}

/// Drops the search index from before files named their vault. It held
/// every vault's files with nothing to tell them apart, and only mirrors the
/// shards on disk, so indexing each vault when it opens fills it again.
fn drop_index_tables_without_vault(conn: &Connection) -> Result<(), rusqlite::Error> {
    let has_table: bool = conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'files')",
        [],
        |row| row.get(0),
    )?;
    if has_table && !column_exists(conn, "files", "vault_path")? {
        conn.execute_batch(
            "DROP TABLE IF EXISTS charts;
             DROP TABLE IF EXISTS tags;
             DROP TABLE IF EXISTS links;
             DROP TABLE files;
             DROP TABLE IF EXISTS fts_search;",
        )?;
    }
    Ok(())
}

/// Initialize the database schema.
///
/// Creates all tables and indexes if they don't exist, and brings older
/// databases up to date.
pub fn init_schema(conn: &Connection) -> Result<(), rusqlite::Error> {
    drop_attachment_tables_without_vault(conn)?;
    drop_index_tables_without_vault(conn)?;
    let fill_drawing_embeds = !table_exists(conn, "drawing_embeds")?;
    conn.execute_batch(SCHEMA)?;
    if !column_exists(conn, "vaults", "drive")? {
        conn.execute_batch("ALTER TABLE vaults ADD COLUMN drive INTEGER")?;
    }
    if fill_drawing_embeds {
        fill_drawing_embeds_from_index(conn)?;
    }
    Ok(())
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool, rusqlite::Error> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        [table],
        |row| row.get(0),
    )
}

/// Fills `drawing_embeds` for the shards indexed before it existed, from
/// their indexed text, so they don't need indexing again.
fn fill_drawing_embeds_from_index(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Immediate, so a shard indexed meanwhile by another process can't
    // interleave with the read and the writes.
    let tx = rusqlite::Transaction::new_unchecked(conn, rusqlite::TransactionBehavior::Immediate)?;
    {
        let mut stmt = tx.prepare(
            "SELECT f.id, s.content FROM files f JOIN fts_search s ON s.rowid = f.id
             WHERE instr(s.content, 'data-excalidraw') > 0",
        )?;
        let shards = stmt.query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?)))?;
        for shard in shards {
            let (file_id, content) = shard?;
            super::indexer::insert_drawing_embeds(&tx, file_id, &content)?;
        }
    }
    tx.commit()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn search_index_without_a_vault_is_rebuilt() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE files (id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL UNIQUE, name TEXT NOT NULL, last_modified INTEGER NOT NULL, last_indexed INTEGER NOT NULL, content_hash TEXT NOT NULL);
             CREATE TABLE tags (id INTEGER PRIMARY KEY AUTOINCREMENT, file_id INTEGER NOT NULL, tag TEXT NOT NULL);
             CREATE VIRTUAL TABLE fts_search USING fts5(path UNINDEXED, name, content);
             INSERT INTO files (id, path, name, last_modified, last_indexed, content_hash) VALUES (1, '/v/a.md', 'a.md', 0, 0, '');
             INSERT INTO tags (file_id, tag) VALUES (1, 'one');
             INSERT INTO fts_search (rowid, path, name, content) VALUES (1, '/v/a.md', 'a.md', 'a');",
        )
        .unwrap();

        init_schema(&conn).unwrap();

        assert!(column_exists(&conn, "files", "vault_path").unwrap());
        assert!(column_exists(&conn, "tags", "excerpt").unwrap());
        for table in ["files", "tags", "fts_search"] {
            let rows: i64 = conn
                .query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |row| row.get(0))
                .unwrap();
            assert_eq!(rows, 0, "{table}");
        }
    }

    #[test]
    fn attachment_tables_without_a_vault_are_rebuilt() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE attachments (asset_path TEXT PRIMARY KEY, hash TEXT NOT NULL);
             CREATE TABLE attachment_references (file_path TEXT NOT NULL, asset_path TEXT NOT NULL);
             INSERT INTO attachments VALUES ('_attachments/a.png', 'h');",
        )
        .unwrap();

        init_schema(&conn).unwrap();

        assert!(column_exists(&conn, "attachments", "vault_path").unwrap());
        assert!(column_exists(&conn, "attachment_references", "vault_path").unwrap());
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM attachments", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 0);
        // Opening again keeps what the new tables hold.
        conn.execute(
            "INSERT INTO attachments (vault_path, asset_path, hash, original_name, extension, mime_type, size_bytes, sync_status)
             VALUES ('/v', '_attachments/a.png', 'h', 'a.png', 'png', 'image/png', 1, 'syncable')",
            [],
        )
        .unwrap();
        init_schema(&conn).unwrap();
        let rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM attachments", [], |row| row.get(0))
            .unwrap();
        assert_eq!(rows, 1);
    }
}
