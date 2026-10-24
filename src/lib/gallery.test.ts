import { describe, expect, it } from "vitest";

import {
  filesInRow,
  getRowTitle,
  isAttachmentOnlyChange,
  isAttachmentPath,
  matchesFileFilter,
  type GalleryFile,
} from "./gallery";

const file = (
  name: string,
  kind: GalleryFile["kind"],
  ...shardPaths: string[]
): GalleryFile => ({
  assetPath: `_attachments/${name}`,
  darkAssetPath: null,
  name,
  kind,
  sizeBytes: 1,
  addedAt: 0,
  shardPaths,
});

const files = [
  file("Trip.jpg", "image", "/vault/Trip.md"),
  file("Map.png", "drawing", "/vault/Trip.md", "/vault/Plan.md"),
  file("Guide.pdf", "pdf"),
];

describe("gallery rows", () => {
  it("shows every file, one kind, or the unused ones", () => {
    expect(filesInRow(files, "all")).toHaveLength(3);
    expect(filesInRow(files, "drawing").map((f) => f.name)).toEqual([
      "Map.png",
    ]);
    expect(filesInRow(files, "unused").map((f) => f.name)).toEqual([
      "Guide.pdf",
    ]);
    expect(filesInRow(files, "audio")).toEqual([]);
  });

  it("titles the page after the row", () => {
    expect(getRowTitle("all")).toBe("All files");
    expect(getRowTitle("pdf")).toBe("PDFs");
    expect(getRowTitle("other")).toBe("Other files");
    expect(getRowTitle("unused")).toBe("Not used");
  });

  it("filters by file name", () => {
    expect(matchesFileFilter(files[0], " trip ")).toBe(true);
    expect(matchesFileFilter(files[0], "pdf")).toBe(false);
  });
});

describe("attachment changes", () => {
  it("tells attachment files from shards with either separator", () => {
    expect(isAttachmentPath("C:/Notes/_attachments/Trip.jpg", "C:\\Notes")).toBe(
      true,
    );
    expect(isAttachmentPath("/vault/_attachments/ab/old.pdf", "/vault/")).toBe(
      true,
    );
    expect(isAttachmentPath("/vault/Trip.md", "/vault")).toBe(false);
    expect(isAttachmentPath("/vault/_attachments-old/a.png", "/vault")).toBe(
      false,
    );
  });

  it("is attachment only when every path is an attachment", () => {
    const pic = "/vault/_attachments/Trip.jpg";
    expect(isAttachmentOnlyChange([pic], "/vault")).toBe(true);
    expect(isAttachmentOnlyChange([pic, "/vault/Trip.md"], "/vault")).toBe(
      false,
    );
    // No paths means anything may have changed.
    expect(isAttachmentOnlyChange([], "/vault")).toBe(false);
  });
});
