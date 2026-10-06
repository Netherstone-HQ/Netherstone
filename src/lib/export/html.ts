/**
 * HTML for every export: the HTML export itself (one self-contained file
 * with the shard's fonts, images and math inside), the page PDFs are
 * printed from, and the export window's preview.
 */

import katex from "katex";

import { cachedBase64, toBase64, type ImageMap } from "./assets";
import { HTML_FONT_FACES, type HtmlFontFace } from "./html-fonts";
import { KATEX_FONT_URLS, katexCss } from "./katex-assets";
import type { Block, ExportDocument, Inline, ListItem, TableCell, TextMarks } from "./model";
import type { ExportOptions } from "./options";
import { PREVIEW_SCRIPT, PRINT_READY_SCRIPT } from "./html-scripts";
import { CODE_TOKEN_STYLES, DARK_PALETTE, FONT_STACKS, PALETTE, bodySize, pageGeometry } from "./theme";

/**
 * - `web`: the HTML export, a page to read on screen (and print).
 * - `print`: the page the PDF is printed from.
 */
export type HtmlMode = "web" | "print";

export interface HtmlRenderOptions {
  images: ImageMap;
  options: ExportOptions;
  mode: HtmlMode;
  /** Reads a bundled asset URL (fonts) as bytes. */
  loadAsset: (url: string) => Promise<Uint8Array>;
  /** Document language for hyphenation and screen readers. */
  lang?: string;
}

// ── Escaping ────────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function safeHref(url: string) {
  return /^(https?:|mailto:|tel:|#)/i.test(url) || !/^[a-z][a-z0-9+.-]*:/i.test(url) ? url : "#";
}

// ── Inline content ──────────────────────────────────────────────────────────

function renderText(text: string, marks: TextMarks): string {
  let html = escapeHtml(text);
  if (marks.code) html = `<code>${html}</code>`;
  if (marks.kbd) html = `<kbd>${html}</kbd>`;
  if (marks.subscript) html = `<sub>${html}</sub>`;
  if (marks.superscript) html = `<sup>${html}</sup>`;
  if (marks.strikethrough) html = `<s>${html}</s>`;
  if (marks.underline) html = `<u>${html}</u>`;
  if (marks.italic) html = `<em>${html}</em>`;
  if (marks.bold) html = `<strong>${html}</strong>`;
  if (marks.highlight) html = `<mark>${html}</mark>`;

  const styles: string[] = [];
  if (marks.color) styles.push(`color:${marks.color}`);
  if (marks.backgroundColor) styles.push(`background-color:${marks.backgroundColor}`);
  if (styles.length) html = `<span class="tinted" style="${styles.join(";")}">${html}</span>`;
  return html;
}

function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode, output: "htmlAndMathml", throwOnError: true, strict: "ignore" });
  } catch {
    return `<code class="math-source">${escapeHtml(tex)}</code>`;
  }
}

function renderInlines(inlines: Inline[]): string {
  return inlines
    .map((inline) => {
      switch (inline.type) {
        case "text":
          return renderText(inline.text, inline.marks);
        case "link":
          return `<a href="${escapeHtml(safeHref(inline.url))}">${renderInlines(inline.children)}</a>`;
        case "mention":
          return `<span class="mention">${escapeHtml(inline.label)}</span>`;
        case "date":
          return `<span class="date">${escapeHtml(inline.text)}</span>`;
        case "math":
          return `<span class="math-inline">${renderMath(inline.tex, false)}</span>`;
        case "break":
          return "<br>";
      }
    })
    .join("");
}

// ── Blocks ──────────────────────────────────────────────────────────────────

function alignClass(align: string | undefined) {
  return align && align !== "left" ? ` class="align-${align}"` : "";
}

function renderListItem(item: ListItem, kind: string, images: ImageMap): string {
  const children = renderBlocks(item.children, images);
  const content = renderInlines(item.content) || "&#8203;";
  if (kind === "todo") {
    const state = item.checked ? "checked" : "unchecked";
    return `<li class="todo-item ${state}"><span class="checkbox" role="img" aria-label="${item.checked ? "Done" : "Not done"}"></span><div class="todo-text"><p>${content}</p>${children}</div></li>`;
  }
  return `<li><p>${content}</p>${children}</li>`;
}

