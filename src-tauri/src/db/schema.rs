use rusqlite::Connection;

/// SQL schema for the Netherstone knowledge base index.
///
/// Tables:
/// - `files`: Core metadata and editor stats for each markdown file in the vault
/// - `links`: Indexed outbound links including mentions, internal links, and external URLs
/// - `tags`: Extracted hashtags from file content, each with the text around
///   its first appearance
/// - `attachments`: Managed vault asset metadata for `_attachments` files
/// - `attachment_references`: Saved markdown references to managed attachments
/// - `ast_cache`: Legacy path-keyed AST cache rows retained for migration/backfill
/// - `ast_cache_index`: Path-to-content index for the content-addressed AST cache
/// - `ast_cache_blobs`: Content-addressed AST payload store keyed by hash + version
/// - `charts`: The charts drawn from tables in each file
/// - `writing_log`: Words each shard started and ended a day with, from saves
///   in the editor on this device. Never synced.
/// - `writing_log_start`: The day this device started counting for each vault
/// - `fts_search`: FTS5 virtual table for full-text search
pub const SCHEMA: &str = r#"
-- ── Files ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);

-- ── Attachments ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS attachments (
    asset_path TEXT PRIMARY KEY,
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
    gc_candidate_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_attachments_hash ON attachments(hash);
CREATE INDEX IF NOT EXISTS idx_attachments_sync_status ON attachments(sync_status);
CREATE INDEX IF NOT EXISTS idx_attachments_ref_count ON attachments(ref_count);
CREATE INDEX IF NOT EXISTS idx_attachments_gc_candidate_at ON attachments(gc_candidate_at);

CREATE TABLE IF NOT EXISTS attachment_references (
    file_path TEXT NOT NULL,
    asset_path TEXT NOT NULL,
    reference_kind TEXT NOT NULL CHECK(reference_kind IN ('image', 'file', 'audio', 'video')),
    detected_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (file_path, asset_path),
    FOREIGN KEY (asset_path) REFERENCES attachments(asset_path) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attachment_references_file_path
    ON attachment_references(file_path);
CREATE INDEX IF NOT EXISTS idx_attachment_references_asset_path
    ON attachment_references(asset_path);

-- ── AST Cache ───────────────────────────────────────────────────────────────
-- Legacy path-keyed table retained during migration to content-addressed cache.

CREATE TABLE IF NOT EXISTS ast_cache (
    file_path TEXT PRIMARY KEY,
    content_hash TEXT NOT NULL,
    cache_version INTEGER NOT NULL,
    ast_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_ast_cache_content_hash ON ast_cache(content_hash);
CREATE INDEX IF NOT EXISTS idx_ast_cache_updated_at ON ast_cache(updated_at);

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

fn ensure_column_exists(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), rusqlite::Error> {
    if !column_exists(conn, table, column)? {
        conn.execute(
            &format!("ALTER TABLE {} ADD COLUMN {} {}", table, column, definition),
            [],
        )?;
    }

    Ok(())
}

fn links_table_needs_migration(conn: &Connection) -> Result<bool, rusqlite::Error> {
    let create_sql: Option<String> = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'links'",
            [],
            |row| row.get(0),
        )
        .ok();

    let Some(create_sql) = create_sql else {
        return Ok(false);
    };

    Ok(create_sql.contains("'markdown'") || create_sql.contains("'wikilink'"))
}

fn migrate_links_table(conn: &Connection) -> Result<(), rusqlite::Error> {
    if !links_table_needs_migration(conn)? {
        return Ok(());
    }

    conn.execute_batch(
        r#"
        ALTER TABLE links RENAME TO links_old;

        CREATE TABLE links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_file_id INTEGER NOT NULL,
            target_path TEXT NOT NULL,
            link_text TEXT,
            link_type TEXT NOT NULL CHECK(link_type IN ('mention', 'internal', 'external', 'email', 'phone', 'anchor', 'other')),
            is_valid INTEGER DEFAULT 0,
            FOREIGN KEY (source_file_id) REFERENCES files(id) ON DELETE CASCADE
        );

        INSERT INTO links (id, source_file_id, target_path, link_text, link_type, is_valid)
        SELECT
            id,
            source_file_id,
            target_path,
            link_text,
            CASE
                WHEN link_type = 'mention' THEN 'mention'
                WHEN link_type = 'markdown' THEN 'internal'
                ELSE 'other'
            END,
            is_valid
        FROM links_old;

        DROP TABLE links_old;

        CREATE INDEX IF NOT EXISTS idx_links_source ON links(source_file_id);
        CREATE INDEX IF NOT EXISTS idx_links_target ON links(target_path);
        CREATE INDEX IF NOT EXISTS idx_links_valid ON links(is_valid);
        "#,
    )?;

    Ok(())
}

/// Initialize the database schema.
///
/// Creates all tables and indexes if they don't exist, and brings older
/// databases up to date.
pub fn init_schema(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(SCHEMA)?;
    migrate_links_table(conn)?;

    ensure_column_exists(conn, "files", "line_count", "INTEGER DEFAULT 0")?;
    ensure_column_exists(conn, "files", "character_count", "INTEGER DEFAULT 0")?;
    ensure_column_exists(conn, "files", "file_size", "INTEGER DEFAULT 0")?;

    // Tags indexed before excerpts were stored get theirs from the indexed
    // text, so the Tags view shows them without re-indexing every file.
    if !column_exists(conn, "tags", "excerpt")? {
        ensure_column_exists(conn, "tags", "position", "INTEGER NOT NULL DEFAULT 0")?;
        ensure_column_exists(conn, "tags", "excerpt", "TEXT")?;
        super::indexer::backfill_tag_excerpts(conn)?;
    }
    Ok(())
}
