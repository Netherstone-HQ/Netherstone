import { describe, expect, it } from "vitest";

import { importLinkedFile, replaceAttachmentPath } from "@/lib/shard-rewrite";

const OLD = "_attachments/0c/0cbdd2.png";

describe("replaceAttachmentPath", () => {
  it("relinks markdown images, links and HTML attributes", () => {
    const markdown = [
      `![a](${OLD})`,
      `[file](<${OLD}> "title")`,
      `<img src="${OLD}" width="300" />`,
      "![other](_attachments/0c/0cbdd2.png.bak)",
    ].join("\n\n");

    expect(
      replaceAttachmentPath(markdown, OLD, "_attachments/My shot (1).png"),
    ).toBe(
      [
        "![a](<_attachments/My shot (1).png>)",
        '[file](<_attachments/My shot (1).png> "title")',
        '<img src="_attachments/My shot (1).png" width="300" />',
        "![other](_attachments/0c/0cbdd2.png.bak)",
      ].join("\n\n"),
    );
  });

  it("matches URL-encoded links and reports when nothing changed", () => {
    expect(
      replaceAttachmentPath(
        "![a](_attachments/My%20shot.png)",
        "_attachments/My shot.png",
        "_attachments/Shot.png",
      ),
    ).toBe("![a](_attachments/Shot.png)");
    expect(replaceAttachmentPath("no links", OLD, "x.png")).toBeNull();
  });
});

describe("importLinkedFile", () => {
  it("points local links at the imported copy and marks media as vault", () => {
    const markdown = [
      "![a](<../images/a b.png>)",
      "![b](../images/a%20b.png)",
      '<file name="r &amp; d.pdf" netherstoneSourceKind="local" netherstoneStoredSource="C:\\docs\\r &amp; d.pdf" src="C:\\docs\\r &amp; d.pdf" />',
    ].join("\n\n");

    let next = importLinkedFile(
      markdown,
      "../images/a b.png",
      "_attachments/a b.png",
    );
    next = importLinkedFile(
      next!,
      "C:\\docs\\r & d.pdf",
      "_attachments/r & d.pdf",
    );

    expect(next).toBe(
      [
        "![a](<_attachments/a b.png>)",
        "![b](<_attachments/a b.png>)",
        '<file name="r &amp; d.pdf" netherstoneSourceKind="vault" netherstoneStoredSource="_attachments/r &amp; d.pdf" src="_attachments/r &amp; d.pdf" />',
      ].join("\n\n"),
    );
  });
});