function renderCell(cell: TableCell, images: ImageMap): string {
  const tag = cell.header ? "th" : "td";
  const span = `${cell.colSpan > 1 ? ` colspan="${cell.colSpan}"` : ""}${cell.rowSpan > 1 ? ` rowspan="${cell.rowSpan}"` : ""}`;
  const style = cell.background ? ` style="background-color:${cell.background}"` : "";
  return `<${tag}${span}${style}>${renderBlocks(cell.blocks, images)}</${tag}>`;
}

const MEDIA_LABELS = { video: "Video", audio: "Audio", file: "File", embed: "Embedded page" } as const;

const MEDIA_ICONS = {
  video: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/></svg>`,
  audio: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>`,
  file: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>`,
  embed: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`,
} as const;

function renderBlock(block: Block, images: ImageMap): string {
  switch (block.type) {
    case "heading":
      return `<h${block.level} id="${escapeHtml(block.id)}"${alignClass(block.align)}>${renderInlines(block.content)}</h${block.level}>`;
    case "paragraph": {
      const indent = block.indent ? ` style="margin-inline-start:${block.indent * 1.5}em"` : "";
      return `<p${alignClass(block.align)}${indent}>${renderInlines(block.content)}</p>`;
    }
    case "spacer":
      return `<div class="spacer" aria-hidden="true"></div>`;
    case "list": {
      const items = block.items.map((item) => renderListItem(item, block.kind, images)).join("");
      if (block.kind === "ordered") {
        const start = block.start !== 1 ? ` start="${block.start}"` : "";
        return `<ol${start} style="list-style-type:${block.style}">${items}</ol>`;
      }
      if (block.kind === "todo") return `<ul class="todo">${items}</ul>`;
      return `<ul style="list-style-type:${block.style}">${items}</ul>`;
    }
    case "quote":
      return `<blockquote>${renderBlocks(block.children, images)}</blockquote>`;
    case "callout":
      return `<aside class="callout"><span class="callout-icon" aria-hidden="true">${escapeHtml(block.icon)}</span><div class="callout-body">${renderBlocks(block.children, images)}</div></aside>`;
    case "toggle":
      return `<details class="toggle" open><summary>${renderInlines(block.summary)}</summary><div class="toggle-body">${renderBlocks(block.children, images)}</div></details>`;
    case "code": {
      const lines = block.lines
        .map((line) =>
          line
            .map((token) => {
              const text = escapeHtml(token.text);
              return token.scope ? `<span class="hl-${token.scope.split(".")[0]}">${text}</span>` : text;
            })
            .join(""),
        )
        .join("\n");
      const label = block.languageLabel ? `<figcaption>${escapeHtml(block.languageLabel)}</figcaption>` : "";
      return `<figure class="code">${label}<pre><code>${lines}\n</code></pre></figure>`;
    }
    case "math":
      return `<div class="math-block">${renderMath(block.tex, true)}</div>`;
    case "image": {
      const image = block.assetId ? images.get(block.assetId) : undefined;
      const caption = block.caption.length ? `<figcaption>${renderInlines(block.caption)}</figcaption>` : "";
      const align = ` image-${block.align ?? "center"}`;
      if (!image) {
        return `<figure class="image missing${align}"><div class="missing-box"><strong>Image not available</strong><span>${escapeHtml(block.source || "No source")}</span></div>${caption}</figure>`;
      }
      const width = block.width ?? image.width;
      const source = `data:${image.mime};base64,${cachedBase64(image.bytes)}`;
      return `<figure class="image${align}"><img src="${source}" alt="${escapeHtml(block.alt)}" width="${Math.round(width)}" height="${Math.round((width * image.height) / image.width)}" style="width:min(100%,${Math.round(width)}px)">${caption}</figure>`;
    }
    case "media": {
      const body = `<span class="media-icon">${MEDIA_ICONS[block.kind]}</span><span class="media-text"><span class="media-name">${escapeHtml(block.name)}</span><span class="media-meta">${MEDIA_LABELS[block.kind]}${block.isRemote ? ` · ${escapeHtml(block.url)}` : ""}</span></span>`;
      return block.isRemote
        ? `<a class="media-card" href="${escapeHtml(safeHref(block.url))}">${body}</a>`
        : `<div class="media-card">${body}</div>`;
    }
    case "table": {
      const total = block.columnWidths?.reduce((sum, width) => sum + width, 0) ?? 0;
      const colgroup = block.columnWidths && total
        ? `<colgroup>${block.columnWidths.map((width) => `<col style="width:${((width / total) * 100).toFixed(2)}%">`).join("")}</colgroup>`
        : "";
      const rows = block.rows.map((row) => `<tr>${row.map((cell) => renderCell(cell, images)).join("")}</tr>`).join("");
      return `<div class="table-wrap"><table>${colgroup}<tbody>${rows}</tbody></table></div>`;
    }
    case "columns": {
      const template = block.widths.map((width) => `${(width * 100).toFixed(3)}fr`).join(" ");
      const columns = block.columns.map((column) => `<div class="column">${renderBlocks(column, images)}</div>`).join("");
      return `<div class="columns" style="grid-template-columns:${template}">${columns}</div>`;
    }
    case "rule":
      return `<hr>`;
    case "toc": {
      if (!block.entries.length) return "";
      const minLevel = Math.min(...block.entries.map((entry) => entry.level));
      const links = block.entries
        .map((entry) => `<a href="#${escapeHtml(entry.id)}" style="padding-inline-start:${(entry.level - minLevel) * 1.25}em">${escapeHtml(entry.text)}</a>`)
        .join("");
      return `<nav class="toc" aria-label="Contents">${links}</nav>`;
    }
  }
}

