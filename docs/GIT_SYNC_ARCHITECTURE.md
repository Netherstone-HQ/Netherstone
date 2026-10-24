# Git Sync Architecture

How Netherstone backs up a vault to GitHub and keeps it in sync across
devices. Git is the transport and the history; the user never sees Git terms.

## Principles

- **The vault stays the source of truth.** Sync is a backup layer on top of
  local editing, and the app works fully offline.
- **No Git in the vault.** Git data lives in the app data folder with the
  vault as its work tree, so no `.git` folder appears in the vault.
- **Selective, never `git add .`.** A planner decides exactly which files go
  up, using the attachment policy.
- **Never lose work.** Sync never writes conflict markers, and a file is only
  overwritten if it still matches the last snapshot.
- **Plain language.** The UI says "Synced", "Offline" and "Choose which
  version to keep", not commit, push or merge.

## Sign-in

Device flow through the Netherstone GitHub App, so no client secret ships in
the app (`src-tauri/src/github/device_flow.rs`). The App needs Contents and
Administration read/write and is installed on the user's account with "All
repositories", because Apps can't be limited to repositories they create. The
token is kept in the OS credential store, with a fallback when none is
available (`github/token_store.rs`).

## Repository and vault identity

- One private repository per vault, named after the vault and tagged
  `netherstone-vault` (`github/repos.rs`).
- The vault id is stored in `.netherstone/vault-id` inside the vault. Git data
  is in `sync/<vault-id>/git` and the sync record in `sync/<vault-id>/state.json`,
  both under the app data folder (`sync/state.rs`). A moved vault keeps its
  id; a copied one gets a new id.
- Each vault has its own sync state. Only the open vault syncs.

## What syncs

`sync/planner.rs` includes `.md` shards, `.excalidraw` drawings and files in
`_attachments/` that the attachment policy marks `syncable`, under GitHub's
100 MB file cap. A folder that is another vault keeps its own history and is
left out. Everything else is listed in the Sync panel as staying on
this device. See [ATTACHMENTS_ARCHITECTURE.md](ATTACHMENTS_ARCHITECTURE.md)
for the policy.

## Sync cycle

`sync/mod.rs` runs: snapshot local changes, fetch, merge, write incoming
changes into the vault, snapshot again, and push. If another device pushed in
between, the cycle retries. Edits made while a sync runs are never
overwritten.

Triggers (`src/hooks/useBackgroundSync.ts`): a few seconds after a vault
opens, five minutes after edits stop, every five minutes, on "Sync now", and
when the connection comes back. Network failures show "Offline".

## Local history

Every vault has this history, with or without sync: the same repository,
committed by the same planner. A version is saved a minute after changes stop
and a minute after the vault opens (`src/hooks/useLocalHistory.ts`). When the
open shard changes outside the app, the text the app last saved and the new
text are both saved first (`snapshot_outside_change`), so neither is lost
whatever the user keeps. Unchanged vaults make no version.

The history panel (`src/components/history/`) lists one file's versions from
this history (`src-tauri/src/sync/history.rs`): the commits where its content
changed, following renames, newest first. What a version is, beyond an edit,
comes from a line in its commit message: `Changed outside the app: <path>` or
`Restored <path> from <time>`. Each version's commit is authored by the
device that saved it (its system name), so the panel can name it once a file
has versions from more than one device. Restoring saves a version of the vault first,
writes the old content, then saves that as a version, so a restore can always
be undone.

The panel and the Overview calendar read the history through the
changed-paths index (`src-tauri/src/sync/changes.rs`): one line per version
in the repository's folder, with the files it changed. A version's entry is
worked out the first time it's read and never changes, so a long history
doesn't mean opening every version again.

## Locks

`src-tauri/src/locks.rs` holds three locks shared by every Netherstone
process on the device. Each is an OS file lock in the app data folder, so a
second Netherstone process waits instead of writing at the same time.

- `writes.lock`: around every change to a vault's shards, drawings and
  folders (saves, new files, rename, move, delete, sync writing incoming
  changes, conflict choices).
- `history.lock`: around local Git work (saving a version, merging, restoring,
  settling a conflict), never around fetch or push.
- `sync.lock`: around a whole sync, so only one runs at a time.

When more than one is needed, they are taken as `sync`, then `history`,
then `writes`.

## Conflicts

When a file changed on both sides (`sync/merge.rs`, `sync/conflicts.rs`):

- This device's version stays in the vault and goes into the merge. GitHub's
  version is recorded in the sync record, and its content stays in history.
- The user picks **Keep GitHub version**, **Keep this device's version** or
  **Keep both** (this device's copy is saved as `Name (This device).md`).
- Drawings are merged shape by shape (`sync/drawing_merge.rs`). Only a
  shape changed on both sides is a conflict, and this device's shape is kept.
- An edit always wins over a deletion.

## Another device

"Use a vault you synced on another device" in the Sync panel lists the
account's backups and syncs one into the open vault, merging with anything
already there.
