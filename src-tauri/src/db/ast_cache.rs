use rusqlite::{params, Connection, OptionalExtension};

use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

fn now_unix_timestamp() -> Result<i64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .map_err(|error| format!("Failed to compute AST cache timestamp: {}", error))
}

fn serialize_ast_value(file_path: &str, ast: &Value) -> Result<String, String> {
    serde_json::to_string(ast).map_err(|error| {
        format!(
            "Failed to serialize AST cache JSON for {}: {}",
            file_path, error
        )
    })
}

fn parse_ast_value(file_path: &str, ast_json: &str) -> Result<Value, String> {
    serde_json::from_str(ast_json).map_err(|error| {
        format!(
            "Failed to parse AST cache JSON for {}: {}",
            file_path, error
        )
    })
}

fn get_content_addressed_ast_json(
    conn: &Connection,
    file_path: &str,
    expected_content_hash: &str,
    expected_cache_version: i64,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT blobs.ast_json
         FROM ast_cache_index AS cache_index
         INNER JOIN ast_cache_blobs AS blobs
           ON blobs.content_hash = cache_index.content_hash
          AND blobs.cache_version = cache_index.cache_version
         WHERE cache_index.file_path = ?1
           AND cache_index.content_hash = ?2
           AND cache_index.cache_version = ?3",
        params![file_path, expected_content_hash, expected_cache_version],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|error| {
        format!(
            "Failed to load content-addressed AST cache for {}: {}",
            file_path, error
        )
    })
}

fn upsert_content_addressed_ast_cache_json(
    conn: &Connection,
    file_path: &str,
    content_hash: &str,
    cache_version: i64,
    ast_json: &str,
) -> Result<(), String> {
    let updated_at = now_unix_timestamp()?;

    conn.execute(
        "INSERT INTO ast_cache_blobs (
            content_hash,
            cache_version,
            ast_json,
            updated_at
         ) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(content_hash, cache_version) DO UPDATE SET
            ast_json = excluded.ast_json,
            updated_at = excluded.updated_at",
        params![content_hash, cache_version, ast_json, updated_at],
    )
    .map_err(|error| {
        format!(
            "Failed to upsert AST cache blob for hash {} (version {}): {}",
            content_hash, cache_version, error
        )
    })?;

    conn.execute(
        "INSERT INTO ast_cache_index (
            file_path,
            content_hash,
            cache_version,
            updated_at
         ) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(file_path) DO UPDATE SET
            content_hash = excluded.content_hash,
            cache_version = excluded.cache_version,
            updated_at = excluded.updated_at",
        params![file_path, content_hash, cache_version, updated_at],
    )
    .map_err(|error| {
        format!(
            "Failed to upsert AST cache index for {}: {}",
            file_path, error
        )
    })?;

    Ok(())
}

fn delete_content_addressed_ast_cache(conn: &Connection, file_path: &str) -> Result<usize, String> {
    conn.execute(
        "DELETE FROM ast_cache_index WHERE file_path = ?1",
        params![file_path],
    )
    .map_err(|error| {
        format!(
            "Failed to delete content-addressed AST cache index for {}: {}",
            file_path, error
        )
    })
}

fn prune_orphaned_ast_cache_blobs(conn: &Connection) -> Result<usize, String> {
    conn.execute(
        "DELETE FROM ast_cache_blobs
         WHERE NOT EXISTS (
             SELECT 1
             FROM ast_cache_index
             WHERE ast_cache_index.content_hash = ast_cache_blobs.content_hash
               AND ast_cache_index.cache_version = ast_cache_blobs.cache_version
         )",
        [],
    )
    .map_err(|error| format!("Failed to prune orphaned AST cache blobs: {}", error))
}

fn rename_content_addressed_ast_cache(
    conn: &Connection,
    old_path: &str,
    new_path: &str,
) -> Result<usize, String> {
    let updated_at = now_unix_timestamp()?;

    let _ = delete_content_addressed_ast_cache(conn, new_path)?;
    let renamed = conn
        .execute(
            "UPDATE ast_cache_index
             SET file_path = ?1, updated_at = ?2
             WHERE file_path = ?3",
            params![new_path, updated_at, old_path],
        )
        .map_err(|error| {
            format!(
                "Failed to rename content-addressed AST cache {} -> {}: {}",
                old_path, new_path, error
            )
        })?;

    Ok(renamed)
}