function renderBlocks(blocks: Block[], images: ImageMap): string {
  return blocks.map((block) => renderBlock(block, images)).join("\n");
}

/** The `<article>` of a shard, without the page around it. */
export function renderHtmlBody(doc: ExportDocument, images: ImageMap): string {
  return `<article class="shard">\n${renderBlocks(doc.blocks, images)}\n</article>`;
}

// ── Styles ──────────────────────────────────────────────────────────────────

const DARK_CODE_COLORS: Record<string, string> = {
  keyword: "#ee6960",
  doctag: "#ee6960",
  "template-tag": "#ee6960",
  "template-variable": "#ee6960",
  type: "#ee6960",
  title: "#a77bfa",
  attr: "#6596cf",
  attribute: "#6596cf",
  literal: "#6596cf",
  meta: "#6596cf",
  number: "#6596cf",
  operator: "#6596cf",
  "selector-attr": "#6596cf",
  "selector-class": "#6596cf",
  "selector-id": "#6596cf",
  variable: "#6596cf",
  regexp: "#3593ff",
  string: "#3593ff",
  built_in: "#c3854e",
  symbol: "#c3854e",
  name: "#36a84f",
  quote: "#36a84f",
  "selector-tag": "#36a84f",
  "selector-pseudo": "#36a84f",
  subst: "#eeebe5",
  section: "#61a5f2",
  addition: "#ceead5",
  deletion: "#e7c7cb",
};

function codeTokenCss() {
  const light: string[] = [];
  const dark: string[] = [];
  for (const [scope, style] of Object.entries(CODE_TOKEN_STYLES)) {
    if (scope.includes(".")) continue;
    const rules = [
      style.color ? `color:${style.color}` : "",
      style.bold ? "font-weight:600" : "",
      style.italic ? "font-style:italic" : "",
    ].filter(Boolean);
    if (rules.length) light.push(`.hl-${scope}{${rules.join(";")}}`);
    const darkColor = DARK_CODE_COLORS[scope];
    if (darkColor) dark.push(`.hl-${scope}{color:${darkColor}}`);
  }
  return { light: light.join(""), dark: dark.join("") };
}

