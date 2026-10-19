// @vitest-environment jsdom
import { beforeAll, describe, expect, it } from "vitest";

import { memoryImport } from "@/test/import";

import type { PageData, TextPiece } from "./extract";
import { layoutPages } from "./layout";

/**
 * A one-page PDF in the standard fonts. `lines` are [font, size, x, y, text]
 * with y from the top of a US Letter page.
 */
function pdfFile(lines: [("F1" | "F2"), number, number, number, string][], links: { rect: number[]; url: string }[] = []) {
  const height = 792;
  const content = lines
    .map(([font, size, x, y, text]) => `BT /${font} ${size} Tf ${x} ${height - y} Td (${text.replace(/[()\\]/g, "\\$&").replace(/\u2022/g, "\\225")}) Tj ET`)
    .join("\n");
  const annotations = links.map(
    (link) => `<< /Type /Annot /Subtype /Link /Rect [${link.rect.join(" ")}] /Border [0 0 0] /A << /S /URI /URI (${link.url}) >> >>`,
  );
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 ${height}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R${
      annotations.length ? ` /Annots [${annotations.map((_, index) => `${7 + index} 0 R`).join(" ")}]` : ""
    } >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ...annotations,
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = out.length;
    out += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

// jsdom has no workers, so pdf.js parses on this thread.
beforeAll(async () => {
  (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
});

describe("PDF import", () => {
  it("rebuilds headings, paragraphs, lists and links from the layout", async () => {
    const bytes = pdfFile(
      [
        ["F2", 22, 72, 80, "Quarterly report"],
        ["F1", 11, 72, 120, "The year started slowly, but sales picked up once the new shop opened in"],
        ["F1", 11, 72, 134, "March. Read the details on our site."],
        ["F2", 15, 72, 170, "Next steps"],
        ["F1", 11, 72, 200, "• Hire two people"],
        ["F1", 11, 72, 216, "• Open a second shop"],
      ],
      [{ rect: [70, 654, 300, 668], url: "https://example.com" }],
    );
    const vault = memoryImport({ "Report.pdf": bytes });
    const report = await vault.run();

    expect(report.failed).toEqual([]);
    expect(vault.shards.get("/vault/Report.md")).toBe(
      [
        "# Quarterly report",
        "",
        "The year started slowly, but sales picked up once the new shop opened in [March. Read the details on our site.](https://example.com/)",
        "",
        "## Next steps",
        "",
        "- Hire two people",
        "- Open a second shop",
        "",
      ].join("\n"),
    );
  });

  it("says when a file isn't a PDF", async () => {
    const vault = memoryImport({ "Broken.pdf": "not a pdf" });
    const report = await vault.run();
    expect(report.failed[0].error).toBe("This file isn't a PDF Netherstone can read, or it's damaged.");
  });
});

describe("PDF layout", () => {
  const piece = (text: string, x: number, y: number, options: Partial<TextPiece> = {}): TextPiece => ({
    text,
    x,
    y,
    width: text.length * 5.5,
    size: 11,
    bold: false,
    italic: false,
    mono: false,
    ...options,
  });
  const page = (pieces: TextPiece[]): PageData => ({ width: 612, height: 792, pieces, pictures: [], marks: [] });

  it("finds tables from columns that line up", () => {
    const rows = [
      ["Name", "Role", "Since"],
      ["Ada", "Engineer", "2019"],
      ["Grace", "Admiral", "1943"],
    ];
    const pieces = rows.flatMap((row, index) =>
      row.map((text, column) => piece(text, 72 + column * 150, 100 + index * 18, { bold: index === 0 })),
    );
    const { nodes } = layoutPages([page([piece("People we admire.", 72, 70), ...pieces])]);
    const tableNode = nodes.find((node) => node.type === "table") as { children: { children: unknown[] }[] } | undefined;

    expect(tableNode?.children).toHaveLength(3);
    expect(tableNode?.children[0].children).toHaveLength(3);
  });

  it("drops page numbers repeated on every page", () => {
    const pages = [1, 2, 3].map((number) =>
      page([piece(`Text on page ${number}.`, 72, 100), piece(String(number), 300, 760)]),
    );
    const { nodes } = layoutPages(pages);
    const text = JSON.stringify(nodes);

    expect(text).toContain("Text on page 3.");
    expect(text).not.toMatch(/"text":"[123]"/);
  });
});
