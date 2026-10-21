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
  // A shard link's path is percent-encoded, never put in angle brackets.
  "percent-encoded note link":
    "Link to [roadmap](./Projects/Netherstone%20roadmap.md).\n",
  "block image": "![alt text](attachments/image.png)\n",
  table: "| a | b |\n| - | - |\n| 1 | 2 |\n",
};

/** Notes written by hand or by other tools, with their content at risk. */
const HAND_WRITTEN: Record<string, string> = {
  ...CANONICAL,
  "star bullets and italics": "* one\n* *two*\n",
  "note link with spaces":
    "Link to [roadmap](<./Projects/Netherstone roadmap.md>).\n",
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

  it("saves an empty line between content as <br>", () => {
    const value = [
      { type: "p", children: [{ text: "a" }] },
      { type: "p", children: [{ text: "" }] },
      { type: "p", children: [{ text: "" }] },
      { type: "p", children: [{ text: "b" }] },
    ];
    expect(saveValue(value)).toBe("a\n\n<br>\n\n<br>\n\nb\n");
    expect(loadMarkdown("a\n\n<br>\n\nb\n").map((node) => node.children[0].text)).toEqual([
      "a",
      "",
      "b",
    ]);
  });

  it("never writes a zero-width space", () => {
    const cell = (text: string) => ({
      type: "td",
      children: [{ type: "p", children: [{ text }] }],
    });
    const table = {
      type: "table",
      children: [
        { type: "tr", children: [cell("a"), cell("b")] },
        { type: "tr", children: [cell("1"), cell("")] },
      ],
    };
    const mention = {
      type: "p",
      children: [
        { text: "see " },
        { type: "mention", value: "Other", children: [{ text: "" }] },
        { text: "" },
      ],
    };
    const saved = saveValue([table, mention]);
    expect(saved).not.toContain("\u200B");
    expect(saved).toContain("| 1 |  |");
    expect(saved).toContain("see [Other](Other.md)\n");
  });

  it("drops block ids before saving", () => {
    const saved = saveValue([
      {
        type: "callout",
        icon: "💡",
        id: "static-0001",
        children: [{ type: "p", id: "static-0002", children: [{ text: "Body" }] }],
      },
      { type: "video", id: "static-0003", url: "clip.mp4", children: [{ text: "" }] },
    ]);
    expect(saved).toBe('<callout icon="💡">\n  Body\n</callout>\n\n<video src="clip.mp4" />\n');
  });

  // The editor always ends a shard with an empty line to type into.
  it("drops empty paragraphs at the end", () => {
    const value = [
      { type: "p", children: [{ text: "a" }] },
      { type: "p", children: [{ text: "" }] },
      { type: "p", children: [{ text: "" }] },
    ];
    expect(saveValue(value)).toBe("a\n");
  });

  it("keeps an empty list item at the end", () => {
    const value = [
      { type: "p", indent: 1, listStyleType: "disc", children: [{ text: "a" }] },
      { type: "p", indent: 1, listStyleType: "disc", children: [{ text: "" }] },
    ];
    expect(saveValue(value)).toBe("- a\n-\n");
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

  it("keeps an HTML block and a comment exactly as written", () => {
    const markdown =
      "<!-- a note to self -->\n\n<div class=\"x\">raw html</div>\n\n<table><tr><td>cell</td></tr></table>\n";
    const value = loadMarkdown(markdown);
    expect(value.map((node) => node.type)).toEqual(["raw_block", "raw_block", "raw_block"]);
    expect(roundTrip(markdown)).toBe(markdown);
  });

  it("ends a table at a comment on the line right under it", () => {
    const value = loadMarkdown(
      "| Week | km |\n| - | - |\n| 1 | 12 |\n<!-- netherstone chart: bar; x Week; y km -->\n",
    );
    expect(value.map((node) => node.type)).toEqual(["table", "raw_block"]);
    expect(value[0].children).toHaveLength(2);
    expect(
      roundTrip("| a | b |\n| - | - |\n| 1 | 2 |\n<!-- netherstone chart: bar -->\n"),
    ).toBe("| a | b |\n| - | - |\n| 1 | 2 |\n\n<!-- netherstone chart: bar -->\n");
  });

  it("keeps inline HTML as marks, not raw blocks", () => {
    expect(loadMarkdown("<u>whole line</u>\n")[0].type).toBe("p");
    expect(roundTrip("Some <mark>text</mark> here.\n")).toBe("Some <mark>text</mark> here.\n");
  });

  it("fences indented code", () => {
    expect(roundTrip("Para\n\n    indented code\n    line two\n\nAfter\n")).toBe(
      "Para\n\n```\nindented code\nline two\n```\n\nAfter\n",
    );
  });

  it("turns @-text into a shard link", () => {
    // remarkMention: mentions replaced wikilinks for linking notes.
    expect(roundTrip("Hi @wassim there.\n")).toBe(
      "Hi [wassim](wassim.md) there.\n",
    );
  });

  it("upgrades a legacy <date> tag to Plate's current date format", () => {
    expect(roundTrip("On <date>Sat Apr 18 2026</date> it ran.\n")).toBe(
      'On <date value="2026-04-18" /> it ran.\n',
    );
  });
});

describe("autolinks", () => {
  // MDX reads `<https://…>` as a tag and fails, which used to make the whole
  // shard load through the plain parser, turning custom blocks into text.
  it("keeps callouts in a shard that also has an autolink", () => {
    const value = loadMarkdown(
      "See <https://example.com/path>.\n\n<callout icon=\"💡\">\n  Body\n</callout>\n",
    );
    expect(value.map((node) => node.type)).toEqual(["p", "callout"]);
  });

  it("saves a web autolink as a bare URL and an email as a link", () => {
    expect(roundTrip("Go to <https://example.com/x>.\n")).toBe(
      "Go to https://example.com/x.\n",
    );
    const value = loadMarkdown("Mail <someone@example.com> or <mailto:a@b.com>.\n");
    const links = value[0].children.filter((child: any) => child.type === "a");
    expect(links.map((link: any) => link.url)).toEqual([
      "mailto:someone@example.com",
      "mailto:a@b.com",
    ]);
  });
});

describe("table cells", () => {
  // Plate markdown 53.3.15 fixed both: a list in a cell used to save as the
  // literal text `- item` and a line break as a space.
  it("saves a list inside a cell as HTML and loads it back as a list", () => {
    const cell = {
      type: "td",
      children: [
        { type: "p", indent: 1, listStyleType: "disc", children: [{ text: "one" }] },
        { type: "p", indent: 1, listStyleType: "disc", children: [{ text: "two" }] },
      ],
    };
    const saved = saveValue([
      { type: "table", children: [{ type: "tr", children: [cell] }] },
    ]);
    expect(saved).toContain("| <ul><li>one</li><li>two</li></ul> |");

    const [table] = loadMarkdown(saved);
    const items = table.children[0].children[0].children;
    expect(items.map((item: any) => [item.listStyleType, item.children[0].text])).toEqual([
      ["disc", "one"],
      ["disc", "two"],
    ]);
  });

  it("keeps a line break inside a cell", () => {
    const [table] = loadMarkdown("| a |\n| - |\n| line<br>break |\n");
    const [paragraph] = table.children[1].children[0].children;
    expect(paragraph.children.map((leaf: any) => leaf.text)).toEqual(["line", "\n", "break"]);
    expect(roundTrip("| a |\n| - |\n| x<br/>y |\n")).toBe("| a       |\n| ------- |\n| x<br/>y |\n");
  });
});

describe("formatting the editor has no Markdown for", () => {
  it("saves alignment, line height and indent as a wrapper, and reads it back", () => {
    const value = [
      { type: "h2", align: "center", children: [{ text: "Title" }] },
      { type: "p", align: "center", children: [{ text: "Under it" }] },
      { type: "p", lineHeight: 2, indent: 1, children: [{ text: "Spaced" }] },
    ];
    const markdown = saveValue(value);
    expect(markdown).toBe(
      '<div align="center">\n\n## Title\n\nUnder it\n\n</div>\n\n<div style="line-height: 2; margin-left: 24px">\n\nSpaced\n\n</div>\n',
    );
    const loaded = loadMarkdown(markdown);
    expect(loaded.map(({ id: _id, ...block }) => block)).toEqual(value);
  });

  it("keeps a list item's indent as list nesting", () => {
    const value = [
      { type: "p", listStyleType: "disc", indent: 1, children: [{ text: "one" }] },
      { type: "p", listStyleType: "disc", indent: 2, children: [{ text: "two" }] },
    ];
    expect(saveValue(value)).toBe("- one\n  - two\n");
  });

  it("keeps a resized image's width and a link's title", () => {
    const value = [
      {
        type: "img",
        url: "a.png",
        width: 320.4,
        caption: [{ text: "cap" }],
        children: [{ text: "" }],
      },
      {
        type: "p",
        children: [
          { type: "a", url: "https://x.y", title: "The site", children: [{ text: "x" }] },
        ],
      },
    ];
    const markdown = saveValue(value);
    expect(markdown).toBe(
      '<img src="a.png" alt="cap" width="320" />\n\n[x](https://x.y "The site")\n',
    );
    const loaded = loadMarkdown(markdown);
    expect(loaded[0]).toMatchObject({ type: "img", url: "a.png", width: 320 });
    expect(loaded[1].children[0]).toMatchObject({ url: "https://x.y", title: "The site" });
  });

  it("writes an image without a width the plain way", () => {
    expect(
      saveValue([{ type: "img", url: "a.png", caption: [{ text: "cap" }], children: [{ text: "" }] }]),
    ).toBe("![cap](a.png)\n");
  });
});

describe("shard links", () => {
  const FILE = "C:/Vault/Daily/Today.md";
  const load = (markdown: string) =>
    loadMarkdown(markdown, undefined, { filePath: FILE });
  const save = (value: any[]) =>
    saveValue(value, undefined, { filePath: FILE });
  const mentions = (value: any[]) =>
    value.flatMap((block) =>
      (block.children as any[]).filter((child) => child.type === "mention"),
    );

  it("loads a relative link to a shard as an @ link to its path", () => {
    const value = load("See [the plan](../Projects/Plan.md) and [Me](Me.md).\n");
    expect(mentions(value)).toEqual([
      expect.objectContaining({ value: "the plan", key: "C:/Vault/Projects/Plan.md" }),
      expect.objectContaining({ value: "Me", key: "C:/Vault/Daily/Me.md" }),
    ]);
  });

  it("saves an @ link as a link relative to the shard's folder", () => {
    const paragraph = {
      type: "p",
      children: [
        { text: "See " },
        {
          type: "mention",
          value: "Plan",
          key: "C:\\Vault\\Projects\\Big (draft) plan.md",
          children: [{ text: "" }],
        },
        { text: " and " },
        {
          type: "mention",
          value: "Me",
          key: "C:/Vault/Daily/Me.md",
          children: [{ text: "" }],
        },
        { text: "." },
      ],
    };
    expect(save([paragraph])).toBe(
      "See [Plan](../Projects/Big%20%28draft%29%20plan.md) and [Me](Me.md).\n",
    );
  });

  it("round-trips relative links unchanged, however deep", () => {
    const markdown =
      "See [the plan](../Projects/Plan.md), [Me](Me.md) and [Far](../../Other%20vault/Far.md).\n";
    expect(save(load(markdown))).toBe(markdown);
  });

  it("leaves links with a heading, a query or a scheme alone", () => {
    const markdown =
      "[Heading](Plan.md#goals) [Query](Plan.md?x=1) [Site](https://example.com/a.md) [Image](img.png)\n";
    expect(mentions(load(markdown))).toEqual([]);
    expect(save(load(markdown))).toBe(markdown);
  });

  it("upgrades old mention: links to relative links", () => {
    const old =
      "A [Plan](mention:C%3A%2FVault%2FProjects%2FPlan.md-3) and a [Name](mention:Name) link.\n";
    const value = load(old);
    expect(mentions(value)).toEqual([
      expect.objectContaining({ value: "Plan", key: "C:/Vault/Projects/Plan.md" }),
      expect.objectContaining({ value: "Name", key: "Name" }),
    ]);
    expect(save(value)).toBe(
      "A [Plan](../Projects/Plan.md) and a [Name](Name.md) link.\n",
    );
  });

  it("keeps a link written without a file path as it was", () => {
    expect(roundTrip("See [Plan](./Projects/Plan.md).\n")).toBe(
      "See [Plan](./Projects/Plan.md).\n",
    );
  });
});

describe("to-do lists", () => {
  it("saves an untouched to-do as an open task, not a bullet", () => {
    expect(
      saveValue([
        { type: "p", indent: 1, listStyleType: "todo", children: [{ text: "task" }] },
      ]),
    ).toBe("- [ ] task\n");
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

  it("unwraps autolinks, which MDX can't parse", () => {
    expect(sanitizeMarkdownInput("<https://a.com/{id}>")).toBe(
      "https://a.com/{id}",
    );
    expect(sanitizeMarkdownInput("<https://a.com/x> <a@b.com>")).toBe(
      "https://a.com/x [a@b.com](mailto:a@b.com)",
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