function paletteVars(palette: typeof PALETTE | typeof DARK_PALETTE) {
  return [
    `--paper:${palette.paper}`,
    `--ink:${palette.ink}`,
    `--muted:${palette.muted}`,
    `--rule:${palette.rule}`,
    `--rule-bar:${palette.ruleBar}`,
    `--surface:${palette.surface}`,
    `--code-surface:${palette.codeSurface}`,
    `--kbd-border:${palette.kbdBorder}`,
    `--link:${palette.link}`,
    `--highlight:${palette.highlight}`,
    `--table-header:${palette.tableHeader}`,
  ].join(";");
}

const PX_PER_MM = 96 / 25.4;

/** A CSS string literal. */
export function cssString(value: string) {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ");
  return `"${escaped}"`;
}

/** The shard's own styles: everything inside `.shard`, in em of the body size. */
function contentCss(code: { light: string }) {
  return `
*,*::before,*::after{box-sizing:border-box}
.shard{overflow-wrap:break-word;font-family:var(--body-font);color:var(--ink);line-height:var(--leading)}
.shard>:first-child{margin-top:0!important}
.shard p{margin:0;padding:.25em 0}
.shard .spacer{height:1.6em}
.shard h1,.shard h2,.shard h3,.shard h4,.shard h5,.shard h6{font-family:var(--heading-font);color:var(--ink);margin:0 0 .2em;line-height:1.25;text-wrap:balance;scroll-margin-top:1.5rem;break-after:avoid}
.shard h1{font-size:2.12em;font-weight:700;margin-top:1.15em;padding-bottom:.12em;letter-spacing:-.01em}
.shard h2{font-size:1.41em;font-weight:600;margin-top:1.15em;letter-spacing:-.015em}
.shard h3{font-size:1.18em;font-weight:600;margin-top:1em;letter-spacing:-.015em}
.shard h4,.shard h5{font-size:1.06em;font-weight:600;margin-top:.9em;letter-spacing:-.01em}
.shard h6{font-size:1em;font-weight:600;margin-top:.9em}
.align-center{text-align:center}.align-right{text-align:right}.align-justify{text-align:justify;hyphens:auto}
.shard a{color:var(--link);font-weight:500;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:.24em}
.shard strong{font-weight:700}
.shard code,.shard kbd{font-family:var(--mono-font);font-size:.82em}
.shard :not(pre)>code{background:var(--surface);border-radius:.35em;padding:.2em .3em;white-space:pre-wrap}
.shard kbd{border:1px solid var(--kbd-border);border-bottom-width:2px;border-radius:.25em;padding:.1em .4em;background:var(--code-surface)}
.shard mark{background:var(--highlight);color:inherit;border-radius:.15em;padding:0 .05em}
.mention,.date{display:inline-block;font-family:var(--heading-font);border-radius:.35em;background:var(--surface);padding:0 .45em;font-size:.82em;line-height:1.6;vertical-align:baseline}
.mention{font-weight:500}
.date{color:var(--muted)}
.shard ul,.shard ol{margin:0;padding-inline-start:1.5em}
.shard li>p{padding:.12em 0}
.shard ul.todo{list-style:none;padding-inline-start:0}
.todo-item{display:flex;gap:.6em;align-items:flex-start}
.todo-text{flex:1;min-width:0}
.checkbox{flex:none;width:.95em;height:.95em;margin-top:.42em;border:1.5px solid var(--muted);border-radius:.22em;position:relative}
.todo-item.checked .checkbox{background:var(--ink);border-color:var(--ink)}
.todo-item.checked .checkbox::after{content:"";position:absolute;left:.27em;top:.07em;width:.27em;height:.52em;border:solid var(--paper);border-width:0 2px 2px 0;transform:rotate(45deg)}
.todo-item.checked>.todo-text>p{color:var(--muted);text-decoration:line-through}
.shard blockquote{margin:.25em 0;padding-inline-start:1.4em;border-inline-start:2px solid var(--rule);font-style:italic}
.callout{display:grid;grid-template-columns:auto minmax(0,1fr);gap:.6em;margin:.4em 0;padding:.75em;background:var(--surface);border-radius:.3em;break-inside:avoid}
.callout-icon{font-size:1.06em;line-height:1.45;width:1.6em;text-align:center}
.callout-body{line-height:1.45}
.callout-body>p:first-child{padding-top:0}.callout-body>p:last-child{padding-bottom:0}
.toggle{margin:.25em 0}
.toggle>summary{cursor:pointer;padding:.25em 0;list-style-position:outside;margin-inline-start:1.2em}
.toggle>summary::marker{color:var(--muted)}
.toggle-body{padding-inline-start:1.4em}
.shard figure{margin:0}
.code{margin:.55em 0;background:var(--code-surface);border-radius:.4em;overflow:hidden;break-inside:avoid}
.code>figcaption{font-family:var(--heading-font);font-size:.72em;color:var(--muted);padding:.85em 1.4em 0}
.code pre{margin:0;padding:1em 1.25em;overflow-x:auto;font-family:var(--mono-font);font-size:.82em;line-height:1.55;tab-size:2}
.code>figcaption+pre{padding-top:.45em}
.code code{font-size:inherit}
${code.light}
.math-block{margin:.6em 0;overflow-x:auto;overflow-y:hidden;text-align:center;break-inside:avoid}
.math-inline .katex{font-size:1.05em}
.math-source{white-space:pre-wrap}
.image{margin:.8em 0;display:flex;flex-direction:column;align-items:center;break-inside:avoid}
.image-left{align-items:flex-start}.image-right{align-items:flex-end}
.image img{display:block;max-width:100%;height:auto;border-radius:.25em}
.image figcaption{margin-top:.5em;font-size:.82em;color:var(--muted);text-align:center}
.missing-box{display:flex;flex-direction:column;gap:.25em;width:100%;padding:1em;border:1px dashed var(--rule);border-radius:.4em;font-family:var(--heading-font);font-size:.82em;color:var(--muted);text-align:center;word-break:break-all}
.missing-box strong{color:var(--ink);font-weight:500}
.media-card{display:flex;align-items:center;gap:.75em;margin:.5em 0;padding:.7em .95em;border:1px solid var(--rule);border-radius:.4em;color:var(--ink);text-decoration:none!important;font-weight:400!important;font-family:var(--heading-font);break-inside:avoid}
.media-icon svg{display:block;width:1.2em;height:1.2em;fill:none;stroke:var(--muted);stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.media-text{display:flex;flex-direction:column;min-width:0}
.media-name{font-size:.88em;font-weight:500}
.media-meta{font-size:.76em;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.table-wrap{margin:.75em 0;overflow-x:auto}
.shard table{width:100%;border-collapse:collapse;font-size:.88em;line-height:1.5}
.shard th,.shard td{border:1px solid var(--rule);padding:.5em .75em;vertical-align:top;text-align:start}
.shard th{background:var(--table-header);font-family:var(--heading-font);font-weight:600;font-size:.94em}
.shard tr{break-inside:avoid}
.shard th>p,.shard td>p{padding:0}
.columns{display:grid;gap:1.5em;margin:.5em 0}
.column{min-width:0}
.shard hr{border:0;height:2px;background:var(--rule-bar);border-radius:2px;margin:1.4em 0}
.toc{display:flex;flex-direction:column;margin:.5em 0;padding:.25em 0}
.toc a{color:var(--muted)!important;text-decoration:none!important;font-weight:400!important;font-family:var(--heading-font);font-size:.88em;padding-block:.2em}
`;
}

