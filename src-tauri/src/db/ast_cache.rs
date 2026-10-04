use rusqlite::{params, Connection, OptionalExtension, ToSql};

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

fn get_legacy_ast_json(
    conn: &Connection,
    file_path: &str,
    expected_content_hash: &str,
    expected_cache_version: i64,
) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT ast_json
         FROM ast_cache
         WHERE file_path = ?1
           AND content_hash = ?2
           AND cache_version = ?3",
        params![file_path, expected_content_hash, expected_cache_version],
        |row| row.get::<_, String>(0),
    )
    .optional()
    .map_err(|error| {
        format!(
            "Failed to load legacy AST cache for {}: {}",
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

fn delete_legacy_ast_cache(conn: &Connection, file_path: &str) -> Result<usize, String> {
    conn.execute(
        "DELETE FROM ast_cache WHERE file_path = ?1",
        params![file_path],
    )
    .map_err(|error| {
        format!(
            "Failed to delete legacy AST cache for {}: {}",
            file_path, error
        )
    })
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

fn delete_version_mismatched_content_addressed_ast_cache(
    conn: &Connection,
    file_path: &str,
    expected_cache_version: i64,
) -> Result<usize, String> {
    conn.execute(
        "DELETE FROM ast_cache_index
         WHERE file_path = ?1
           AND cache_version != ?2",
        params![file_path, expected_cache_version],
    )
    .map_err(|error| {
        format!(
            "Failed to delete version-mismatched content-addressed AST cache for {}: {}",
            file_path, error
        )
    })
}

fn delete_version_mismatched_legacy_ast_cache(
    conn: &Connection,
    file_path: &str,
    expected_cache_version: i64,
) -> Result<usize, String> {
    conn.execute(
        "DELETE FROM ast_cache
         WHERE file_path = ?1
           AND cache_version != ?2",
        params![file_path, expected_cache_version],
    )
    .map_err(|error| {
        format!(
            "Failed to delete version-mismatched legacy AST cache for {}: {}",
            file_path, error
        )
    })
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

fn rename_legacy_ast_cache(
    conn: &Connection,
    old_path: &str,
    new_path: &str,
) -> Result<usize, String> {
    let updated_at = now_unix_timestamp()?;

    conn.execute(
        "DELETE FROM ast_cache WHERE file_path = ?1",
        params![new_path],
    )
    .map_err(|error| {
        format!(
            "Failed to clear destination legacy AST cache before rename {} -> {}: {}",
            old_path, new_path, error
        )
    })?;

    conn.execute(
        "UPDATE ast_cache
         SET file_path = ?1, updated_at = ?2
         WHERE file_path = ?3",
        params![new_path, updated_at, old_path],
    )
    .map_err(|error| {
        format!(
            "Failed to rename legacy AST cache {} -> {}: {}",
            old_path, new_path, error
        )
    })
}

fn delete_vault_scoped_rows(
    conn: &Connection,
    table_name: &str,
    vault_path: &str,
    existing_paths: &[String],
) -> Result<usize, String> {
    let normalized_vault_path = vault_path.replace("\\", "/");
    let vault_pattern = format!("{}%", normalized_vault_path);

    if existing_paths.is_empty() {
        return conn
            .execute(
                &format!(
                    "DELETE FROM {}
                     WHERE REPLACE(file_path, '\\\\', '/') LIKE ?1",
                    table_name
                ),
                params![vault_pattern],
            )
            .map_err(|error| {
                format!(
                    "Failed to prune stale AST cache rows from {} for empty vault {}: {}",
                    table_name, vault_path, error
                )
            });
    }

    let placeholders = existing_paths
        .iter()
        .map(|_| "?")
        .collect::<Vec<_>>()
        .join(",");

    let query = format!(
        "DELETE FROM {}
         WHERE REPLACE(file_path, '\\\\', '/') LIKE ?
           AND file_path NOT IN ({})",
        table_name, placeholders
    );

    let mut dynamic_params: Vec<&dyn ToSql> = Vec::with_capacity(existing_paths.len() + 1);
    dynamic_params.push(&vault_pattern);
    for path in existing_paths {
        dynamic_params.push(path as &dyn ToSql);
    }

    conn.execute(&query, dynamic_params.as_slice())
        .map_err(|error| {
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
    if let Some(ast_json) = get_content_addressed_ast_json(
        conn,
        file_path,
        expected_content_hash,
        expected_cache_version,
    )? {
        return parse_ast_value(file_path, &ast_json).map(Some);
    }

    let legacy_ast_json = get_legacy_ast_json(
        conn,
        file_path,
        expected_content_hash,
        expected_cache_version,
    )?;

    match legacy_ast_json {
        Some(ast_json) => {
            let ast = parse_ast_value(file_path, &ast_json)?;
            let _ = upsert_content_addressed_ast_cache_json(
                conn,
                file_path,
                expected_content_hash,
                expected_cache_version,
                &ast_json,
            );
            Ok(Some(ast))
        }
        None => Ok(None),
    }
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
    )?;

    // Best-effort legacy cleanup after content-addressed write succeeds.
    let _ = delete_legacy_ast_cache(conn, file_path);

    Ok(())
}

pub fn delete_ast_cache(conn: &Connection, file_path: &str) -> Result<bool, String> {
    let deleted_index_rows = delete_content_addressed_ast_cache(conn, file_path)?;
    let deleted_legacy_rows = delete_legacy_ast_cache(conn, file_path)?;
    let _ = prune_orphaned_ast_cache_blobs(conn)?;

    Ok(deleted_index_rows > 0 || deleted_legacy_rows > 0)
}

pub fn rename_ast_cache(conn: &Connection, old_path: &str, new_path: &str) -> Result<bool, String> {
    if old_path == new_path {
        return Ok(false);
    }

    let renamed_index_rows = rename_content_addressed_ast_cache(conn, old_path, new_path)?;
    let renamed_legacy_rows = rename_legacy_ast_cache(conn, old_path, new_path)?;
    let _ = prune_orphaned_ast_cache_blobs(conn)?;

    Ok(renamed_index_rows > 0 || renamed_legacy_rows > 0)
}

pub fn delete_ast_cache_for_version_mismatch(
    conn: &Connection,
    file_path: &str,
    expected_cache_version: i64,
) -> Result<bool, String> {
    let deleted_index_rows = delete_version_mismatched_content_addressed_ast_cache(
        conn,
        file_path,
        expected_cache_version,
    )?;
    let deleted_legacy_rows =
        delete_version_mismatched_legacy_ast_cache(conn, file_path, expected_cache_version)?;
    let _ = prune_orphaned_ast_cache_blobs(conn)?;

    Ok(deleted_index_rows > 0 || deleted_legacy_rows > 0)
}

pub fn prune_stale_ast_cache_for_vault(
    conn: &Connection,
    vault_path: &str,
    existing_paths: &[String],
) -> Result<usize, String> {
    let deleted_index_rows =
        delete_vault_scoped_rows(conn, "ast_cache_index", vault_path, existing_paths)?;
    let deleted_legacy_rows =
        delete_vault_scoped_rows(conn, "ast_cache", vault_path, existing_paths)?;
    let _ = prune_orphaned_ast_cache_blobs(conn)?;

    Ok(deleted_index_rows + deleted_legacy_rows)
}
