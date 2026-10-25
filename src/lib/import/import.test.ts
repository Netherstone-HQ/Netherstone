// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { useImportDialogStore } from "@/lib/import";
import { memoryImport } from "@/test/import";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);

describe("import engine", () => {
  it("keeps folders, links imported files to each other and stores pictures once", async () => {
    const vault = memoryImport({
      "Notes/Home.md": "# Home\n\nSee [[Plans]], [[Plans#Goals|the goals]] and [[Missing]].\n\n![[cat.png]]\n",
      "Notes/Sub/Plans.md": "# Plans\n\nBack to [home](../Home.md).\n\n![](../cat.png)\n",
      "Notes/cat.png": PNG,
    });
    const report = await vault.run();

    expect(report.created.map((shard) => shard.path)).toEqual(["/vault/Notes/Home.md", "/vault/Notes/Sub/Plans.md"]);
    expect(report.skipped).toEqual([]);
    expect(vault.shards.get("/vault/Notes/Home.md")).toContain(
      "See [Plans](Sub/Plans.md), [the goals](Sub/Plans.md) and Missing.",
    );
    expect(vault.shards.get("/vault/Notes/Home.md")).toContain("![](_attachments/cat.png)");
    expect(vault.shards.get("/vault/Notes/Sub/Plans.md")).toContain("[home](../Home.md)");
    expect([...vault.attachments.keys()]).toEqual(["_attachments/cat.png"]);
    expect(vault.copied).toEqual(["/in/Notes/cat.png"]);
    expect(report.created[0].warnings).toEqual(["1 link points to a note that wasn't imported; it's plain text now."]);
  });

  it("moves a shard whose name was taken since it was reserved, and fixes links to it", async () => {
    const vault = memoryImport(
      {
        "Notes/Home.md": "# Home\n\nSee [[Plans]].\n",
        "Notes/Sub/Plans.md": "# Plans\n\nBack to [home](../Home.md).\n",
        "Notes/Sub/Later.md": "# Later\n\nAfter [[Plans]].\n",
      },
      { takenOnSave: ["/vault/Notes/Sub/Plans.md"] },
    );
    const report = await vault.run();

    expect(report.created.map((shard) => shard.path)).toEqual([
      "/vault/Notes/Home.md",
      "/vault/Notes/Sub/Plans_1.md",
      "/vault/Notes/Sub/Later.md",
    ]);
    expect(vault.shards.get("/vault/Notes/Home.md")).toContain("See [Plans](Sub/Plans_1.md).");
    expect(vault.shards.get("/vault/Notes/Sub/Plans_1.md")).toContain("[home](../Home.md)");
    expect(vault.shards.get("/vault/Notes/Sub/Later.md")).toContain("After [Plans](Plans_1.md).");
  });

  it("stores the pictures of dropped files from their bytes", async () => {
    const vault = memoryImport({ "Trip.md": "![](cat.png)\n", "cat.png": PNG }, { dropped: true });
    await vault.run();

    expect(vault.shards.get("/vault/Trip.md")).toContain("![](_attachments/cat.png)");
    expect(vault.attachments.get("_attachments/cat.png")).toEqual(PNG);
    expect(vault.copied).toEqual([]);
  });

  it("brings attachments from where the shard is on disk, as another vault wrote them", async () => {
    const vault = memoryImport(
      {
        "Notes/Trip.md":
          "# Trip\n\n![](_attachments/cat.png)\n\n" +
          '<audio src="_attachments/song.mp3" />\n\n<file name="plan.pdf" src="../_attachments/plan.pdf" />\n\n' +
          "![](beside.png) and ![](_attachments/gone.png)\n\nSee [Hub](../Hub.md).\n",
      },
      {
        from: "/other/Vault",
        disk: {
          "/other/Vault/_attachments/cat.png": PNG,
          "/other/Vault/_attachments/song.mp3": "mp3",
          "/other/Vault/_attachments/plan.pdf": "pdf",
          "/other/Vault/Notes/beside.png": PNG,
          "/other/Vault/Hub.md": "# Hub",
        },
      },
    );
    const report = await vault.run();
    const markdown = vault.shards.get("/vault/Notes/Trip.md")!;

    expect(markdown).toContain("![](_attachments/cat.png)");
    expect(markdown).toContain('<audio src="_attachments/song.mp3" />');
    expect(markdown).toContain('<file name="plan.pdf" src="_attachments/plan.pdf" />');
    expect(markdown).toContain("![](_attachments/beside.png) and ![](_attachments/gone.png)");
    expect(markdown).toContain("See Hub.");
    expect([...vault.attachments.keys()].sort()).toEqual([
      "_attachments/beside.png",
      "_attachments/cat.png",
      "_attachments/plan.pdf",
      "_attachments/song.mp3",
    ]);
    expect(report.attachments.sort()).toEqual([...vault.attachments.keys()].sort());
    expect(report.created[0].warnings).toEqual([
      "1 link points to a note that wasn't imported; it's plain text now.",
      "1 file it uses wasn't found.",
    ]);
  });

  it("leaves attachments behind when asked, with their links as written", async () => {
    const vault = memoryImport(
      { "Trip.md": "![](_attachments/cat.png)\n" },
      { from: "/other/Vault", disk: { "/other/Vault/_attachments/cat.png": PNG } },
    );
    const report = await vault.run({ bringAttachments: false });

    expect(vault.shards.get("/vault/Trip.md")).toBe("![](_attachments/cat.png)\n");
    expect(vault.attachments.size).toBe(0);
    expect(report.created[0].warnings).toEqual([]);
  });

  it("says how to bring the attachments of a dropped shard", async () => {
    const vault = memoryImport({ "Trip.md": "![](_attachments/cat.png)\n" }, { dropped: true });
    const report = await vault.run();

    expect(report.created[0].warnings).toEqual(["1 file it uses wasn't found. Pick it with Files to bring its attachments."]);
  });

  it("reports files it can't read and leaves out ones it doesn't import", async () => {
    const vault = memoryImport({ "Old.doc": "x", "data.bin": "x", "ok.txt": "Fine" });
    const report = await vault.run();

    expect(report.created.map((shard) => shard.source)).toEqual(["ok.txt"]);
    expect(report.skipped).toEqual(["data.bin"]);
    expect(report.failed).toEqual([
      { source: "Old.doc", error: "Old Word files (.doc) can't be imported. Open it in Word and save it as .docx first." },
    ]);
  });

  it("never overwrites a shard", async () => {
    const vault = memoryImport({ "a/Note.txt": "One", "b/Note.txt": "Two" });
    vault.shards.set("/vault/a/Note.md", "Already here");
    await vault.run();

    expect(vault.shards.get("/vault/a/Note.md")).toBe("Already here");
    expect(vault.shards.get("/vault/a/Note_1.md")).toBe("One\n");
    expect(vault.shards.get("/vault/b/Note.md")).toBe("Two\n");
  });

  it("stops when cancelled", async () => {
    const vault = memoryImport({ "a.txt": "A", "b.txt": "B" });
    const controller = new AbortController();
    controller.abort();
    const report = await vault.run({ signal: controller.signal });

    expect(report.cancelled).toBe(true);
    expect(vault.shards.size).toBe(0);
  });
});