function rootVars(palette: typeof PALETTE | typeof DARK_PALETTE, options: ExportOptions, size: string, leading: number) {
  return `${paletteVars(palette)};--body-font:${FONT_STACKS[options.typeface]};--heading-font:${FONT_STACKS.geist};--mono-font:${FONT_STACKS.mono};--leading:${leading};font-size:${size}`;
}

/** The HTML export: a column of text, light or dark. Prints light. */
function webCss(options: ExportOptions, code: { light: string; dark: string }) {
  const size = `${bodySize(options.textSize).px}px`;
  const light = rootVars(PALETTE, options, size, 1.625);
  const theme =
    options.theme === "dark"
      ? `:root{${rootVars(DARK_PALETTE, options, size, 1.625)};color-scheme:dark}${code.dark}`
      : `:root{${light};color-scheme:light}`;
  return `${theme}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%;background:var(--paper)}
body{margin:0;background:var(--paper);color:var(--ink);font-kerning:normal;text-rendering:optimizeLegibility;-webkit-font-smoothing:antialiased}
.shard{max-width:41em;margin:0 auto;padding:4.5em 1.5em 6em}
a.media-card:hover{background:var(--surface)}
.toc a:hover{color:var(--ink)!important;text-decoration:underline!important}
@media (max-width:640px){.shard{padding:2.5em 1.25em 4em}.columns{grid-template-columns:1fr!important}}
@media print{:root{${light};font-size:${bodySize(options.textSize).pt}pt}${code.light}html,body{background:#fff}.shard{max-width:none;padding:0}.table-wrap,.code pre,.math-block{overflow:visible}.code pre{white-space:pre-wrap}}`;
}

