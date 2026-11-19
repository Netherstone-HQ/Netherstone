import { describe, expect, it } from "vitest";
import { loadMarkdown, roundTrip, saveValue } from "@/test/markdown";

type Child = { text?: string; type?: string; texExpression?: string; bold?: boolean; code?: boolean };

/** A loaded line as text, with each equation as `[tex]`. */
function shown(markdown: string): string {
  const children = loadMarkdown(markdown)[0].children as Child[];
  return children
    .map((child) => (child.type === "inline_equation" ? `[${child.texExpression}]` : child.text))
    .join("");
}

const equation = (texExpression: string) => ({
  type: "inline_equation",
  texExpression,
  children: [{ text: "" }],
});

describe("a single $ when a file is read", () => {
  it.each([
    ["costs $5 or $10", "costs $5 or $10"],
    ["$5 and $10.", "$5 and $10."],
    ["a $ b $ c", "a $ b $ c"],
    ["from $x $ on", "from $x $ on"],
    ["$x$2", "$x$2"],
  ])("leaves case %# as text", (markdown, text) => {
    expect(shown(markdown)).toBe(text);
  });

  it.each([
    ["Area $r^2$ here", "Area [r^2] here"],
    ["$x^2$", "[x^2]"],
    ["a $b$, $c$.", "a [b], [c]."],
    ["sum $$a b$$ x", "sum [a b] x"],
    ["$5 x$ and", "[5 x] and"],
    // A `$` that could open an equation of its own ends the one before.
    ["It costs $5 or $10, and the area is $r^2$.", "It costs $5 or $10, and the area is [r^2]."],
    ["$a $b$", "$a [b]"],
  ])("reads case %# as an equation", (markdown, text) => {
    expect(shown(markdown)).toBe(text);
  });
});

describe("a $ in text when it's saved", () => {
  it.each([
    "costs $5 or $10\n",
    "a $ b $ c\n",
    "Spend $ 5, then $x^2$ more\n",
    "It costs $5 or $10, and the area is $r^2$.\n",
  ])("is written as typed, case %#", (markdown) => {
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it.each([
    // It could open an equation the `$` of the next one closes.
    [[{ text: "costs $5 and" }, equation("x"), { text: "" }], "costs \\$5 and$x$"],
    [[{ text: "$5 for x$" }], "\\$5 for x$"],
    [[{ text: "$5 **" }, { text: "x$", bold: true }], "\\$5 \\*\\***x$**"],
    // An escape doesn't count inside an equation.
    [[{ text: "$a \\$" }], "\\$a \\\\\\$"],
    [[{ text: "$$5" }], "\\$\\$5"],
  ])("keeps its escape where it could open an equation, case %#", (children, markdown) => {
    const saved = saveValue([{ type: "p", children }]);
    expect(saved).toBe(`${markdown}\n`);
    expect(shown(saved)).toBe(
      children
        .map((child) => ("type" in child ? `[${child.texExpression}]` : child.text))
        .join(""),
    );
  });

  it("leaves code alone", () => {
    const markdown = "Use `$5 $x$` here\n\n```sh\necho $HOME $5\n```\n";
    expect(roundTrip(markdown)).toBe(markdown);
  });
});

describe("an equation when it's saved", () => {
  it.each([
    ["with a space at an edge", [{ text: "a " }, equation("x "), { text: " b" }], "a $$x $$ b"],
    ["with a digit after it", [{ text: "a " }, equation("x"), { text: "2 b" }], "a $$x$$2 b"],
  ])("%s uses $$, so it reads back", (_name, children, markdown) => {
    const saved = saveValue([{ type: "p", children }]);
    expect(saved).toBe(`${markdown}\n`);
    expect(roundTrip(saved)).toBe(saved);
    const back = loadMarkdown(saved)[0].children as Child[];
    expect(back.find((child) => child.type === "inline_equation")?.texExpression).toBe(
      (children[1] as Child).texExpression,
    );
  });
});

describe("a line that starts or ends with an inline", () => {
  it.each([
    ["an equation at the end", "Area $r^2$"],
    ["an equation at the start", "$r^2$ is the area"],
    ["only an equation", "$x$"],
    ["a link at the start", "[docs](https://example.com) here"],
  ])("has a text on both sides of it: %s", (_name, markdown) => {
    const children = loadMarkdown(markdown)[0].children as Child[];
    expect(children[0].text).toBeTypeOf("string");
    expect(children[children.length - 1].text).toBeTypeOf("string");
    expect(roundTrip(markdown)).toBe(`${markdown}\n`);
  });
});
