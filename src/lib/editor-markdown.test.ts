import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeMarkdownInput } from "@/lib/editor-markdown";
import { loadMarkdown, readableText, roundTrip, saveValue } from "@/test/markdown";

/** Notes already in the format the editor writes: saving must not change them. */
const CANONICAL: Record<string, string> = {
  headings: "# H1\n\n## H2\n\n### H3\n\nParagraph text.\n",
  marks: "Some **bold**, _italic_, ~~strike~~ and `code` text.\n",
  "bullet list": "- one\n- two\n  - nested\n- three\n",
  "ordered list": "1. first\n2. second\n3. third\n",
  "task list": "- [ ] todo\n- [x] done\n",
  "code block with MDX-unsafe characters":
    "```ts\nconst a = <T>(x: { y: 1 }) => x < 2;\n```\n",
  "thematic break": "Above\n\n---\n\nBelow\n",
  math: "Inline $x^2$ math.\n\n$$\na+b\n$$\n",
  "bare URL": "Visit https://example.com/path now.\n",
  "relative note link": "Link to [other](./other.md).\n",
  "block image": "![alt text](attachments/image.png)\n",
  table: "| a | b |\n| - | - |\n| 1 | 2 |\n",
};

/** Notes written by hand or by other tools, with their content at risk. */
const HAND_WRITTEN: Record<string, string> = {
  ...CANONICAL,
  "star bullets and italics": "* one\n* *two*\n",
  "long table delimiter": "| a | b |\n| --- | --- |\n| 1 | 2 |\n",
  "less-than in prose": "Values <1 and a <= b.\n",
  "braces in prose": "x { y } and {unclosed\n",
  "escaped less-than before a quote": "a \\<b\n\n> quoted > text\n",
  "inline image": "See [docs](https://example.com) and ![alt](img.png).\n",
  "nested blockquote list": "> - item one\n> - item two\n",
  "heading right after text": "Intro\n# Heading\nBody\n",
  "html block": "<div>raw html</div>\n",
  "unicode and emoji": "Café — naïve 日本語 🎉\n",
};

const DOCS_DIR = path.resolve(__dirname, "../../docs");
const DOC_FILES = fs
  .readdirSync(DOCS_DIR)
  .filter((name) => name.endsWith(".md"))
  .map((name) => [name, fs.readFileSync(path.join(DOCS_DIR, name), "utf8")]);

describe("open and save without edits", () => {
  it.each(Object.entries(CANONICAL))(
    "leaves a canonical %s note byte-for-byte unchanged",
    (_name, markdown) => {
      expect(roundTrip(markdown)).toBe(markdown);
    },
  );

  it.each(Object.entries(HAND_WRITTEN))(
    "keeps all content of a %s note",
    (_name, markdown) => {
      expect(readableText(roundTrip(markdown))).toBe(readableText(markdown));
    },
  );

  it.each(Object.entries(HAND_WRITTEN))(
    "is stable after the first save of a %s note",
    (_name, markdown) => {
      const firstSave = roundTrip(markdown);
      expect(roundTrip(firstSave)).toBe(firstSave);
    },
  );

  it.each(DOC_FILES)(
    "keeps all content of docs/%s",
    (_name, markdown) => {
      const firstSave = roundTrip(markdown);
      expect(readableText(firstSave)).toBe(readableText(markdown));
      expect(roundTrip(firstSave)).toBe(firstSave);
    },
  );

});

