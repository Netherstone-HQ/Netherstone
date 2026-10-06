# Field notes on export

A shard can hold **bold**, _italic_, <u>underlined</u>, ~~struck~~ and `inline code` text, plus <mark>highlighted</mark> words, H<sub>2</sub>O and E = mc<sup>2</sup>. It links to [the release notes](https://example.com/notes) and to [Other shard](mention:Other%20shard), and it was written on <date value="2026-10-06" />.

<toc />

## Lists

- First point
- Second point with a nested list
  - Nested once
    - Nested twice
- Third point

1. Prepare the vault
2. Write the shard
   1. Draft
   2. Revise
3. Export it

- [x] Pick the fonts
- [ ] Check every page

## Quotes and callouts

> Simplicity is prerequisite for reliability.
> It holds for documents too.

<callout icon="💡" variant="info">
  Callouts keep their icon and their soft background in every format.
</callout>

## Code

```ts
// Greets someone by name.
export function greet(name: string): string {
  const message = `Hello, ${name}!`;
  return message.length > 40 ? message.slice(0, 40) : message;
}
```

```python
def fib(n):
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a
```

## Math

The Gaussian integral $\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi}$ shows up everywhere.

$$
\sum_{i=1}^{n} i = \frac{n(n+1)}{2}
$$

## Tables

| Format | Engine | Fonts |
| - | - | - |
| HTML | Browser | Embedded woff2 |
| PDF | System webview | The app's own, **shared** |
| Word | docx | Named, with stand-ins |

## Columns

<column_group>
  <column width="50%">
    The left column holds a short paragraph about layout.
  </column>

  <column width="50%">
    The right column sits beside it, the same width.
  </column>
</column_group>

---

### Media

![A test pattern](_attachments/pattern.png)

<file name="report-final.pdf" src="_attachments/report-final.pdf" />

<video src="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />

#### Other scripts

Café, naïve, Ærøskøbing, Привет, 日本語のテキスト, and an emoji 🎉.
