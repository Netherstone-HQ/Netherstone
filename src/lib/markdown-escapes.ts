/**
 * remark escapes every character that could start Markdown syntax
 * somewhere, which turns plain prose into `snake\_case`, `AT\&T` and
 * `2 \* 3`. These escapes are taken back out where the character can't do
 * anything in that spot, so files read the way they were typed:
 *
 * - `_` between two letters or digits: an underscore inside a word never
 *   starts or ends emphasis.
 * - `&` that isn't followed by a character reference such as `&copy;`.
 * - `*` with a space on both sides, after other text on the line: it can't
 *   be emphasis, and only a line's first `*` can start a list item.
 *
 * Only escapes inside one piece of text are touched, so a character next
 * to a bold or linked word keeps its escape.
 */

const NEEDLESS_ESCAPES: [RegExp, string][] = [
  [/(?<=[\p{L}\p{N}])\\_(?=[\p{L}\p{N}])/gu, "_"],
  [/(?<!\\)\\&(?![a-z][a-z0-9]*;|#[0-9]+;|#x[0-9a-f]+;)/gi, "&"],
  [/(?<=\S[^\n]*[ \t])\\\*(?=[ \t])/g, "*"],
];

export function removeNeedlessEscapes(markdown: string): string {
  return NEEDLESS_ESCAPES.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    markdown,
  );
}

/** remark's own text handler, with the needless escapes taken out. */
export function textHandler(
  node: { value: string },
  _parent: unknown,
  // remark's types, which this package doesn't depend on directly.
  state: { safe: (value: string, info: never) => string },
  info: unknown,
): string {
  return removeNeedlessEscapes(state.safe(node.value, info as never));
}
