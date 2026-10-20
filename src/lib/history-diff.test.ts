import { describe, expect, it } from "vitest";
import {
  ADDED_MARK,
  BLOCK_CHANGE_KEY,
  REMOVED_MARK,
  diffShardValues,
  hasChanges,
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
