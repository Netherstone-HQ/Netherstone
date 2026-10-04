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
- **Plain language.** The UI says "Synced", "Working offline" and "Choose
  which version to keep", not commit, push or merge.

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
100 MB file cap. Everything else is listed in the Sync panel as staying on
this device. See [ATTACHMENTS_ARCHITECTURE.md](ATTACHMENTS_ARCHITECTURE.md)
for the policy.

## Sync cycle

`sync/mod.rs` runs: snapshot local changes, fetch, merge, write incoming
changes into the vault, snapshot again, and push. If another device pushed in
between, the cycle retries. Edits made while a sync runs are never
overwritten.

Triggers (`src/hooks/useBackgroundSync.ts`): a few seconds after a vault
opens, a minute after edits stop, every five minutes, on "Sync now", and when
the connection comes back. Network failures show "Working offline".

## Conflicts

When a file changed on both sides (`sync/merge.rs`, `sync/conflicts.rs`):

- This device's version stays in the vault and goes into the merge. GitHub's
  version is recorded in the sync record, and its content stays in history.
- The user picks **Keep GitHub version**, **Keep this device's version** or
  **Keep both** (this device's copy is saved as `Name (This device).md`).
- An edit always wins over a deletion.

## Another device

"Use that backup" in the Sync panel lists the account's backups and syncs one
into the open vault, merging with anything already there.