describe("code and empty notes", () => {
  // Plate's htmlToJsx() rewrites tag-like `<...>` before parsing; code and
  // math are masked from it so they load exactly as written.
  it("keeps the space in a self-closing tag inside inline code", () => {
    const markdown = "Render `<Toolbar />` after the editable.\n";
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("keeps HTML attributes in a code block as written", () => {
    const markdown = '```html\n<div class="x"><input disabled><br></div>\n```\n';
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("keeps tags in math as written", () => {
    const markdown = "$$\n<a b>\n$$\n";
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("leaves no placeholder characters in the loaded value", () => {
    const value = loadMarkdown("`<b>` and\n\n```\n<i>\n```\n");
    expect(JSON.stringify(value)).not.toContain("\\ue000");
    expect(JSON.stringify(value)).toContain("<b>");
  });

  it("saves an empty note as an empty file", () => {
    // Plate writes empty paragraphs as a zero-width space.
    expect(saveValue([{ type: "p", children: [{ text: "" }] }])).toBe("");
    expect(
      saveValue([
        { type: "p", children: [{ text: "" }] },
        { type: "p", children: [{ text: "" }] },
      ]),
    ).toBe("");
  });

  it("keeps empty paragraphs between content", () => {
    const value = [
      { type: "p", children: [{ text: "a" }] },
      { type: "p", children: [{ text: "" }] },
      { type: "p", children: [{ text: "b" }] },
    ];
    expect(saveValue(value)).toBe("a\n\n\u200B\n\nb\n");
  });
});

describe("conversions by design", () => {
  // Plate's document model (or the app's mention syntax) can't represent
  // these as written, so the first save rewrites them. These are intended,
  // not bugs; the tests pin the current output so changes are deliberate.

  it("saves a soft line break as a hard break", () => {
    // Plate keeps a soft break as "\n" in the text, which the editor shows
    // as a line break, the same as Shift+Enter.
    expect(roundTrip("line one\nline two\n")).toBe("line one\\\nline two\n");
    expect(roundTrip("> quoted line\n> more\n")).toBe(
      "> quoted line\\\n> more\n",
    );
  });

  it("moves an inline image into its own block", () => {
    // Images are block elements in Plate.
    expect(roundTrip("See ![alt](img.png) here.\n")).toBe(
      "See&#x20;\n\n![alt](img.png)\n\n&#x20;here.\n",
    );
  });

  it("turns raw HTML into literal text", () => {
    // Plate has no HTML node; its markdown rule loads HTML as plain text.
    expect(roundTrip("<div>raw html</div>\n")).toBe(
      "\\<div>raw html\\</div>\n",
    );
  });

  it("turns @-text into a mention", () => {
    // remarkMention: mentions replaced wikilinks for linking notes.
    expect(roundTrip("Hi @wassim there.\n")).toBe(
      "Hi [wassim](mention:wassim) there.\n",
    );
  });

  it("upgrades a legacy <date> tag to Plate's current date format", () => {
    expect(roundTrip("On <date>Sat Apr 18 2026</date> it ran.\n")).toBe(
      'On <date value="2026-04-18" /> it ran.\n',
    );
  });
});

describe("sanitizeMarkdownInput", () => {
  it("returns markdown without < or { unchanged", () => {
    const markdown = "# Title\n\nPlain text.\n";
    expect(sanitizeMarkdownInput(markdown)).toBe(markdown);
  });

  it("escapes a < that can't open a tag", () => {
    expect(sanitizeMarkdownInput("a <1 b <= c")).toBe("a &lt;1 b &lt;= c");
  });

  it("rewrites an escaped < to &lt;", () => {
    expect(sanitizeMarkdownInput("a \\<b")).toBe("a &lt;b");
  });

  it("escapes braces in prose but not already escaped ones", () => {
    expect(sanitizeMarkdownInput("x { y \\{ z")).toBe("x \\{ y \\{ z");
  });

  it("leaves code, inline code and math untouched", () => {
    const markdown = "`a < {b}`\n\n```\n<{x}>\n```\n\n$a < {b}$\n";
    expect(sanitizeMarkdownInput(markdown)).toBe(markdown);
  });

  it("keeps HTML tags but escapes the text between them", () => {
    expect(sanitizeMarkdownInput("<span>{x}</span>\n")).toBe(
      "<span>\\{x}</span>\n",
    );
  });

  it("unwraps an autolink containing a brace", () => {
    expect(sanitizeMarkdownInput("<https://a.com/{id}>")).toBe(
      "https://a.com/{id}",
    );
  });
});

describe("media attachments", () => {
  const audio = {
    type: "audio",
    url: "http://asset.localhost/C%3A%5Cv%5C_attachments%5C0c%5Cs.mp3",
    children: [{ text: "" }],
    netherstoneSourceKind: "vault",
    netherstoneStoredSource: "_attachments/0c/s.mp3",
    netherstoneImportedPath: "C:\\v\\_attachments\\0c\\s.mp3",
    netherstoneVaultPath: "C:\\v",
    netherstoneRenderUrl:
      "http://asset.localhost/C%3A%5Cv%5C_attachments%5C0c%5Cs.mp3",
    netherstoneMissing: false,
  };

  it("saves only the vault path, not where the file is on this device", () => {
    const saved = saveValue([audio]);

    expect(saved).toContain('src="_attachments/0c/s.mp3"');
    expect(saved).not.toMatch(
      /netherstone(ImportedPath|VaultPath|RenderUrl|Missing)/,
    );
  });

  it("drops device paths a shard saved before, so a moved file still plays", () => {
    const [node] = loadMarkdown(
      '<audio netherstoneSourceKind="vault" netherstoneStoredSource="_attachments/s.mp3" ' +
        'netherstoneImportedPath="C:\\v\\_attachments\\0c\\s.mp3" ' +
        'netherstoneRenderUrl="http://asset.localhost/old" src="_attachments/s.mp3" />\n',
    );

    expect(node.type).toBe("audio");
    expect(node.netherstoneStoredSource).toBe("_attachments/s.mp3");
    expect(node).not.toHaveProperty("netherstoneImportedPath");
    expect(node).not.toHaveProperty("netherstoneRenderUrl");
  });
});
