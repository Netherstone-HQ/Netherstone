import { textToParagraphs } from "../nodes";
import type { Importer } from "../types";
import { decodeText } from "./decode-text";

/** Plain text: blank lines start paragraphs, single line breaks stay. */
export const textImporter: Importer = {
  label: "Text",
  extensions: ["txt", "text"],
  async convert(file) {
    return { nodes: textToParagraphs(decodeText(await file.read())) };
  },
};
