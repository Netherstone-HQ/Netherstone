// Every word the dialogs for Netherstone links show, in one place so it can
// be read and edited on its own.

export const copy = {
  /** Read out by screen readers while the link is looked up. */
  listing: "Opening in Netherstone",

  template: {
    title: (name: string) => `Add ${name}`,
    from: "A template from netherstone.app",
    downloading: (name: string) => `Downloading ${name}…`,
  },

  folder: {
    title: (name: string) => `Open ${name}`,
    shards: (count: number) => (count === 1 ? "1 shard" : `${count} shards`),
    pictures: (count: number) => (count === 1 ? "1 picture" : `${count} pictures`),
    leftOut: (count: number) =>
      count === 1 ? "1 other file left out" : `${count} other files left out`,
    warning: "Not a Netherstone template. Open it if you trust where it came from",
    downloading: {
      shards: (done: number, total: number) => `Downloading ${done} of ${total} shards…`,
      pictures: (done: number, total: number) => `Downloading ${done} of ${total} pictures…`,
    },
    adding: (done: number, total: number) => `Adding ${done} of ${total} shards…`,
    cancel: "Cancel",
  },

  refused: {
    ok: "OK",
    updateFirst: {
      title: "Update Netherstone first",
      body: (name: string | null, version: string | null) =>
        `${name ?? "This template"} needs ${version ? `Netherstone ${version} or later` : "a newer Netherstone"}`,
      notNow: "Not now",
      update: "Update",
    },
    templateNotFound: {
      title: "Template not found",
      body: "It may have been renamed or removed from netherstone.app",
    },
    notEnoughSpace: {
      title: "Not enough space",
      body: (name: string, needed: string, folder: string, free: string) =>
        `${name} needs ${needed} and ${folder} has ${free} free`,
    },
    cantOpen: {
      title: "Can't open that folder",
      body: "It may be private, renamed or gone",
    },
    nothingToOpen: {
      title: "Nothing to open",
      body: "That folder has no Markdown files in it",
    },
    tooManyFiles: {
      title: "Too many files to list",
      body: "Link to a smaller folder inside it instead",
    },
    downloadFailed: {
      title: (name: string | null) => (name ? `Couldn't download ${name}` : "Couldn't download that"),
      body: "Check the connection and try again",
    },
  },
};