describe("formats", () => {
  it("brings Obsidian notes over as Netherstone writes them", async () => {
    const vault = memoryImport({
      "Note.md": "---\ntags: [a]\n---\n> [!warning] Careful\n> Mind the gap.\n\n==marked== %%hidden%% text ^abc123\n",
    });
    await vault.run();
    const markdown = vault.shards.get("/vault/Note.md")!;

    expect(markdown).toMatch(/^---\ntags: \[a\]\n---\n/);
    expect(markdown).toContain('<callout icon="⚠️">\n  **Careful**\n\n  Mind the gap.\n</callout>');
    expect(markdown).toContain("<mark>marked</mark> text\n");
  });

  it("reads web pages with their formatting", async () => {
    const vault = memoryImport({
      "page.html": `<h1>Title</h1>
        <p style="text-align:center"><b>Bold</b> and <span style="color:#ff0000">red</span> <a href="Plans.md">plans</a></p>
        <ul><li>One<ul><li>Two</li></ul></li></ul>
        <table><tr><td colspan="2" bgcolor="#eeeeee">Wide</td></tr><tr><td>a</td><td>b</td></tr></table>
        <img src="data:image/png;base64,iVBORw0KGgo=">`,
      "Plans.md": "# Plans",
    });
    await vault.run();
    const markdown = vault.shards.get("/vault/page.md")!;

    expect(markdown).toContain("# Title");
    expect(markdown).toContain(
      '<div align="center">\n\n**Bold** and <span style="color: #ff0000;">red</span> [plans](Plans.md)\n\n</div>',
    );
    expect(markdown).toContain("- One\n  - Two");
    expect(markdown).toContain("<!-- netherstone: merge A1:B1; fill A1=#eeeeee -->");
    expect(markdown).toContain("![](_attachments/image-1.png)");
  });

  it("makes CSV files a table", async () => {
    const vault = memoryImport({ "list.csv": 'Name,Age\nAda,36\n"Lovelace, A","2"""\n' });
    await vault.run();

    expect(vault.shards.get("/vault/list.md")).toContain("| Lovelace, A | 2\"  |");
  });

  it("keeps the lines of text files", async () => {
    const vault = memoryImport({ "plain.txt": "First line\nsecond line\n\nNew paragraph" });
    await vault.run();

    expect(vault.shards.get("/vault/plain.md")).toBe("First line\\\nsecond line\n\nNew paragraph\n");
  });
});

describe("import window", () => {
  const report = { created: [], attachments: [], skipped: [], failed: [], cancelled: false };

  it("keeps an import running when it's closed, and shows that import when opened again", () => {
    const store = useImportDialogStore.getState();
    store.open("/vault/Inbox");
    store.setJob({ targetDir: "/vault/Inbox", step: { kind: "importing", progress: null }, cancel: () => {} });
    store.close();
    expect(useImportDialogStore.getState().job?.step.kind).toBe("importing");

    store.open("/vault/Other");
    expect(useImportDialogStore.getState().targetDir).toBe("/vault/Inbox");
  });

  it("is done with the import once its summary is closed", () => {
    const store = useImportDialogStore.getState();
    store.setJob({ targetDir: "/vault/Inbox", step: { kind: "done", report, vaultPath: "/vault", since: 0 }, cancel: () => {} });
    store.close();
    expect(useImportDialogStore.getState().job).toBeNull();

    store.open("/vault/Other");
    expect(useImportDialogStore.getState().targetDir).toBe("/vault/Other");
  });
});
