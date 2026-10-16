// Every word the welcome flow shows, in one place so it can be read and
// edited on its own. The "Start here" shard new vaults get is in
// start-here.md next to this file.

import type { VaultFolderError } from "@/lib/commands";

export const copy = {
  common: {
    back: "Back",
    continue: "Continue",
    skip: "Skip for now",
    /** The close button, shown when the tour is replayed from Settings. */
    close: "Close the welcome tour",
    /** Read out by screen readers on the step dots, e.g. "Step 2 of 5". */
    stepLabel: (step: number, total: number) => `Step ${step} of ${total}`,
  },

  welcome: {
    tagline: "Your knowledge, set in stone.",
    start: "Get started",
  },

  vault: {
    title: "Where should your knowledge live?",
    body: "A vault is a folder on your computer. Each shard in it is a document, saved as a Markdown file that any app can open.",

    keep: {
      title: (name: string) => `Keep using ${name}`,
      description: "Carry on with the vault that's already open.",
    },
    create: {
      title: "Create a new vault",
      description: "Start fresh in a new folder.",
      nameLabel: "Name",
      defaultName: "My Vault",
      locationLabel: "Location",
      change: "Change",
      submit: "Create vault",
    },
    open: {
      title: "Open a folder you already have",
      description: "Your files stay exactly where they are.",
    },
    restore: {
      title: "Restore a synced vault",
      description: "Bring back a vault you synced on another device.",
      signInFirst: "Connect the GitHub account you synced with.",
      loading: "Looking for your synced vaults",
      empty: "No synced vaults on this account yet.",
      lastSynced: (when: string) => `Last synced ${when}`,
      neverSynced: "Not synced yet",
      locationLabel: "Restore to",
      submit: "Restore vault",
      working: "Downloading your vault",
    },

    errors: {
      "vault-name-empty": "Give your vault a name.",
      "vault-name-invalid":
        'A vault name can\'t contain / \\ : * ? " < > | or end with a dot.',
      "vault-folder-not-empty":
        "There's already a folder with files in it under that name. Pick another name or location.",
      "vault-location-missing":
        "That location doesn't exist anymore. Choose another one.",
      unknown: "Something went wrong. Please try again.",
    } satisfies Record<VaultFolderError | "unknown", string>,
  },

  appearance: {
    title: "Choose how it looks",
    body: "You can change this any time in Settings.",
    options: {
      light: "Light",
      dark: "Dark",
      system: "Match system",
      tyrant: "Tyrant",
      bloodline: "Bloodline",
      citadel: "Citadel",
    },
    moreThemes: "More themes",
    fewerThemes: "Fewer themes",
  },

  sync: {
    title: "Take your vault everywhere",
    body: "Sync keeps your vault the same on every device.",
    // The next four lines are the approved "How sync works" copy from
    // Settings (SyncHelpDialog). Keep them in step.
    explainer: [
      "Netherstone syncs your vault through GitHub, where millions of people store their files.",
      "It's saved there as a private repository, a folder that keeps every earlier version of your files.",
      "Only you can see it, unless you invite someone on GitHub.",
      "A free GitHub account is all you need.",
    ],
    turnOn: "Turn on sync",
    working: "Setting up sync",
    done: "Sync is on. Your vault is backed up.",
    alreadyOn: "Sync is already on for this vault.",
    later: "You can turn it on later in Settings.",
  },

  ready: {
    title: "You're all set",
    bodyNewVault:
      "Your vault is ready.",
    bodyRestored: "Your vault is back and keeps syncing.",
    body: "Your vault is ready.",
    tips: {
      search: (shortcut: string) => `Press ${shortcut} to search across shards.`,
      blocks: "Type / in a shard to add headings, lists, tables and more.",
      canvas: "Switch to Canvas, in the bar on the far left, to sketch and draw.",
    },
    /** Offered for vaults that didn't just get the guide. */
    addGuide: "Add the Start here guide to this vault",
    finish: "Open Netherstone",
  },
};
