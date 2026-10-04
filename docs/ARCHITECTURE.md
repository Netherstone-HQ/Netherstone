# Architecture

Netherstone is a Tauri v2 desktop app: a React 19 + TypeScript front end in
`src/` and a Rust back end in `src-tauri/src/`. They talk over Tauri commands
(typed wrappers in `src/lib/commands.ts`).

## Principles

- **Files are the source of truth.** A vault is a folder of Markdown files
  (shards), `.excalidraw` drawings and attachments. Everything else is a cache
  that can be rebuilt from disk.
- **Fast through indexing.** Search, tags, links and headings come from a
  SQLite index in the app data folder, never from scanning files on demand.
  The index stays out of the vault, so it is never synced.
- **Offline first.** Every feature except sync works without a connection.

## Vault and file watching

- `src-tauri/src/vault.rs` reads the folder tree, skipping hidden files.
- `watcher.rs` uses `notify` to pick up changes made outside the app, update
  the index and refresh the UI.

## Editor and saving

- The editor is [Plate](https://platejs.org) (Slate). Markdown is converted to
  and from Plate's document tree in a web worker
  (`src/components/editor/serialize.worker.ts`), so large shards don't block
  typing.
- Opening a shard can skip parsing: the last parsed tree is cached in SQLite,
  keyed by path and content hash (`src-tauri/src/db/ast_cache.rs`,
  `src/lib/editor-ast-cache.ts`). A changed file is parsed again.
- Autosave runs 1.8 s after typing stops (`src/hooks/useAutosave.ts`). Rust
  writes to `<name>.md.tmp` and renames it over the shard, so a crash never
  leaves a half-written file. Pending saves are flushed before the window
  closes.

## Index and search

`src-tauri/src/db/` holds the schema (`schema.rs`), indexer and parser. On
vault open, files whose modified time changed are re-parsed with
`pulldown-cmark`: full text goes into an FTS5 table, and headings, `#tags`
and links into their own tables for the outline, tag view and link checks.
Links to other shards are `@` mentions, saved as `[label](mention:target)`.

## Subsystems with their own docs

- [Attachments](ATTACHMENTS_ARCHITECTURE.md): the `_attachments/` folder,
  deduplication, missing-file repair and cleanup.
- [Git sync](GIT_SYNC_ARCHITECTURE.md): GitHub sign-in, per-vault backups,
  the sync cycle and conflicts.

## Tests

- `pnpm test` runs the Vitest suite, including Markdown round-trips over
  the files in `docs/`.
- `cargo test` in `src-tauri/` runs the Rust unit tests.
