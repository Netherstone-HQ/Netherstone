import { ImportError, type Importer } from "../types";

/**
 * Formats people will try that Netherstone can't read yet, so the summary
 * says what to do instead of just skipping them.
 */
export const unsupportedImporters: Importer[] = [
  {
    label: "Old Word",
    extensions: ["doc"],
    convert: async () => {
      throw new ImportError("Old Word files (.doc) can't be imported. Open it in Word and save it as .docx first.");
    },
  },
  {
    label: "Pages",
    extensions: ["pages"],
    convert: async () => {
      throw new ImportError("Pages files can't be imported. In Pages, choose File > Export To > Word, then import that.");
    },
  },
];
