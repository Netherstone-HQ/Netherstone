import remend from "remend";

/**
 * An answer still streaming in, cut back to what already reads as it will
 * once finished, so nothing shown collapses or changes kind later:
 * half-written Markdown would show its raw characters, then shrink.
 */
export function settledMarkdown(text: string): string {
  // Links are held back here instead, so a cite never shows as a web link.
  return remend(holdBack(text), { links: false, images: false, katex: false });
}

/** A fence's opening or closing line, as far as it has come. */
const FENCE = /^\s*(`{3,}|~{3,})/;
/** A line that may still open a fence, or one whose info string is coming. */
const OPENING_FENCE = /^\s*(`{1,2}|~{1,2}|(`{3,}|~{3,})[^`~]*)$/;
/** Inside a fence, a line that may still close it. */
const CLOSING_FENCE = /^\s*(`+|~+)\s*$/;
/** A line that may still become a list item, a rule or a heading underline. */
const PENDING_MARKER = /^\s*([-=*_+]+|\d+[.)]?)\s*$/;
/** A table's delimiter row: `| --- | :-: |`. */
const DELIMITER_ROW = /^\s*\|?(\s*:?-+:?\s*\|)+\s*(:?-+:?\s*)?$/;
/** A line that may be a table's row: tables need no leading pipe. */
const TABLE_ROW = /\|/;
/** A link or image that's complete: `[text](target)`. */
const COMPLETE_LINK = /^!?\[[^\]\n]*\]\([^)\n]*\)/;
/** One still coming: `[text`, `[text]` or `[text](targ`. */
const PARTIAL_LINK = /^!?\[[^\]\n]*(\](\([^)\n]*)?)?$/;
/** Emphasis or code markers with nothing after them yet. */
const TRAILING_MARKERS = /[*_~`]+$/;

function holdBack(text: string): string {
  const lines = text.split("\n");
  const last = lines.length - 1;
  const fenced = insideFence(lines.slice(0, last));

  // The last line is still being written: it may yet turn into something
  // else, like a code fence, a list item or a heading underline.
  // In a fence, an empty last line would show as one in the code until
  // the next line, or the closing fence, comes.
  if (fenced) {
    if (lines[last] === "" || CLOSING_FENCE.test(lines[last])) lines.pop();
    return lines.join("\n");
  }
  if (OPENING_FENCE.test(lines[last]) || PENDING_MARKER.test(lines[last])) {
    lines[last] = "";
  }

  // A table's header shows as a paragraph until its delimiter row comes.
  // The line just begun may still make the one before it a header.
  const end = lines[last] === "" ? last : lines.length;
  let first = end;
  while (first > 0 && TABLE_ROW.test(lines[first - 1])) first -= 1;
  if (first < end) {
    const delimiter = lines[first + 1];
    const confirmed =
      delimiter !== undefined && DELIMITER_ROW.test(delimiter) && first + 2 <= last;
    if (!confirmed) lines.length = first;
  }

  return holdBackLink(lines.join("\n")).replace(TRAILING_MARKERS, "");
}

/** Whether `lines` leave a code fence open. */
function insideFence(lines: string[]): boolean {
  let open: string | null = null;
  for (const line of lines) {
    const fence = FENCE.exec(line)?.[1];
    if (!fence) continue;
    if (open === null) open = fence;
    // A closing fence has nothing after it, unlike an opening one.
    else if (CLOSING_FENCE.test(line) && fence[0] === open[0] && fence.length >= open.length) {
      open = null;
    }
  }
  return open !== null;
}

/**
 * Holds back a link at the end until it's complete and the next word
 * after it says whether it's a cite or a shard named in the sentence.
 */
function holdBackLink(text: string): string {
  for (;;) {
    const start = text.lastIndexOf("[");
    if (start < 0) return text;
    const from = start > 0 && text[start - 1] === "!" ? start - 1 : start;
    const rest = text.slice(from);
    const complete = COMPLETE_LINK.exec(rest);
    const pending = complete
      ? rest.slice(complete[0].length).trim() === ""
      : PARTIAL_LINK.test(rest);
    if (!pending) return text;
    text = text.slice(0, from);
  }
}
