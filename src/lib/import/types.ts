/**
 * The import engine turns files from other apps into shards.
 *
 * Each format has an importer (see `formats/`) that reads one file and
 * returns either a Plate value or finished Markdown. Importers never touch
 * the vault themselves: everything they need from outside (images to store,
 * files next to the one being read, links to other imported files) comes
 * through the `ImportContext` the engine gives them. That keeps every
 * importer a plain function that tests can run on a file in memory, and lets
 * the same engine serve the Import window, the outside-the-vault prompt or a
 * future API.
 */

/** A Plate node, loosely typed: importers build them by hand. */
export type PlateNode = {
  type?: string;
  text?: string;
  children?: PlateNode[];
  [key: string]: unknown;
};

/** One file being imported. */
export interface ImportFile {
  /** File name with extension, `Report.docx`. */
  name: string;
  /** Path from the picked folder's parent, `Notes/Report.docx`. */
  relativePath: string;
  /** Lowercase extension without the dot, `docx`. */
  extension: string;
  size: number;
  read(): Promise<Uint8Array>;
}

export interface ImportContext {
  readonly file: ImportFile;
  /**
   * Stores a file (an image, a PDF a page links to) in the vault's
   * attachments and returns the link the shard should use for it.
   */
  addAttachment(name: string, bytes: Uint8Array): Promise<string>;
  /**
   * Stores a file the one being imported refers to (an image next to it),
   * found by the path written in it or by name alone as Obsidian-style
   * embeds do, and returns its link. Null when there is no such file.
   */
  attachRelated(target: string): Promise<string | null>;
  /**
   * The link to write for `target` when it names another file in the same
   * import: that file's new shard, relative to this one. Null otherwise.
   */
  linkTo(target: string): string | null;
  /** Says where a long file is up to (`Page 3 of 40`), shown while it imports. */
  report(detail: string): void;
  /** Records something the import could not carry over, shown in the summary. */
  warn(message: string): void;
  /**
   * Gives the window a moment to paint and respond. Long importers call it
   * between pages or every few hundred blocks. Throws once cancelled.
   */
  checkpoint(): Promise<void>;
}

export type ImportOutput =
  | { nodes: PlateNode[]; markdown?: undefined }
  | { markdown: string; nodes?: undefined };

export interface Importer {
  /** Names the format in the summary and the Import window: `Word`. */
  label: string;
  /** Lowercase extensions without the dot. */
  extensions: string[];
  convert(file: ImportFile, context: ImportContext): Promise<ImportOutput>;
}

/** Thrown inside importers for problems with the file itself, shown as is. */
export class ImportError extends Error {}