/** What paper looks like: the PDF's print page and the paged preview share it. */
function paperBaseCss(options: ExportOptions) {
  const vars = rootVars(PALETTE, options, `${bodySize(options.textSize).pt}pt`, 1.55);
  return `:root{${vars};color-scheme:light}
body{margin:0;background:#fff;color:var(--ink);font-kerning:normal;-webkit-font-smoothing:antialiased}
.table-wrap,.code pre,.math-block{overflow:visible}
.code pre{white-space:pre-wrap}`;
}

/** The page the PDF is printed from. */
function printCss(options: ExportOptions, title: string) {
  const page = pageGeometry(options.pageSize, options.margins);
  const footerText = `font-family:${FONT_STACKS.geist};font-size:7.5pt;color:${PALETTE.muted};vertical-align:middle`;
  const footer = options.pageNumbers
    ? `@bottom-left{content:${cssString(title)};${footerText}}@bottom-right{content:counter(page) " / " counter(pages);${footerText}}`
    : "";
  return `${paperBaseCss(options)}
@page{size:${page.widthMm}mm ${page.heightMm}mm;margin:${page.marginTopMm}mm ${page.marginRightMm}mm ${page.marginBottomMm}mm ${page.marginLeftMm}mm;${footer}}
html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}`;
}

/** Sheets of paper drawn in the export window, one per printed page. */
function pagesPreviewCss(options: ExportOptions) {
  const page = pageGeometry(options.pageSize, options.margins);
  const px = (mm: number) => Math.round(mm * PX_PER_MM * 100) / 100;
  const contentWidth = px(page.widthMm - page.marginLeftMm - page.marginRightMm);
  const contentHeight = px(page.heightMm - page.marginTopMm - page.marginBottomMm);
  return `${paperBaseCss(options)}
:root{--page-width:${px(page.widthMm)}px;--page-height:${px(page.heightMm)}px;--content-width:${contentWidth}px;--content-height:${contentHeight}px;--margin-top:${px(page.marginTopMm)}px;--margin-left:${px(page.marginLeftMm)}px;--margin-right:${px(page.marginRightMm)}px;--margin-bottom:${px(page.marginBottomMm)}px;--column-gap:48px}
html{overflow-x:hidden}
body{background:transparent}
.flow{position:absolute;top:0;left:0;width:var(--content-width);height:var(--content-height);column-width:var(--content-width);column-gap:var(--column-gap);column-fill:auto;visibility:hidden}
.pages{display:flex;flex-direction:column;align-items:center;gap:20px;padding:24px 0 32px;zoom:var(--zoom,1)}
.page{position:relative;width:var(--page-width);height:var(--page-height);background:#fff;box-shadow:0 1px 2px rgb(20 21 22/.12),0 4px 16px rgb(20 21 22/.08);overflow:hidden;flex:none}
.page-body{position:absolute;left:var(--margin-left);top:var(--margin-top);width:var(--content-width);height:var(--content-height);overflow:hidden}
.page-body>.flow{visibility:visible}
.page-footer{position:absolute;left:var(--margin-left);right:var(--margin-right);bottom:0;height:var(--margin-bottom);display:flex;align-items:center;justify-content:space-between;gap:24px;font-family:var(--heading-font);font-size:7.5pt;color:var(--muted)}
.page-footer span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`;
}

