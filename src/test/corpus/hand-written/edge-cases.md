# Edge cases

Comparisons: a <1, b <= c, x < y and 1 < 2 < 3.

Braces { like this } and {unclosed and a {{double}}.

An escaped \<tag> and a literal `<b>` in code, then a blockquote:

> quoted > text with > signs

Unicode: Café, naïve, 日本語, العربية, emoji 🎉🧱, combining é.

A URL with braces https://example.com/{id}/x and one in angle brackets <https://example.com/{id}>.

Angle brackets in prose: a <= b, a < b < c, <3 and <= done.

```html
<div class="x"><input disabled><br></div>
```

```ts
const a = <T>(x: { y: 1 }) => x < 2;
```

Trailing text after code with a $ dollar sign and 100% percent.

| Pipe \| inside | Code `a\|b` |
| - | - |
| Cell with <1 | {brace} |

Heading right after text
# Heading
Body right after heading
