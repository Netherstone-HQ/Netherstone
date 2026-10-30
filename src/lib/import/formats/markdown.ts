import { encodeShardLinkPath } from "@/lib/markdown-shard-links";

import type { ImportContext, Importer } from "../types";
import { decodeText } from "./decode-text";

/**
 * Markdown from other apps stays Markdown; only what Netherstone writes
 * differently is rewritten:
 *
 * - `[[Note]]`, `[[Note|label]]` and `[[Note#Heading]]` become @ links to the
 *   imported shard, or plain text when that note wasn't imported.
 * - `![[picture.png]]`, `![](picture.png)` and the `src` of `<img>`,
 *   `<audio>`, `<video>` and `<file>` copy the file into the vault's
 *   attachments; `![[Note]]` becomes a link to that note.
 * - Links to other imported files point at their new shards; links to notes
 *   that weren't imported become plain text.
 * - Obsidian callouts (`> [!tip] Title`) keep their form, which the editor
 *   reads as callouts; links inside them are rewritten like any other.
 * - `==text==` is highlighted, `%%comments%%` and `^block-ids` are dropped.
 *
 * Code blocks and inline code are never touched.
 */
export const markdownImporter: Importer = {
  label: "Markdown",
  extensions: ["md", "markdown", "mdown", "mkd"],
  async convert(file, context) {
    const source = decodeText(await file.read()).replace(/\r\n?/g, "\n");
    return { markdown: await convertMarkdown(source, context) };
  },
};

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "tif", "tiff"]);
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** The `src` of a media tag Netherstone or another app wrote, `<img src="…"`. */
const MEDIA_SRC = /(<(?:img|audio|video|source|file)\b[^>]*?\ssrc=)("[^"]*"|'[^']*')/gi;

