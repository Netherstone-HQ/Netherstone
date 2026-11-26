import { mathFromMarkdown, mathToMarkdown } from "mdast-util-math";
import { math } from "micromark-extension-math";
import type {
  Code,
  Construct,
  Effects,
  State,
  Token,
  TokenizeContext,
} from "micromark-util-types";
import type { Processor } from "unified";

/**
 * remark-math (which this replaces), with a stricter rule for an equation
 * between single `$`s, so that prices stay text ("costs $5 or $10"):
 * - the `$` that opens it is followed by a non-space;
 * - the `$` that closes it comes after a non-space and isn't followed by a
 *   digit;
 * - a `$` in between that could open an equation itself (a space before it,
 *   a non-space after) ends the try, so "$5, then $r^2$" is text and then
 *   an equation.
 * `$x^2$` still works, and `$$...$$` is unchanged.
 */

const DOLLAR = 36;
const SPACE = 32;

/** Space, tab or line ending (micromark gives tabs and line endings negative codes). */
function isMathSpace(code: Code): boolean {
  return code !== null && (code < 0 || code === SPACE);
}

function isDigit(code: Code): boolean {
  return code !== null && code >= 48 && code <= 57;
}

function isLineEnding(code: Code): boolean {
  return code !== null && code < -2;
}

const baseMath = math();
const baseMathText = baseMath.text![DOLLAR] as Construct;

/**
 * Per text and number of opening `$`s: where a try started and where it
 * failed (the text's end, or a `$` that could open an equation). A later try
 * starting in between fails the same way, so it fails at once, which keeps
 * runs of prices like `$1,$2,$3` linear.
 */
type Unclosed = { from: number; to: number };
const unclosed = new WeakMap<TokenizeContext, Map<number, Unclosed>>();

/** micromark's inline math tokenizer, with the single `$` rules above. */
function tokenizeMathText(
  this: TokenizeContext,
  effects: Effects,
  ok: State,
  nok: State,
): State {
  const context = this;
  const from = context.now().offset;
  let sizeOpen = 0;
  let size = 0;
  let sequence: Token;
  // How many `$`s in a row after a space.
  let spaced = 0;
  // The last character inside the math, to tell if a `$` comes after a space.
  let previous: Code = DOLLAR;
  // Where the `$`s after a space start.
  let spacedAt = 0;

  return start;

  function failAt(code: Code, to = context.now().offset): State | undefined {
    const tries = unclosed.get(context) ?? new Map<number, Unclosed>();
    tries.set(sizeOpen, { from, to });
    unclosed.set(context, tries);
    return nok(code);
  }

  function start(code: Code): State | undefined {
    effects.enter("mathText");
    effects.enter("mathTextSequence");
    return sequenceOpen(code);
  }

  function sequenceOpen(code: Code): State | undefined {
    if (code === DOLLAR) {
      effects.consume(code);
      sizeOpen++;
      return sequenceOpen;
    }
    if (sizeOpen === 1 && (code === null || isMathSpace(code))) return nok(code);
    const failed = unclosed.get(context)?.get(sizeOpen);
    if (failed && failed.from <= from && from < failed.to) return nok(code);
    effects.exit("mathTextSequence");
    return between(code);
  }

  function between(code: Code): State | undefined {
    if (code === null) return failAt(code);

    if (code === DOLLAR) {
      // A `$` after a space can't close: it's part of the math, unless it
      // could open an equation of its own.
      if (sizeOpen === 1 && isMathSpace(previous)) {
        effects.enter("mathTextData");
        spaced = 0;
        spacedAt = context.now().offset;
        return spacedDollars(code);
      }
      sequence = effects.enter("mathTextSequence");
      size = 0;
      return sequenceClose(code);
    }

    if (code === SPACE) {
      effects.enter("space");
      effects.consume(code);
      effects.exit("space");
      previous = code;
      return between;
    }

    if (isLineEnding(code)) {
      effects.enter("lineEnding");
      effects.consume(code);
      effects.exit("lineEnding");
      previous = code;
      return between;
    }

    effects.enter("mathTextData");
    return data(code);
  }

  function spacedDollars(code: Code): State | undefined {
    if (code === DOLLAR) {
      effects.consume(code);
      spaced++;
      previous = code;
      return spacedDollars;
    }
    if (spaced === 1 && code !== null && !isMathSpace(code)) return failAt(code, spacedAt);
    effects.exit("mathTextData");
    return between(code);
  }

  function data(code: Code): State | undefined {
    if (code === null || code === SPACE || code === DOLLAR || isLineEnding(code)) {
      effects.exit("mathTextData");
      return between(code);
    }
    effects.consume(code);
    previous = code;
    return data;
  }

  function sequenceClose(code: Code): State | undefined {
    if (code === DOLLAR) {
      effects.consume(code);
      size++;
      return sequenceClose;
    }

    if (size === sizeOpen && !(sizeOpen === 1 && isDigit(code))) {
      effects.exit("mathTextSequence");
      effects.exit("mathText");
      return ok(code);
    }

    // Not a closing sequence: its `$`s are part of the math.
    sequence.type = "mathTextData";
    previous = DOLLAR;
    return data(code);
  }
}

const mathText: Construct = { ...baseMathText, tokenize: tokenizeMathText };

const baseToMarkdown = mathToMarkdown();
type InlineMathHandle = NonNullable<
  NonNullable<typeof baseToMarkdown.handlers>["inlineMath"]
>;
type InlineMathInfo = Parameters<InlineMathHandle>[3];

const SPACE_AT_EDGE = /^\s|\s$/;
const DIGIT = /^[0-9]/;

/**
 * mdast-util-math's inline math writer, except that it writes `$$` when a
 * single `$` wouldn't read back as math: the math starts or ends with a
 * space, or a digit comes right after it.
 */
const writeInlineMath: InlineMathHandle = (node, parent, state, info: InlineMathInfo) => {
  const written = baseToMarkdown.handlers!.inlineMath!(node, parent, state, info);
  const single = /^\$[^$]/.test(written);
  if (!single) return written;

  const inner = written.slice(1, -1);
  if (!SPACE_AT_EDGE.test(inner) && !DIGIT.test(info.after)) return written;

  let size = 2;
  while (new RegExp(`(^|[^$])${"\\$".repeat(size)}([^$]|$)`).test(inner)) size++;
  const fence = "$".repeat(size);
  return fence + inner + fence;
};
// What comes first in the output, for the text before it.
const inlineMath = Object.assign(writeInlineMath, { peek: () => "$" });

export function remarkDollarMath(this: Processor) {
  const data = this.data();
  (data.micromarkExtensions ??= []).push({
    flow: baseMath.flow,
    text: { [DOLLAR]: mathText },
  });
  (data.fromMarkdownExtensions ??= []).push(mathFromMarkdown());
  (data.toMarkdownExtensions ??= []).push({
    ...baseToMarkdown,
    handlers: { ...baseToMarkdown.handlers, inlineMath },
  });
}
