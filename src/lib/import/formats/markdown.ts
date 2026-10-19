import { encodeShardLinkPath } from "@/lib/markdown-shard-links";

import type { ImportContext, Importer } from "../types";
import { decodeText } from "./decode-text";

/**
 * Markdown from other apps stays Markdown; only what Netherstone writes
 * differently is rewritten:
 *
 * - `[[Note]]`, `[[Note|label]]` and `[[Note#Heading]]` become @ links to the
 *   imported shard, or plain text when that note wasn't imported.
 * - `![[picture.png]]` and `![](picture.png)` copy the picture into the
 *   vault's attachments; `![[Note]]` becomes a link to that note.
 * - Links to other imported files point at their new shards.
 * - Obsidian callouts (`> [!tip] Title`) become callouts, `==text==` is
 *   highlighted, `%%comments%%` and `^block-ids` are dropped.
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

const CALLOUT_ICONS: Record<string, string> = {
  note: "📝",
  info: "ℹ️",
  todo: "☑️",
  abstract: "📌",
  summary: "📌",
  tldr: "📌",
  tip: "💡",
  hint: "💡",
  important: "💡",
  success: "✅",
  check: "✅",
  done: "✅",
  question: "❓",
  help: "❓",
  faq: "❓",
  warning: "⚠️",
  caution: "⚠️",
  attention: "⚠️",
  failure: "❌",
  fail: "❌",
  missing: "❌",
  danger: "🚫",
  error: "🚫",
  bug: "🐞",
  example: "📋",
  quote: "💬",
  cite: "💬",
};

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
  let missingFiles = 0;

  const embed = async (target: string, size: string | undefined, wholeLine: boolean) => {
    const ext = extension(target);
    if (!ext || ext === "md") {
      const linkTarget = context.linkTo(target.split("#")[0]);
      if (linkTarget) return `[${escapeLabel(baseName(target))}](${linkTarget})`;
      missingLinks += 1;
      return baseName(target);
    }
    const link = await context.attachRelated(target);
    if (!link) {
      missingFiles += 1;
      return `![[${target}]]`;
    }
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

    // ![[file|size]]
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
          if (!extension(pathOnly) || extension(pathOnly) === "md") return whole;
        }
        const link = await context.attachRelated(pathOnly);
        if (!link) {
          missingFiles += 1;
          return whole;
        }
        return `${bang}[${label}](${encodeShardLinkPath(link)}${title})`;
      },
    );

    value = value
      .replace(/==(?=\S)([^=]+?)(?<=\S)==/g, "<mark>$1</mark>")
      .replace(/ ?%%.*?%%/g, "")
      .replace(/\s\^[A-Za-z0-9-]+\s*$/, "");
    return value;
  };

  let callout: { indent: string; lines: string[]; icon: string; title: string } | null = null;
  const flushCallout = () => {
    if (!callout) return;
    const body = [
      ...(callout.title ? [`**${callout.title}**`, ""] : []),
      ...callout.lines,
    ];
    out.push(`${callout.indent}<callout icon="${callout.icon}">`);
    for (const line of body) out.push(line ? `${callout.indent}  ${line}` : "");
    out.push(`${callout.indent}</callout>`);
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
        icon: CALLOUT_ICONS[calloutStart[2].toLowerCase()] ?? "💡",
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
  if (missingFiles > 0) {
    context.warn(
      missingFiles === 1
        ? "1 picture or file it uses wasn't found next to it."
        : `${missingFiles} pictures or files it uses weren't found next to it.`,
    );
  }

  return out.join("\n");
}
