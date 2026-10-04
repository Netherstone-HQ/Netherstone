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
- A file whose BLAKE3 hash matches an existing attachment reuses that file.
- Shards link with vault-relative paths, for example
  `![](<_attachments/Screenshot 2026-10-03.png>)`.
- Older vaults may hold files under their hash (`_attachments/0c/0cbd….png`).
  They keep working, and **Tidy up** in Settings renames them.
- `.excalidraw` drawings are ordinary vault files. A drawing placed in a shard
  is exported as a PNG attachment and refreshed when the drawing changes.

## Lifecycle

`src-tauri/src/db/attachments.rs` holds the logic; the tables are
`attachments` and `attachment_references` in `db/schema.rs`.

1. **Insert:** dropping, pasting or picking a file writes it to
   `_attachments/` and records it.
2. **Save:** saving a shard refreshes its references.
3. **Check:** when a vault opens, and from Settings, `reconcile_attachments`
   reports missing files, unused files, files linked from outside
   `_attachments/`, and pending tidy renames.
4. **Clean up:** files unused for 7 days can be moved to the Trash from
   Settings. Each file is re-checked before removal.

A missing file shows its original name in the editor. If a file with the same
content exists, one click relinks every shard that used it.

## Sync eligibility

Each attachment gets a `sync_status` when stored, and Git sync only uploads
`syncable` files:

| Status           | Files                                              |
| ---------------- | -------------------------------------------------- |
| `syncable`       | Known image and document types up to 20 MB         |
| `local_only`     | Anything over 20 MB, and unknown types             |
| `pending_review` | Files with no extension                            |
| `blocked`        | Executables and scripts                            |
