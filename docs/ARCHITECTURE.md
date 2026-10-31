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
  A new vault goes only in Documents or a folder picked in the folder
  dialog. Linked files open through `open_file`, which refuses programs,
  scripts and shortcuts (`open_access.rs`).
- `watcher.rs` uses `notify` to pick up changes made outside the app to
  shards, drawings, folders and attachments, update the index and refresh
  the UI.
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
  `<!-- netherstone: … -->` comment above it (`src/lib/markdown-tables.ts`),
  and an embed as a link under a `<!-- netherstone embed -->` comment
  (`src/lib/markdown-embeds.ts`).
- Opening a shard can skip parsing: the last parsed tree is cached in SQLite,
  keyed by path and content hash (`src-tauri/src/db/ast_cache.rs`,
  `src/lib/editor-ast-cache.ts`). A changed file is parsed again.
- Autosave runs 1.8 s after typing stops (`src/hooks/useAutosave.ts`). Every
  write into a vault goes through `vault::write_atomically`: a hidden file
  beside the target, flushed to disk, then renamed over it, so a crash or
  power loss never leaves a half-written file. Pending saves are flushed
  before the window closes.

## Shortcuts

Every keyboard shortcut is listed once, in `src/lib/shortcuts.ts`: its id,
label, default keys and where it works (the whole app, the editor or the
canvas). That list runs the app's shortcuts (`src/hooks/useAppShortcuts.ts`)
and the editor's (`src/components/editor/kits/shortcuts-kit.tsx`, with
Plate's own key handling off), and fills Settings › Shortcuts, tooltips and
menus. Letters match the character typed and other keys their place on the
keyboard. Only the shortcuts someone changed are saved, keyed by id, so new
defaults reach everyone else. Excalidraw's keys are listed but can't change.

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
names, so an import never overwrites anything already in the vault. It reads
only the picked files and folders, and the `_attachments/` folders above
them. A name taken between reserving and saving moves the shard to the next
free name, and links to it from the same import are fixed.

A picked or dropped `.zip` file imports like a folder named after it
(`src/lib/import/zip.ts`): the engine lists the files in it and reads each
one out of it only when needed, never unpacking to disk. Files whose paths
leave the zip file are left out, a zip file whose files share data (how zip
bombs grow) isn't opened, and no file is unpacked past the size the zip
file gives for it. Zip files inside a zip file stay closed.

## Opening from outside the app

Folders and files reach the app from the terminal (`netherstone .`,
`netherstone notes.md`), Open with, the folder right-click menu on Windows
and the Dock on macOS (`src-tauri/src/launch.rs`). The paths come only from
the system: the command line, the one a second launch hands over through the
single-instance plugin (release builds), and macOS's open event. Rust holds
them until the window takes them (`src/lib/launch.ts`); a folder is then
allowed like one picked in the folder dialog and opens as the vault, and
files are allowed like ones picked for an import and open in the import
window. Files wait while no vault is open or another import runs. Once the
page runs it could cause a launch itself (opening a file in its own app hands
it back when Netherstone is that app), so anything arriving after the
window's first take waits for a yes in a native dialog. Launched files are
readable on their own, without the `_attachments` folders above them.

macOS and Linux list Netherstone in Open with from the bundle, at a rank that
never makes it the default app. On Windows, Open with, the folder menu and
the `netherstone` command on the PATH are off until turned on in Settings
(`integrations.rs`), which writes them for the user only; the uninstaller
takes them back. macOS gets the command from the same setting, asking for an
administrator only when `/usr/local/bin` isn't the user's to write. Linux
packages ship it in `/usr/bin`. The installer images are drawn
from the brand mark by `scripts/installer-images.mjs` into
`src-tauri/installer/`.

Netherstone links (`netherstone://open/<address>`) arrive the same way, and
are read before any argument is taken as a path. The address is a template
(`netherstone.app/templates/<id>`) or a public folder
(`github.com/<owner>/<repo>[/tree/<branch>/<folder>]`); anything else is
refused. `src-tauri/src/open_source/` has one reader per kind: the site's
`templates.json`, or one GitHub listing with every file's size. The dialog
(`src/components/open-link/`) shows what's there before anything downloads,
and the window can only open the address a launch handed it. Create vault
checks the name and the free space, downloads into a scratch folder in the
app's data (each file at its listed size, a template's zip at its sha256),
then unpacks a template into the new vault as it is, or brings any other
folder in through the Markdown import. Only shards, drawings and pictures
are written, never a path that climbs out or a `.git` or `.netherstone`
folder, so the vault is a copy with its own id. The scratch folder goes
after, on failure or Cancel, and at the next start if the app stopped.

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

## AI apps (MCP)

AI apps reach the vaults through an MCP server: the app's own program
started as `Netherstone mcp` by the AI app, talking over stdin and stdout
with no window (`src-tauri/src/mcp.rs`, on the official `rmcp` SDK). It
does nothing while AI apps are turned off in Settings, and uses only the
vaults picked there. Every vault the app opens goes in the `vaults` table,
newest first, with whether AI apps may use it, which every Netherstone
process reads (`db/settings.rs`). When the app starts it forgets what it
can make again for each vault whose folder is gone, and keeps its history
until it's deleted in Settings (`gone_vaults.rs`).

- `list_vaults` gives the picked vaults. Every other tool takes an
  optional `vault`, and works on the vault opened last without one. A vault
  whose folder is gone is passed over until the app next starts and forgets
  it.

- The tools live in `src-tauri/src/tools/`, apart from the server: they take
  a vault and JSON arguments and return JSON, so the in-app assistant can
  call the same ones. Paths are vault-relative, lists come a page at a
  time, and nothing is ever deleted.
- Every change saves versions around it in local history, only of the
  files it changed: the files as they were, then as the AI app left them,
  noted "Changed by" the app with its summary (`sync::save_app_change`).
- Nothing watches a vault between calls, so the server holds no vault
  folder open. A call that reads the index first indexes the shards that
  changed since (`Vault::index` in `tools/mod.rs`). Writes share the app's
  locks (`locks.rs`), so the two never write at once.
- A drawing an AI app embeds has no picture yet; the app makes it when the
  shard is opened.

## Subsystems with their own docs

- [Attachments](ATTACHMENTS_ARCHITECTURE.md): the `_attachments/` folder,
  deduplication, missing-file repair and cleanup.
- [Git sync](GIT_SYNC_ARCHITECTURE.md): GitHub sign-in, per-vault backups,
  the sync cycle and conflicts.

## Tests

- `pnpm test` runs the Vitest suite, including Markdown round-trips over
  the files in `docs/`.
- `cargo test` in `src-tauri/` runs the Rust unit tests.
