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
- Rust knows which vault is open (`vault_access.rs`), and file commands
  refuse paths outside it. A folder opens as the vault when it already has
  the `.netherstone` marker or was just picked or created in a native dialog.
- `watcher.rs` uses `notify` to pick up changes made outside the app, update
  the index and refresh the UI.
- When the open shard changes outside the app, only the blocks that changed
  are replaced, keeping the cursor and any unsaved edits elsewhere
  (`src/lib/outside-changes.ts`). If the same blocks changed on both sides,
  a dialog asks which version to keep. Both versions go into local history
  first. An open drawing does the same shape by shape
  (`src/components/ExcalidrawCanvas.tsx`).

## Editor and saving

- The editor is [Plate](https://platejs.org) (Slate). Markdown is converted to
  and from Plate's document tree in a web worker
  (`src/components/editor/serialize.worker.ts`), so large shards don't block
  typing.
- Shards are plain Markdown. What Markdown has no syntax for is written as a
  little HTML any renderer copes with: alignment, line height and indent as
  a `<div align style>` wrapper around the blocks (`src/lib/markdown-block-formatting.ts`),
  a resized image as `<img width>`, a table's widths, merges and colours in a
  `<!-- netherstone: … -->` comment above it (`src/lib/markdown-tables.ts`).
- Opening a shard can skip parsing: the last parsed tree is cached in SQLite,
  keyed by path and content hash (`src-tauri/src/db/ast_cache.rs`,
  `src/lib/editor-ast-cache.ts`). A changed file is parsed again.
- Autosave runs 1.8 s after typing stops (`src/hooks/useAutosave.ts`). Every
  write into a vault goes through `vault::write_atomically`: a hidden file
  beside the target, flushed to disk, then renamed over it, so a crash or
  power loss never leaves a half-written file. Pending saves are flushed
  before the window closes.

## Index and search

`src-tauri/src/db/` holds the schema (`schema.rs`), indexer and parser. On
vault open, files whose modified time changed are re-parsed with
`pulldown-cmark`: full text goes into an FTS5 table, and headings, `#tags`
and links into their own tables for the outline, tag view and link checks.
Links to other shards are `@` mentions, saved as ordinary Markdown links to
the shard's path relative to the linking file, `[label](../Projects/Plan.md)`.
Renaming or moving a shard rewrites the links to it (`shard_links.rs`).

## Overview

The Overview page (`src/components/data/`) shows the words written each
day, vault health and every chart. Words come from local history, so edits
from other devices and other apps count (`src-tauri/src/db/data.rs`). A
chart is drawn from the table right above a
`<!-- netherstone chart: … -->` comment (`src/lib/chart.ts`), so the shard
stays plain Markdown.

## Import

The import window (`src/components/import/`) turns Word, PDF, HTML,
Markdown, CSV and text files into shards. Each format in
`src/lib/import/formats/` converts its file to a Plate value, which is
saved like any shard, and images go to `_attachments/`. Rust
(`src-tauri/src/import.rs`) lists and reads the picked files and finds free
names, so an import never overwrites anything already in the vault.

## Exports

A shard exports as a web page, a PDF or a Word document from the export
window (`src/components/export/`), which loads only when it first opens.

- `src/lib/export/build.ts` reads the editor's Plate value once into a plain
  model (lists, toggles, code tokens, dates), so all three formats agree on
  what the shard says. `theme.ts` holds the colors and sizes they share.
- HTML embeds the app's own fonts, KaTeX and images in one file.
- PDF prints that HTML through the platform webview
  (`src-tauri/src/export/`): a hidden window loads it, waits for fonts and
  images, and prints to a file with WebView2, WebKit (macOS) or WebKitGTK.
- Word is built with the `docx` library: heading styles, real lists and
  checkboxes, equations as Office Math. Fonts are named, not embedded.
- The preview loads once and restyles itself in place when options change.
  Pages are laid out as CSS columns, so they break the way the PDF prints.
- Rust only writes an export to a path picked in its save dialog, and only
  reads pictures for one.

## Subsystems with their own docs

- [Attachments](ATTACHMENTS_ARCHITECTURE.md): the `_attachments/` folder,
  deduplication, missing-file repair and cleanup.
- [Git sync](GIT_SYNC_ARCHITECTURE.md): GitHub sign-in, per-vault backups,
  the sync cycle and conflicts.

## Tests

- `pnpm test` runs the Vitest suite, including Markdown round-trips over
  the files in `docs/`.
- `cargo test` in `src-tauri/` runs the Rust unit tests.
