// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();

const exportToBlob = vi.fn(async (_options: unknown) => ({
  arrayBuffer: async () => new ArrayBuffer(3),
}));
vi.mock("@excalidraw/excalidraw", () => ({
  exportToBlob,
  restore: (data: unknown) => data,
}));
vi.mock("@/hooks/useAutosave", () => ({ flushPendingAutosave: vi.fn() }));
vi.mock("@/lib/open-editor-file", () => ({ openEditorFile: vi.fn() }));
vi.mock("@/lib/commands", () => ({
  findShardsContaining: vi.fn(),
  readDrawingFile: async (path: string) => files.get(path) ?? "",
  staleDrawingPictures: vi.fn(),
  persistAttachmentBytes: async (fileName: string) => ({
    assetPath: `_attachments/${fileName}`,
  }),
  readMarkdownFile: async (path: string) => files.get(path) ?? "",
  saveMarkdownFile: async (path: string, content: string) => {
    files.set(path, content);
  },
  appendMarkdownToFile: async (path: string, markdown: string) => {
    files.set(path, `${files.get(path)}\n\n${markdown}\n`);
  },
}));

const { addDrawingToShard, fillDrawingPictures } =
  await import("@/lib/drawing-exports");
const { staleDrawingPictures } = await import("@/lib/commands");
const { openEditorFile } = await import("@/lib/open-editor-file");
const { useEditorStore } = await import("@/store/editor");

const VAULT = "C:/Notes";
const DRAWING = `${VAULT}/Sketches/Plan.excalidraw`;
const SHARD = `${VAULT}/Ideas.md`;
const scene = { elements: [], appState: {}, files: {} };

describe("addDrawingToShard", () => {
  beforeEach(() => {
    files.clear();
    exportToBlob.mockClear();
    vi.mocked(openEditorFile).mockClear();
  });

  it("adds the drawing to the end of the shard, linked to the drawing", async () => {
    files.set(SHARD, "# Ideas");

    const result = await addDrawingToShard(scene, DRAWING, SHARD, VAULT);

    expect(result).toBe("added");
    expect(
      exportToBlob.mock.calls.map(
        ([options]) =>
          (options as { appState: { exportWithDarkMode: boolean } }).appState
            .exportWithDarkMode,
      ),
    ).toEqual([false, true]);
    expect(files.get(SHARD)).toBe(
      '# Ideas\n\n<img src="_attachments/Plan.png" data-dark-src="_attachments/Plan-dark.png" alt="Plan" width="480" data-excalidraw="Sketches/Plan.excalidraw" />\n',
    );
  });

  it("replaces the drawing's image when the shard already shows it, and reloads the open shard", async () => {
    files.set(
      SHARD,
      '<img src="_attachments/old.png" alt="Plan" width="300" data-excalidraw="Sketches/Plan.excalidraw" />',
    );
    useEditorStore.setState({ currentFilePath: SHARD });

    const result = await addDrawingToShard(scene, DRAWING, SHARD, VAULT);

    expect(result).toBe("replaced");
    expect(files.get(SHARD)).toBe(
      '<img src="_attachments/Plan.png" data-dark-src="_attachments/Plan-dark.png" alt="Plan" width="300" data-excalidraw="Sketches/Plan.excalidraw" />',
    );
    expect(openEditorFile).toHaveBeenCalledWith(SHARD);
  });
});

describe("fillDrawingPictures", () => {
  const OTHER = `${VAULT}/Other.excalidraw`;

  beforeEach(() => {
    files.clear();
    exportToBlob.mockClear();
  });

  it("exports only the stale drawings the shard shows, into this shard", async () => {
    const markdown =
      '<img src="" data-dark-src="" alt="Plan" width="300" data-excalidraw="Sketches/Plan.excalidraw" />\n\n' +
      '<img src="_attachments/Other.png" data-dark-src="_attachments/Other-dark.png" alt="Other" width="480" data-excalidraw="Other.excalidraw" />\n';
    files.set(SHARD, markdown);
    files.set(
      DRAWING,
      JSON.stringify({ elements: [{ id: "a", isDeleted: false }] }),
    );
    vi.mocked(staleDrawingPictures).mockResolvedValue([DRAWING]);

    await fillDrawingPictures(SHARD, markdown, VAULT);

    expect(staleDrawingPictures).toHaveBeenCalledWith(VAULT, [
      { drawingPath: DRAWING, imagePaths: [null, null] },
      {
        drawingPath: OTHER,
        imagePaths: [
          `${VAULT}/_attachments/Other.png`,
          `${VAULT}/_attachments/Other-dark.png`,
        ],
      },
    ]);
    expect(files.get(SHARD)).toBe(
      '<img src="_attachments/Plan.png" data-dark-src="_attachments/Plan-dark.png" alt="Plan" width="300" data-excalidraw="Sketches/Plan.excalidraw" />\n\n' +
        '<img src="_attachments/Other.png" data-dark-src="_attachments/Other-dark.png" alt="Other" width="480" data-excalidraw="Other.excalidraw" />\n',
    );
  });

  it("keeps the picture of a drawing that is empty", async () => {
    const markdown =
      '<img src="_attachments/Plan.png" alt="Plan" width="480" data-excalidraw="Sketches/Plan.excalidraw" />';
    files.set(SHARD, markdown);
    files.set(DRAWING, JSON.stringify({ elements: [] }));
    vi.mocked(staleDrawingPictures).mockResolvedValue([DRAWING]);

    await fillDrawingPictures(SHARD, markdown, VAULT);

    expect(exportToBlob).not.toHaveBeenCalled();
    expect(files.get(SHARD)).toBe(markdown);
  });
});
