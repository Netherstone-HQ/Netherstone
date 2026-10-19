import { ImportError, type Importer } from "../../types";
import { extractPages } from "./extract";
import { layoutPages } from "./layout";

/**
 * PDFs, rebuilt as documents from how their text is laid out (see
 * `layout.ts`): headings, paragraphs, lists, code, bold, italic, links and
 * pictures. Scanned PDFs have no text, only pictures of pages; those come in
 * as pictures, and the summary says so.
 */
export const pdfImporter: Importer = {
  label: "PDF",
  extensions: ["pdf"],
  async convert(file, context) {
    const { pages, failedPictures } = await extractPages(await file.read(), context, (page, total) =>
      context.report(`Page ${page} of ${total}`),
    );
    if (!pages.length) throw new ImportError("This PDF has no pages.");

    const { nodes, hasText } = layoutPages(pages);
    if (!hasText) {
      if (!nodes.length) throw new ImportError("This PDF has no text or pictures to import.");
      context.warn("This PDF is scanned pages, so it came in as pictures and its text can't be searched.");
    }
    if (failedPictures) {
      context.warn(
        failedPictures === 1
          ? "1 picture couldn't be read and was left out."
          : `${failedPictures} pictures couldn't be read and were left out.`,
      );
    }
    return { nodes };
  },
};
