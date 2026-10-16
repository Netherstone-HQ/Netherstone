// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadStore() {
  vi.resetModules();
  const mod = await import("./ui");
  await mod.useUIStore.persist.rehydrate();
  return mod;
}

const PLAN = { path: "C:/Notes/Work/Plan.md", name: "Plan.md" };
const IDEAS = { path: "C:/Notes/Ideas.md", name: "Ideas.md" };

describe("pinned files", () => {
  beforeEach(() => localStorage.clear());

  it("pins a file once and unpins it the second time", async () => {
    const { useUIStore } = await loadStore();
    const { togglePinnedFile } = useUIStore.getState();

    togglePinnedFile(PLAN);
    expect(useUIStore.getState().pinnedFiles).toEqual([PLAN]);

    togglePinnedFile(PLAN);
    expect(useUIStore.getState().pinnedFiles).toEqual([]);
  });

  it("follows a renamed folder, like recent files", async () => {
    const { useUIStore } = await loadStore();
    useUIStore.setState({ pinnedFiles: [PLAN, IDEAS], recentFiles: [PLAN] });

    useUIStore
      .getState()
      .remapRememberedPaths("C:/Notes/Work", "C:/Notes/Projects");

    const moved = { path: "C:/Notes/Projects/Plan.md", name: "Plan.md" };
    expect(useUIStore.getState().pinnedFiles).toEqual([moved, IDEAS]);
    expect(useUIStore.getState().recentFiles).toEqual([moved]);
  });

  it("forgets files inside a folder sent to the trash", async () => {
    const { useUIStore } = await loadStore();
    useUIStore.setState({ pinnedFiles: [PLAN, IDEAS], recentFiles: [PLAN] });

    useUIStore.getState().forgetRememberedPaths("C:/Notes/Work");

    expect(useUIStore.getState().pinnedFiles).toEqual([IDEAS]);
    expect(useUIStore.getState().recentFiles).toEqual([]);
  });

  it("remembers pins and collapsed sections across restarts", async () => {
    const first = await loadStore();
    first.useUIStore.getState().togglePinnedFile(PLAN);
    first.useUIStore.getState().toggleSection("recent");

    const { useUIStore } = await loadStore();
    expect(useUIStore.getState().pinnedFiles).toEqual([PLAN]);
    expect(useUIStore.getState().collapsedSections).toEqual({ recent: true });
  });
});

describe("rail modes", () => {
  beforeEach(() => localStorage.clear());

  it("shows one mode at a time and closes Settings", async () => {
    const { useUIStore, selectRailMode } = await loadStore();
    const { openMode, setActiveNavItem } = useUIStore.getState();

    openMode("tags");
    expect(selectRailMode(useUIStore.getState())).toBe("tags");

    openMode("canvas");
    expect(selectRailMode(useUIStore.getState())).toBe("canvas");

    setActiveNavItem("settings");
    expect(selectRailMode(useUIStore.getState())).toBeNull();

    openMode("editor");
    expect(selectRailMode(useUIStore.getState())).toBe("editor");
    expect(useUIStore.getState().activeNavItem).toBeNull();
  });

  it("returns to the mode Settings was opened from", async () => {
    const { useUIStore, selectRailMode } = await loadStore();
    const { openMode, setActiveNavItem } = useUIStore.getState();

    openMode("tags");
    setActiveNavItem("settings");
    setActiveNavItem(null);
    expect(selectRailMode(useUIStore.getState())).toBe("tags");
  });
});

describe("revealing a folder in the tree", () => {
  beforeEach(() => localStorage.clear());

  it("opens the left sidebar, and a later reveal outlasts an earlier one", async () => {
    const { useUIStore } = await loadStore();
    useUIStore.setState({ isSidebarOpen: false });
    const { revealInTree, endTreeReveal } = useUIStore.getState();

    revealInTree("C:/Notes/Work");
    const first = useUIStore.getState().treeReveal!;
    expect(useUIStore.getState().isSidebarOpen).toBe(true);

    revealInTree("C:/Notes/Work");
    endTreeReveal(first);
    expect(useUIStore.getState().treeReveal).not.toBeNull();
    expect(useUIStore.getState().treeReveal).not.toBe(first);

    endTreeReveal(useUIStore.getState().treeReveal!);
    expect(useUIStore.getState().treeReveal).toBeNull();
  });
});
