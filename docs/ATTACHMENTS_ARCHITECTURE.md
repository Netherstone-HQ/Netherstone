# Attachments Architecture

How Netherstone stores the images, files, audio and video that shards link to.

## Principles

- **Markdown is the source of truth.** A shard's links decide which files are
  in use. The database is an index that can be rebuilt from disk.
- **Attachments live in the vault,** so they travel with the folder and with
  sync.
- **Nothing is deleted behind the user's back.** Unused files are removed only
  after a grace period, when the user confirms, and they go to the system
  Trash.

## Storage

- Every attachment sits in one flat `_attachments/` folder at the vault root,
  under its original name made portable. A clash adds `-1`, `-2` and so on.
  Each name is claimed as a new file, so a file another program put there is
  never replaced.
- A file whose BLAKE3 hash matches an existing attachment reuses that file.
- Shards link with vault-relative paths, for example
  `![](<_attachments/Screenshot 2026-10-03.png>)`.
- Older vaults may hold files under their hash (`_attachments/0c/0cbd….png`).
  They keep working.
- `.excalidraw` drawings are ordinary vault files. A drawing placed in a shard
  is exported as two PNG attachments, light (`src`) and dark
  (`data-dark-src`), and refreshed when the drawing changes. Dark themes show
  the dark one; other apps show `src`.

## Lifecycle

`src-tauri/src/db/attachments.rs` holds the logic; the tables are
`attachments` and `attachment_references` in `db/schema.rs`.

1. **Insert:** dropping, pasting or picking a file writes it to
   `_attachments/` and records it. The file is written and flushed under a
   hidden name first, then named under `writes.lock`, so copying a big file
   in doesn't hold up saves.
   A file on disk is copied by Rust from its path; a file the app holds
   (pasted, dropped, a drawing export) arrives as raw bytes.
2. **Save:** saving a shard refreshes its references.
3. **Check:** when a vault opens, on the Overview page, and from Settings,
   `reconcile_attachments` reports missing files and unused files (both
   under Health on the Overview page) and files linked from outside
   `_attachments/` (in Settings).
4. **Clean up:** files unused for 7 days can be moved to the Trash from
   Health on the Overview page. Each file is re-checked before removal.

A missing file shows its original name in the editor. If a file with the same
content exists, one click (in the editor or in Health) relinks every shard
that used it.

## Gallery

The Gallery (`src/components/gallery/`) shows every file in `_attachments/`,
newest added first, with the shards that use it. `list_attachments`
(`src-tauri/src/db/gallery.rs`) reads the folder and this vault's
references. A drawing export and its dark twin are one file. The watcher
reports files in `_attachments/`, so the Gallery follows changes made
outside the app; the file tree and index ignore them.

Tiles show pictures as thumbnails at most 400 px on their longest side.
`gallery_thumbnail` makes one the first time a tile comes near view and
keeps it in the app's own folder (`thumbnails/`, one folder per vault)
until the picture changes; pictures of 256 KB or less, and SVGs, are shown
as they are. Listing the Gallery removes thumbnails of pictures since
removed or changed. Tiles more than a screen away let go of their pictures,
so a long scroll doesn't keep every one in memory.

## Sync eligibility

Each attachment gets a `sync_status` when stored, and Git sync only uploads
`syncable` files:

| Status           | Files                                              |
| ---------------- | -------------------------------------------------- |
| `syncable`       | Known image and document types up to 20 MB         |
| `local_only`     | Anything over 20 MB, and unknown types             |
| `pending_review` | Files with no extension                            |
| `blocked`        | Executables and scripts                            |