fn delete_vault_scoped_rows(
    conn: &Connection,
    table_name: &str,
    vault_path: &str,
    existing_paths: &[String],
) -> Result<usize, String> {
    // Paths inside the vault start with its path and a separator, so a vault
    // named "Notes" leaves "Notes2" alone.
    let vault_prefix = format!("{}/", vault_path.replace('\\', "/").trim_end_matches('/'));

    let prune = || -> rusqlite::Result<usize> {
        crate::db::fill_kept_paths(conn, existing_paths)?;
        conn.execute(
            &format!(
                "DELETE FROM {}
                 WHERE substr(REPLACE(file_path, '\\', '/'), 1, length(?1)) = ?1
                   AND file_path NOT IN (SELECT path FROM kept_paths)",
                table_name
            ),
            params![vault_prefix],
        )
    };

    prune().map_err(|error| {
        format!(
            "Failed to prune stale AST cache rows from {} for vault {}: {}",
            table_name, vault_path, error
        )
    })
}

pub fn get_valid_ast_cache(
    conn: &Connection,
    file_path: &str,
    expected_content_hash: &str,
    expected_cache_version: i64,
) -> Result<Option<Value>, String> {
    get_content_addressed_ast_json(
        conn,
        file_path,
        expected_content_hash,
        expected_cache_version,
    )?
    .map(|ast_json| parse_ast_value(file_path, &ast_json))
    .transpose()
}

pub fn upsert_ast_cache(
    conn: &Connection,
    file_path: &str,
    content_hash: &str,
    cache_version: i64,
    ast: &Value,
) -> Result<(), String> {
    let ast_json = serialize_ast_value(file_path, ast)?;

    upsert_content_addressed_ast_cache_json(
        conn,
        file_path,
        content_hash,
        cache_version,
        &ast_json,
    )
}

pub fn delete_ast_cache(conn: &Connection, file_path: &str) -> Result<bool, String> {
    let deleted_index_rows = delete_content_addressed_ast_cache(conn, file_path)?;
    let _ = prune_orphaned_ast_cache_blobs(conn)?;

    Ok(deleted_index_rows > 0)
}

pub fn rename_ast_cache(conn: &Connection, old_path: &str, new_path: &str) -> Result<bool, String> {
    if old_path == new_path {
        return Ok(false);
    }

    let renamed_index_rows = rename_content_addressed_ast_cache(conn, old_path, new_path)?;
    let _ = prune_orphaned_ast_cache_blobs(conn)?;

    Ok(renamed_index_rows > 0)
}

pub fn prune_stale_ast_cache_for_vault(
    conn: &Connection,
    vault_path: &str,
    existing_paths: &[String],
) -> Result<usize, String> {
    let deleted_index_rows =
        delete_vault_scoped_rows(conn, "ast_cache_index", vault_path, existing_paths)?;
    let _ = prune_orphaned_ast_cache_blobs(conn)?;

    Ok(deleted_index_rows)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cached_paths(conn: &Connection) -> Vec<String> {
        let mut statement = conn
            .prepare("SELECT file_path FROM ast_cache_index ORDER BY file_path")
            .unwrap();
        statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .map(Result::unwrap)
            .collect()
    }

    #[test]
    fn prunes_only_the_vaults_own_missing_shards() {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::init_schema(&conn).unwrap();
        let ast = serde_json::json!([]);
        for path in ["/v/Notes/a.md", "/v/Notes/gone.md", "/v/Notes2/b.md"] {
            upsert_ast_cache(&conn, path, path, 1, &ast).unwrap();
        }

        // More kept paths than SQLite allows parameters in one statement.
        let mut existing: Vec<String> = (0..40_000).map(|i| format!("/v/Notes/{i}.md")).collect();
        existing.push("/v/Notes/a.md".to_string());
        prune_stale_ast_cache_for_vault(&conn, "/v/Notes", &existing).unwrap();

        assert_eq!(cached_paths(&conn), ["/v/Notes/a.md", "/v/Notes2/b.md"]);
    }
}
