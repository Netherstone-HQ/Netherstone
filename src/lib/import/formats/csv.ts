import { ImportError, type Importer } from "../types";
import { paragraph, table, text } from "../nodes";
import { decodeText } from "./decode-text";
import { IMPORT_FORMATS } from "./list";

/** Rows of a CSV (or TSV) file, quotes and line breaks in quotes included. */
export function parseDelimited(source: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "") {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/** Guesses the delimiter from the first line: the one it has most of. */
function sniffDelimiter(source: string, extension: string) {
  if (extension === "tsv") return "\t";
  const firstLine = source.slice(0, source.search(/\r?\n|$/));
  const counts = [",", ";", "\t"].map((d) => [d, firstLine.split(d).length] as const);
  return counts.sort((a, b) => b[1] - a[1])[0][0];
}

/** A spreadsheet export becomes a table, its first row the header. */
export const csvImporter: Importer = {
  ...IMPORT_FORMATS.csv,
  async convert(file) {
    const source = decodeText(await file.read());
    const rows = parseDelimited(source, sniffDelimiter(source, file.extension));
    if (rows.length === 0) throw new ImportError("This file has no rows.");

    const width = Math.max(...rows.map((cells) => cells.length));
    const cell = (value: string, header: boolean) => ({
      header,
      children: [paragraph([text(value.trim())])],
    });

    return {
      nodes: [
        table(
          rows.map((cells, rowIndex) =>
            Array.from({ length: width }, (_, col) => cell(cells[col] ?? "", rowIndex === 0)),
          ),
        ),
      ],
    };
  },
};
