import { describe, expect, it } from "vitest";
import {
  ADDED_MARK,
  BLOCK_CHANGE_KEY,
  GAP_BLOCK,
  GAP_INLINE,
  REMOVED_MARK,
  diffShardValues,
  hasChanges,
  sideOf,
} from "./history-diff";

const p = (...children: object[]) => ({
  type: "p",
  id: Math.random().toString(),
  children,
});
const t = (text: string, marks: object = {}) => ({ text, ...marks });
const isInline = (element: Record<string, unknown>) => element.type === "a";

describe("diffShardValues", () => {
  it("shows equal shards unchanged", () => {
    const merged = diffShardValues([p(t("Hello"))], [p(t("Hello"))], isInline);
    expect(hasChanges(merged)).toBe(false);
  });

  it("marks words the version has as added and words only there now as removed", () => {
    const merged = diffShardValues(
      [p(t("Use 350 g water"))],
      [p(t("Use 375 g water"))],
      isInline,
    );
    expect(merged[0].children).toEqual([
      t("Use "),
      t("375", { [REMOVED_MARK]: true }),
      t("350", { [ADDED_MARK]: true }),
      t(" g water"),
    ]);
  });

  it("keeps formatting and links inside changed paragraphs", () => {
    const link = { type: "a", url: "x", children: [t("link")] };
    const merged = diffShardValues(
      [p(t("A "), link, t(" and "), t("bold", { bold: true }))],
      [p(t("A "), link, t(" and more"))],
      isInline,
    );
    const children = merged[0].children;
    expect(children).toContainEqual(link);
    expect(children).toContainEqual(
      t("bold", { bold: true, [ADDED_MARK]: true }),
    );
    expect(children).toContainEqual(t("more", { [REMOVED_MARK]: true }));
  });

  it("marks whole blocks that come back or go away", () => {
    const merged = diffShardValues(
      [p(t("one")), p(t("two"))],
      [
        p(t("one")),
        { type: "img", url: "a.png", children: [t("")] },
        p(t("three")),
        p(t("two")),
      ],
      isInline,
    );
    expect(merged.map((node) => node[BLOCK_CHANGE_KEY])).toEqual([
      undefined,
      "removed",
      "removed",
      undefined,
    ]);
  });

  it("compares blocks of a different kind as removed then added", () => {
    const heading = { type: "h1", children: [t("Title")] };
    const merged = diffShardValues([heading], [p(t("Title"))], isInline);
    expect(merged.map((node) => node[BLOCK_CHANGE_KEY])).toEqual([
      "removed",
      "added",
    ]);
  });

  it("looks inside tables", () => {
    const table = (cell: string) => ({
      type: "table",
      children: [
        { type: "tr", children: [{ type: "td", children: [p(t(cell))] }] },
      ],
    });
    const merged = diffShardValues(
      [table("old cell")],
      [table("new cell")],
      isInline,
    );
    const cell = merged[0].children[0].children[0].children[0];
    expect(cell.children).toEqual([
      t("new", { [REMOVED_MARK]: true }),
      t("old", { [ADDED_MARK]: true }),
      t(" cell"),
    ]);
  });

  it("keeps text around inline elements", () => {
    const link = { type: "a", url: "x", children: [t("new link")] };
    const merged = diffShardValues([p(link)], [p(t("plain"))], isInline);
    const children = merged[0].children;
    expect(children[0]).toEqual(t("plain", { [REMOVED_MARK]: true }));
    expect(children[children.length - 1]).toEqual(t(""));
  });
});

describe("sideOf", () => {
  const merged = () =>
    diffShardValues(
      [p(t("Use 350 g water")), p(t("Only in the version"))],
      [p(t("Use 375 g water")), p(t("Only now"))],
      isInline,
    );
  const strip = (nodes: any[]) =>
    nodes.map(({ id: _id, ...node }) => node);

  it("shows the version with its own words marked", () => {
    const [first, second] = strip(sideOf(merged(), "version"));
    expect(first.children).toEqual([
      t("Use "),
      t("350", { [ADDED_MARK]: true }),
      t(" g water"),
    ]);
    expect(JSON.stringify(second)).not.toContain("Only now");
  });

  it("shows the shard as it is now with its own words marked", () => {
    const side = strip(sideOf(merged(), "current"));
    expect(side[0].children).toEqual([
      t("Use "),
      t("375", { [ADDED_MARK]: true }),
      t(" g water"),
    ]);
    expect(JSON.stringify(side)).not.toContain(REMOVED_MARK);
    expect(JSON.stringify(side)).not.toContain("Only in the version");
  });

  it("marks where a link only the other side has is", () => {
    const link = { type: "a", url: "x", children: [t("link")] };
    const both = diffShardValues(
      [p(t("A "), link, t(" b"))],
      [p(t("A b"))],
      isInline,
    );
    const current = sideOf(both, "current");
    expect(JSON.stringify(current)).not.toContain('"url"');
    expect(JSON.stringify(current)).toContain(GAP_INLINE);
    const version = sideOf(both, "version");
    expect(JSON.stringify(version)).toContain('"url"');
  });

  it("marks where words only the other side has are", () => {
    const both = diffShardValues(
      [p(t("Use cold water"))],
      [p(t("Use water"))],
      isInline,
    );
    const current = strip(sideOf(both, "current"));
    expect(current[0].children).toEqual([
      t("Use "),
      { type: GAP_INLINE, children: [t("")] },
      t("water"),
    ]);
  });

  it("doesn't mark a gap next to words that took the other side's place", () => {
    const side = sideOf(merged(), "current");
    expect(JSON.stringify(side)).not.toContain(GAP_INLINE);
    expect(JSON.stringify(side)).not.toContain(GAP_BLOCK);
  });

  it("marks one gap where blocks only the other side has are", () => {
    const both = diffShardValues(
      [p(t("A")), p(t("New 1")), p(t("New 2")), p(t("B"))],
      [p(t("A")), p(t("B"))],
      isInline,
    );
    const types = sideOf(both, "current").map((node) => node.type);
    expect(types).toEqual(["p", GAP_BLOCK, "p"]);
  });
});
