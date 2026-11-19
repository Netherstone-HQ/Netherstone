import { KEYS } from "platejs";

/**
 * remark escapes every `$` in text as `\$`, since a `$` can start an
 * equation. With the rule in `remark-dollar-math.ts`, most can't: a `$` only
 * needs its escape when it could open an equation that a later `$` in the
 * same block could close. Those keep it; the rest are saved as plain `$`, so
 * "costs $5 or $10" is written the way it was typed.
 *
 * Before saving, each `$` in text is swapped for a placeholder that says
 * whether it keeps its escape, and put back after remark has written the
 * text. Where it can't tell what the saved text around a `$` will be (the
 * edges of a piece of text, inline elements), it assumes the case that keeps
 * the escape.
 */

// Characters from Unicode's private use area, which text never has in practice.
/** Stands in for a `$` that is saved as `$`. */
const PLAIN_DOLLAR = String.fromCharCode(0xe001);
/** Stands in for a `$` that is saved as `\$`. */
const ESCAPED_DOLLAR = String.fromCharCode(0xe002);
/** Stands in for a `\` right before a `$`, saved as `\\`. */
const ESCAPED_BACKSLASH = String.fromCharCode(0xe003);
const WRITTEN: Record<string, string> = {
  [PLAIN_DOLLAR]: "$",
  [ESCAPED_DOLLAR]: "\\$",
  [ESCAPED_BACKSLASH]: "\\\\",
};
const PLACEHOLDERS = new RegExp(`[${PLAIN_DOLLAR}-${ESCAPED_BACKSLASH}]`, "g");
const PLACEHOLDER = new RegExp(PLACEHOLDERS.source);

const DOLLAR = "$";
const BACKSLASH = "\\";
// A character that may be written as anything but a space: it can open and
// close an equation.
const OTHER = "x";
const CODE_TYPES = new Set<string>([KEYS.codeBlock, KEYS.codeLine]);

type Leaf = { text: string; code?: boolean; [key: string]: unknown };
type Element = { type?: unknown; children: unknown[]; [key: string]: unknown };

function isLeaf(node: unknown): node is Leaf {
  return !!node && typeof (node as Leaf).text === "string";
}

function isElement(node: unknown): node is Element {
  return !!node && Array.isArray((node as Element).children);
}

const isSpace = (char: string | undefined) => char === " " || char === "\t";
const isDigit = (char: string | undefined) => !!char && char >= "0" && char <= "9";

/** A `$` that, as the block is saved, could open an equation. */
function canOpen(next: string | undefined) {
  return next !== undefined && !isSpace(next);
}

/** A `$` that, as the block is saved, could close an equation. */
function canClose(previous: string | undefined, next: string | undefined) {
  return previous !== undefined && !isSpace(previous) && !isDigit(next);
}

type Char = {
  char: string;
  // Where a `$` in plain text comes from.
  leaf?: number;
  offset?: number;
  // Written as is (not a guess like the others).
  known?: true;
  boundary?: true;
  // An equation's opening `$`, when it's written as a single `$`.
  opensEquation?: true;
};

// Where one child ends and the next starts: remark may write a mark's
// delimiter there, or nothing.
const BOUNDARY: Char = { char: OTHER, boundary: true };

/**
 * A text's characters as they'll be saved, as far as the rule is concerned.
 * `first` and `last` say whether it starts or ends the block.
 */
function leafChars(child: Leaf, index: number, first: boolean, last: boolean): Char[] {
  const { text } = child;
  // remark may write a space as `&#x20;` at the edge of formatted text or of
  // the block, or next to a line break; and a line break as `\` and a new
  // line.
  const plainEdges = Object.keys(child).length === 1;
  const leaf = child.code ? undefined : index;
  return Array.from(text, (char, offset) => {
    const lineBreak = char === "\n" || char === "\r";
    const edge =
      isSpace(char) &&
      ((offset === 0 && (first || !plainEdges)) ||
        (offset === text.length - 1 && (last || !plainEdges)) ||
        /[\r\n]/.test(text[offset - 1]) ||
        /[\r\n]/.test(text[offset + 1]));
    return lineBreak || edge ? { char: OTHER } : { char, leaf, offset, known: true };
  });
}

/** Whether an equation is written between single `$`s (see `remark-dollar-math.ts`). */
function singleFenced(tex: unknown) {
  return typeof tex === "string" && /^\S(.*\S)?$/s.test(tex) && !tex.includes(DOLLAR);
}

