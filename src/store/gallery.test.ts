import { beforeEach, describe, expect, it, vi } from "vitest";

const listAttachments = vi.fn();
vi.mock("@/lib/gallery", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/gallery")>()),
  listAttachments: (vaultPath: string) => listAttachments(vaultPath),
}));

const { useGalleryStore, selectActiveRow } = await import("./gallery");

const pdf = {
  assetPath: "_attachments/Guide.pdf",
  darkAssetPath: null,
  name: "Guide.pdf",
  kind: "pdf",
  sizeBytes: 1,
  addedAt: 0,
  shardPaths: [],
};

describe("useGalleryStore", () => {
  beforeEach(() => {
    listAttachments.mockReset().mockResolvedValue([pdf]);
    useGalleryStore.setState({
      vaultPath: null,
      files: [],
      status: "idle",
      isStale: true,
      selectedRow: "all",
      filter: "",
    });
  });

  it("loads once, then again only after files change", async () => {
    const { load, invalidate } = useGalleryStore.getState();

    await load("/vault");
    await load("/vault");
    expect(listAttachments).toHaveBeenCalledTimes(1);
    expect(listAttachments).toHaveBeenCalledWith("/vault");
    expect(useGalleryStore.getState().status).toBe("ready");

    invalidate();
    await load("/vault");
    expect(listAttachments).toHaveBeenCalledTimes(2);
  });

  it("starts over in another vault", async () => {
    const { load, selectRow, setFilter } = useGalleryStore.getState();
    await load("/vault");
    selectRow("pdf");
    setFilter("guide");

    await load("/other");
    expect(useGalleryStore.getState()).toMatchObject({
      vaultPath: "/other",
      selectedRow: "all",
      filter: "",
    });
  });

  it("falls back to All files once the picked row is empty", async () => {
    const { load, selectRow } = useGalleryStore.getState();
    await load("/vault");

    selectRow("unused");
    expect(selectActiveRow(useGalleryStore.getState())).toBe("unused");
    selectRow("image");
    expect(selectActiveRow(useGalleryStore.getState())).toBe("all");
  });

  it("keeps the last list and reloads after a failed load", async () => {
    const { load } = useGalleryStore.getState();
    await load("/vault");
    listAttachments.mockRejectedValueOnce(new Error("locked"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    useGalleryStore.getState().invalidate();
    await load("/vault");
    expect(useGalleryStore.getState()).toMatchObject({
      status: "error",
      isStale: true,
      files: [pdf],
    });
  });
});