function extension(target: string) {
  const clean = target.split(/[?#]/)[0];
  const dot = clean.lastIndexOf(".");
  return dot > clean.lastIndexOf("/") ? clean.slice(dot + 1).toLowerCase() : "";
}

function baseName(target: string) {
  const clean = target.replace(/\\/g, "/");
  const name = clean.slice(clean.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function escapeLabel(label: string) {
  return label.replace(/([[\]\\])/g, "\\$1");
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/** Runs `replace` on the parts of a line outside inline code spans. */
async function outsideCode(line: string, replace: (part: string) => Promise<string>) {
  const parts = line.split(/(`+[^`]*`+)/);
  const out: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    out.push(index % 2 === 1 ? parts[index] : await replace(parts[index]));
  }
  return out.join("");
}

async function replaceAsync(
  value: string,
  pattern: RegExp,
  replacer: (match: RegExpExecArray) => Promise<string>,
) {
  let result = "";
  let last = 0;
  for (const match of value.matchAll(pattern)) {
    result += value.slice(last, match.index) + (await replacer(match as RegExpExecArray));
    last = match.index! + match[0].length;
  }
  return result + value.slice(last);
}

export async function convertMarkdown(source: string, context: ImportContext): Promise<string> {
  const lines = source.split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  let inFrontMatter = lines[0] === "---";
  let missingLinks = 0;

  const embed = async (target: string, size: string | undefined, wholeLine: boolean) => {
    const ext = extension(target);
    if (!ext || ext === "md") {
      const linkTarget = context.linkTo(target.split("#")[0]);
      if (linkTarget) return `[${escapeLabel(baseName(target))}](${linkTarget})`;
      missingLinks += 1;
      return baseName(target);
    }
    const link = await context.attachRelated(target);
    if (!link) return `![[${target}]]`;
    const src = encodeShardLinkPath(link);
    if (IMAGE_EXTENSIONS.has(ext)) {
      const width = size && /^\d+/.exec(size)?.[0];
      return width ? `<img src="${escapeAttribute(link)}" width="${width}" />` : `![](${src})`;
    }
    const name = baseName(target) + (ext ? `.${ext}` : "");
    return wholeLine
      ? `<file name="${escapeAttribute(name)}" src="${escapeAttribute(link)}" />`
      : `[${escapeLabel(name)}](${src})`;
  };

  const rewrite = async (part: string, wholeLine: string) => {
    let value = part;

    // <img src="_attachments/x.png" />, <audio src="…" />, …
    value = await replaceAsync(value, MEDIA_SRC, async (match) => {
      const [whole, before, quoted] = match;
      const target = quoted.slice(1, -1).replace(/&quot;/g, '"').replace(/&amp;/g, "&");
      if (!target || URL_SCHEME.test(target) || target.startsWith("/") || target.startsWith("#")) return whole;
      const link = await context.attachRelated(target.split(/[?#]/)[0]);
      return link ? `${before}"${escapeAttribute(link)}"` : whole;
    });

    // ![alt](relative/picture.png) and [label](relative/file)
    value = await replaceAsync(
      value,
      /(!?)\[((?:\\.|[^\]\\])*)\]\(\s*(<[^>]*>|[^)\s]+)((?:\s+"[^"]*")?)\s*\)/g,
      async (match) => {
        const [whole, bang, label, rawTarget, title] = match;
        const target = rawTarget.replace(/^<|>$/g, "");
        if (!target || URL_SCHEME.test(target) || target.startsWith("#") || target.startsWith("/")) return whole;
        const pathOnly = target.split("#")[0];
        if (!bang) {
          const linkTarget = context.linkTo(pathOnly);
          if (linkTarget) return `[${label}](${linkTarget}${title})`;
          if (!extension(pathOnly) || extension(pathOnly) === "md") {
            missingLinks += 1;
            return label;
          }
        }
        const link = await context.attachRelated(pathOnly);
        if (!link) return whole;
        return `${bang}[${label}](${encodeShardLinkPath(link)}${title})`;
      },
    );

    // ![[file|size]], then [[note]] below. They come last so the links and
    // tags they write aren't read again.
    value = await replaceAsync(value, /!\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g, (match) =>
      embed(match[1].trim(), match[2]?.trim(), wholeLine.trim() === match[0]),
    );

    // [[note#heading|label]]
    value = await replaceAsync(value, /\[\[([^\]|]+?)(?:\|([^\]]*))?\]\]/g, async (match) => {
      const [note, heading] = match[1].split("#");
      const label = (match[2] ?? "").trim() || (note.trim() ? baseName(note.trim()) : heading?.trim() ?? "");
      if (!note.trim()) return label;
      const linkTarget = context.linkTo(note.trim());
      if (!linkTarget) {
        missingLinks += 1;
        return label;
      }
      return `[${escapeLabel(label)}](${linkTarget})`;
    });

    value = value
      .replace(/==(?=\S)([^=]+?)(?<=\S)==/g, "<mark>$1</mark>")
      .replace(/ ?%%.*?%%/g, "")
      .replace(/\s\^[A-Za-z0-9-]+\s*$/, "");
    return value;
  };

  let callout: { indent: string; lines: string[]; type: string; title: string } | null = null;
  const flushCallout = () => {
    if (!callout) return;
    const { indent, type, title } = callout;
    out.push(`${indent}> [!${type}]${title ? ` ${title}` : ""}`);
    for (const line of callout.lines) out.push(line ? `${indent}> ${line}` : `${indent}>`);
    callout = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (inFrontMatter) {
      out.push(line);
      if (index > 0 && line === "---") inFrontMatter = false;
      continue;
    }

    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) fence = null;
      (callout ? callout.lines : out).push(callout ? line.replace(/^\s*>\s?/, "") : line);
      continue;
    }

    if (callout) {
      const quoted = /^(\s*)>\s?(.*)$/.exec(line);
      if (quoted && quoted[1] === callout.indent) {
        const inner = quoted[2];
        const innerFence = /^\s*(`{3,}|~{3,})/.exec(inner);
        if (innerFence) {
          fence = innerFence[1];
          callout.lines.push(inner);
        } else {
          callout.lines.push(await outsideCode(inner, (part) => rewrite(part, inner)));
        }
        continue;
      }
      flushCallout();
    }

    if (fenceMatch) {
      fence = fenceMatch[1];
      out.push(line);
      continue;
    }

    const calloutStart = /^(\s*)>\s*\[!([A-Za-z-]+)\][+-]?\s*(.*)$/.exec(line);
    if (calloutStart) {
      callout = {
        indent: calloutStart[1],
        lines: [],
        type: calloutStart[2],
        title: await outsideCode(calloutStart[3].trim(), (part) => rewrite(part, calloutStart[3])),
      };
      continue;
    }

    out.push(await outsideCode(line, (part) => rewrite(part, line)));
    if (index % 500 === 499) await context.checkpoint();
  }
  flushCallout();

  if (missingLinks > 0) {
    context.warn(
      missingLinks === 1
        ? "1 link points to a note that wasn't imported; it's plain text now."
        : `${missingLinks} links point to notes that weren't imported; they're plain text now.`,
    );
  }

  return out.join("\n");
}