/** The block's children with each `$` in text swapped for its placeholder. */
function markBlock(children: unknown[]): unknown[] {
  const chars: Char[] = [];

  children.forEach((child, index) => {
    chars.push(BOUNDARY);
    if (isLeaf(child)) {
      chars.push(...leafChars(child, index, index === 0, index === children.length - 1));
    } else if (isElement(child) && child.type === KEYS.inlineEquation) {
      const opening: Char = singleFenced(child.texExpression)
        ? { char: DOLLAR, opensEquation: true }
        : { char: DOLLAR };
      chars.push(opening, { char: OTHER }, { char: DOLLAR });
    } else if (JSON.stringify(child).includes(DOLLAR)) {
      chars.push({ char: DOLLAR });
    }
  });
  chars.push(BOUNDARY);

  // The character next to `at` in `step`'s direction, if nothing is written
  // at a boundary.
  const neighbour = (at: number, step: number): Char | undefined =>
    chars[at + step]?.boundary ? chars[at + 2 * step] : chars[at + step];
  const besides = (at: number, step: number) => neighbour(at, step)?.char;

  const placeholders = new Map<number, Map<number, string>>();
  // Whether a `$` further on could close an equation.
  let closerAfter = false;

  for (let index = chars.length - 1; index >= 0; index -= 1) {
    const { char, leaf, offset, opensEquation } = chars[index];
    if (char !== DOLLAR) continue;
    let previous = chars[index - 1]?.char;
    const next = chars[index + 1]?.char;
    // A `$` that surely has a space before it and a non-space after it ends
    // the try of any `$` before it, if it's written as a single `$`.
    const before = neighbour(index, -1);
    const afterSpace = !!before?.known && isSpace(before.char);
    let opensAlone = afterSpace && (opensEquation ?? false) && !isDigit(besides(index + 2, 1));

    if (leaf !== undefined && offset !== undefined) {
      const { text } = children[leaf] as Leaf;
      if (!placeholders.has(leaf)) placeholders.set(leaf, new Map());
      const marks = placeholders.get(leaf)!;
      // `$$` would be a longer fence, and `\$` an escape, so a `$` next to
      // another or after a `\` keeps its escape.
      const plain =
        besides(index, -1) !== DOLLAR &&
        besides(index, 1) !== DOLLAR &&
        text[offset - 1] !== BACKSLASH &&
        !(canOpen(next) && closerAfter);
      marks.set(offset, plain ? PLAIN_DOLLAR : ESCAPED_DOLLAR);
      if (!plain) previous = BACKSLASH;
      const after = neighbour(index, 1);
      opensAlone = plain && afterSpace && !!after?.known && canOpen(after.char);
      // remark doesn't escape a `\` before a placeholder, so these are too.
      for (let at = offset - 1; text[at] === BACKSLASH; at -= 1) {
        marks.set(at, ESCAPED_BACKSLASH);
      }
    }

    // An escape doesn't count inside an equation, so an escaped `$` (after
    // its `\`) closes one as well as a plain one does.
    if (opensAlone) closerAfter = false;
    else if (canClose(previous, next)) closerAfter = true;
  }

  return children.map((child, index) => {
    const marks = placeholders.get(index);
    if (!marks) return child;
    const { text } = child as Leaf;
    return {
      ...(child as Leaf),
      text: Array.from(text, (char, offset) => marks.get(offset) ?? char).join(""),
    };
  });
}

/** Whether a text already has a placeholder, so this value can't use them. */
export function hasDollarPlaceholder(text: string): boolean {
  return PLACEHOLDER.test(text);
}

/**
 * The block's children with each `$` in text swapped for a placeholder that
 * says whether it keeps its escape, or null when there's none. Code is left
 * alone.
 */
export function markDollars(element: Element): unknown[] | null {
  if (typeof element.type === "string" && CODE_TYPES.has(element.type)) return null;
  const hasDollar = element.children.some(
    (child) => isLeaf(child) && !child.code && child.text.includes(DOLLAR),
  );
  return hasDollar ? markBlock(element.children) : null;
}

/** Writes the placeholders out, after remark has written the text. */
export function restoreDollars(markdown: string): string {
  return PLACEHOLDER.test(markdown)
    ? markdown.replace(PLACEHOLDERS, (placeholder) => WRITTEN[placeholder])
    : markdown;
}