export interface PreviewLook {
  /** The stylesheet for these options. */
  css: string;
  layout: "pages" | "web";
  pageNumbers: boolean;
}

/**
 * How the export window's preview should look for `options`. The preview
 * loads once and applies each new look in place (see PREVIEW_SCRIPT).
 */
export function previewLook(options: ExportOptions): PreviewLook {
  const code = codeTokenCss();
  if (options.format === "html") {
    return { css: webCss(options, code), layout: "web", pageNumbers: false };
  }
  return { css: pagesPreviewCss(options), layout: "pages", pageNumbers: options.pageNumbers };
}

// ── Fonts ───────────────────────────────────────────────────────────────────

function usedCodePoints(doc: ExportDocument): Set<number> {
  const points = new Set<number>();
  const json = JSON.stringify(doc.blocks) + doc.title;
  for (const character of json) points.add(character.codePointAt(0)!);
  return points;
}

function parseUnicodeRange(range: string): [number, number][] {
  return range.split(",").map((part) => {
    const [start, end] = part.trim().replace(/^U\+/i, "").split("-");
    return [parseInt(start, 16), parseInt(end ?? start, 16)];
  });
}

/** The font files a document needs: its families, in the scripts it uses. */
export function selectFontFaces(doc: ExportDocument, options: Pick<ExportOptions, "typeface">): HtmlFontFace[] {
  const families = new Set<string>(["Geist"]);
  if (options.typeface === "newsreader") families.add("Newsreader");
  const json = JSON.stringify(doc.blocks);
  if (json.includes('"code"') || json.includes('"kbd"')) families.add("Geist Mono");

  const points = usedCodePoints(doc);
  return HTML_FONT_FACES.filter((face) => {
    if (!families.has(face.family)) return false;
    if (face.subset === "latin") return true;
    const ranges = parseUnicodeRange(face.unicodeRange);
    for (const point of points) {
      if (point < 0x80) continue;
      if (ranges.some(([start, end]) => point >= start && point <= end)) return true;
    }
    return false;
  });
}

/** Fonts are read and encoded once, not on every preview. */
const fontDataCache = new Map<string, Promise<string>>();

function fontData(url: string, loadAsset: HtmlRenderOptions["loadAsset"]) {
  let data = fontDataCache.get(url);
  if (!data) {
    data = loadAsset(url).then(toBase64);
    data.catch(() => fontDataCache.delete(url));
    fontDataCache.set(url, data);
  }
  return data;
}

async function fontFaceCss(faces: HtmlFontFace[], loadAsset: HtmlRenderOptions["loadAsset"]) {
  const rules = await Promise.all(
    faces.map(async (face) => {
      const data = await fontData(face.url, loadAsset);
      return `@font-face{font-family:"${face.family}";font-style:${face.style};font-weight:${face.weight};font-display:block;src:url(data:font/woff2;base64,${data}) format("woff2");unicode-range:${face.unicodeRange}}`;
    }),
  );
  return rules.join("\n");
}

const KATEX_FAMILY_MARKERS: [RegExp, RegExp][] = [
  [/KaTeX_(Main|Math|Size\d)/, /./],
  [/KaTeX_AMS/, /\b(amsrm|mathbb|textbb)\b/],
  [/KaTeX_Caligraphic/, /\b(mathcal|textcal|cal)\b/],
  [/KaTeX_Fraktur/, /\b(mathfrak|textfrak|frak)\b/],
  [/KaTeX_SansSerif/, /\b(mathsf|textsf|mathboldsf|textboldsf|mathitsf|textitsf)\b/],
  [/KaTeX_Script/, /\b(mathscr|textscr)\b/],
  [/KaTeX_Typewriter/, /\b(mathtt|texttt)\b/],
];

/** KaTeX's stylesheet with only the fonts this document's math uses. */
async function mathCss(bodyHtml: string, loadAsset: HtmlRenderOptions["loadAsset"]) {
  const faces = katexCss.match(/@font-face\{[^}]*\}/g) ?? [];
  const rest = katexCss.replace(/@font-face\{[^}]*\}/g, "");
  const kept = await Promise.all(
    faces.map(async (face) => {
      const marker = KATEX_FAMILY_MARKERS.find(([family]) => family.test(face));
      if (!marker || !marker[1].test(bodyHtml)) return "";
      const file = /url\(fonts\/([^)]+\.woff2)\)/.exec(face)?.[1];
      const url = file && KATEX_FONT_URLS[file];
      if (!url) return "";
      const data = await fontData(url, loadAsset);
      return face.replace(/src:[^;}]+/, `src:url(data:font/woff2;base64,${data}) format("woff2")`);
    }),
  );
  return kept.join("") + rest;
}

// ── Document ────────────────────────────────────────────────────────────────

function documentShell(doc: ExportDocument, lang: string | undefined, head: string, body: string, rootAttributes = "") {
  return `<!doctype html>
<html lang="${escapeHtml(lang ?? "en")}"${rootAttributes}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${head}<meta name="generator" content="Netherstone">
<title>${escapeHtml(doc.title)}</title>
</head>
<body>
${body}
</body>
</html>
`;
}

async function sharedCss(doc: ExportDocument, article: string, typefaces: ExportOptions["typeface"][], loadAsset: HtmlRenderOptions["loadAsset"]) {
  const faces = new Map<string, HtmlFontFace>();
  for (const typeface of typefaces) {
    for (const face of selectFontFaces(doc, { typeface })) faces.set(face.url, face);
  }
  const [fontCss, katexStyles] = await Promise.all([
    fontFaceCss([...faces.values()], loadAsset),
    doc.hasMath ? mathCss(article, loadAsset) : Promise.resolve(""),
  ]);
  return `${fontCss}
${katexStyles}
${contentCss(codeTokenCss())}`;
}

/** The HTML export (`web`) or the page a PDF is printed from (`print`). */
export async function renderHtmlDocument(doc: ExportDocument, render: HtmlRenderOptions): Promise<string> {
  const { options, mode } = render;
  const article = renderHtmlBody(doc, render.images);
  const shared = await sharedCss(doc, article, [options.typeface], render.loadAsset);

  if (mode === "print") {
    return documentShell(
      doc,
      render.lang,
      `<style>
${shared}
${printCss(options, doc.title)}
</style>
`,
      `${article}
<script>${PRINT_READY_SCRIPT}</script>`,
    );
  }

  return documentShell(
    doc,
    render.lang,
    `<meta name="color-scheme" content="${options.theme}">
<style>
${shared}
${webCss(options, codeTokenCss())}
</style>
`,
    article,
  );
}

/**
 * The export window's preview, loaded once. It carries both typefaces, so
 * any later change of options is a new stylesheet, not a new document.
 */
export async function renderPreviewDocument(
  doc: ExportDocument,
  render: Omit<HtmlRenderOptions, "mode">,
): Promise<string> {
  const { options } = render;
  const article = renderHtmlBody(doc, render.images);
  const shared = await sharedCss(doc, article, ["newsreader", "geist"], render.loadAsset);
  const look = previewLook(options);

  return documentShell(
    doc,
    render.lang,
    `<style>
${shared}
</style>
<style id="look">${look.css}</style>
`,
    `<div class="flow" id="flow">${article}</div>
<div class="pages" id="pages"></div>
<script>${PREVIEW_SCRIPT}</script>`,
    ` data-layout="${look.layout}" data-page-numbers="${look.pageNumbers}" data-title="${escapeHtml(doc.title)}"`,
  );
}
