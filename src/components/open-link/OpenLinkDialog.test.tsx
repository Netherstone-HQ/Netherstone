// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { copy as vaultCopy } from "@/components/onboarding/copy";
import type { LinkListing, LinkProgress, LinkRefusal } from "@/lib/commands";
import { openEditorFile } from "@/lib/open-editor-file";
import { openLink, useOpenLink } from "@/lib/open-link";
import { useUIStore, useVaultStore } from "@/store";
import { copy } from "./copy";
import { OpenLinkDialog, formatSize } from "./OpenLinkDialog";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    onmessage: (message: unknown) => void = () => {};
  },
}));
vi.mock("@/lib/open-editor-file", () => ({ openEditorFile: vi.fn(async () => {}) }));
vi.mock("@/lib/nested-vault", () => ({ chooseVaultFolder: async (folder: string) => folder }));
vi.mock("@/lib/refresh-vault", () => ({ refreshVault: vi.fn(async () => {}) }));
vi.mock("@/lib/open-vault", async (original) => ({
  ...(await original<typeof import("@/lib/open-vault")>()),
  openVault: vi.fn(async (path: string) => useVaultStore.setState({ currentVaultPath: path })),
}));

const DOCUMENTS = "/home/me/Documents";
const TEMPLATE = "netherstone.app/templates/worldbuilding";
const FOLDER = "github.com/lena-k/field-guide";

const template: LinkListing = {
  template: true,
  name: "Worldbuilding",
  address: TEMPLATE,
  files: 16,
  shards: 0,
  pictures: 0,
  leftOut: 0,
  size: 48213,
};

const folder: LinkListing = {
  template: false,
  name: "field-guide",
  address: FOLDER,
  files: 180,
  shards: 142,
  pictures: 38,
  leftOut: 12,
  size: 41 * 1024 * 1024,
};

type Handlers = Record<string, (args: Record<string, unknown>) => unknown>;

function mockCommands(handlers: Handlers) {
  vi.mocked(invoke).mockImplementation(async (command, args) => {
    const all: Handlers = { default_vault_location: () => DOCUMENTS, open_link_done: () => {}, ...handlers };
    const handler = all[command];
    return handler ? handler((args ?? {}) as Record<string, unknown>) : undefined;
  });
}

function refuse(refusal: LinkRefusal) {
  return () => Promise.reject(refusal);
}

async function open(address: string) {
  render(<OpenLinkDialog />);
  await act(() => openLink(address));
}

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  useOpenLink.setState({ address: null, step: null, stopAdding: null });
  useVaultStore.setState({ currentVaultPath: null, fileTree: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Opening a Netherstone link", () => {
  it("adds a template as a new vault and opens its first shard", async () => {
    let finish: (value: unknown) => void = () => {};
    mockCommands({
      open_link_list: () => template,
      open_link_create: () => new Promise((resolve) => (finish = resolve)),
    });
    await open(TEMPLATE);

    expect(screen.getByRole("heading", { name: copy.template.title("Worldbuilding") })).toBeTruthy();
    expect(screen.getByText(copy.template.from)).toBeTruthy();
    expect(screen.getByRole("textbox")).toHaveProperty("value", "Worldbuilding");
    fireEvent.click(await screen.findByRole("button", { name: vaultCopy.vault.create.submit }));

    expect(await screen.findByRole("button", { name: copy.template.downloading("Worldbuilding") })).toBeTruthy();
    expect(screen.getByRole("textbox")).toHaveProperty("disabled", true);
    expect(invoke).toHaveBeenCalledWith(
      "open_link_create",
      expect.objectContaining({ address: TEMPLATE, parent: DOCUMENTS, name: "Worldbuilding" }),
    );

    const vault = `${DOCUMENTS}/Worldbuilding`;
    await act(async () => finish({ vault, firstShard: `${vault}/Start here.md`, sources: [] }));
    await waitFor(() => expect(useOpenLink.getState().step).toBeNull());
    expect(useVaultStore.getState().currentVaultPath).toBe(vault);
    expect(openEditorFile).toHaveBeenCalledWith(`${vault}/Start here.md`);
    expect(invoke).toHaveBeenCalledWith("open_link_done");
  });

  it("shows what's in another folder, where it's from and that it isn't a template", async () => {
    mockCommands({ open_link_list: () => folder });
    await open(FOLDER);

    expect(screen.getByRole("heading", { name: copy.folder.title("field-guide") })).toBeTruthy();
    expect(screen.getByText(FOLDER)).toBeTruthy();
    expect(screen.getByText(/142 shards/).textContent).toBe("142 shards38 pictures41 MB");
    expect(screen.getByText(copy.folder.leftOut(12))).toBeTruthy();
    expect(screen.getByText(copy.folder.warning)).toBeTruthy();
    expect(screen.getByRole("textbox")).toHaveProperty("value", "field-guide");
  });

  it("shows a folder's download and cancels it", async () => {
    let send: (progress: LinkProgress) => void = () => {};
    mockCommands({
      open_link_list: () => folder,
      open_link_create: ({ progress }) => {
        send = (message) => (progress as { onmessage: (message: LinkProgress) => void }).onmessage(message);
        return new Promise(() => {});
      },
    });
    await open(FOLDER);
    fireEvent.click(await screen.findByRole("button", { name: vaultCopy.vault.create.submit }));
    await waitFor(() => expect(useOpenLink.getState().step?.kind).toBe("downloading"));

    act(() => send({ stage: "shards", done: 38, total: 142, bytes: 10, totalBytes: 40 }));
    expect(screen.getByText(copy.folder.downloading.shards(38, 142))).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: copy.folder.cancel }));
    expect(invoke).toHaveBeenCalledWith("open_link_cancel");
  });

  it("brings a folder in through the Markdown import", async () => {
    const vault = `${DOCUMENTS}/field-guide`;
    mockCommands({
      open_link_list: () => folder,
      open_link_create: () => ({ vault, firstShard: null, sources: [] }),
    });
    await open(FOLDER);
    fireEvent.click(await screen.findByRole("button", { name: vaultCopy.vault.create.submit }));
    await waitFor(() => expect(useOpenLink.getState().step).toBeNull());
    expect(useVaultStore.getState().currentVaultPath).toBe(vault);
    expect(invoke).toHaveBeenCalledWith("open_link_done");
  });

  it("keeps the form when the vault's name can't be used", async () => {
    mockCommands({
      open_link_list: () => folder,
      open_link_create: refuse({ code: "vault", error: "vault-folder-not-empty" }),
    });
    await open(FOLDER);
    fireEvent.click(await screen.findByRole("button", { name: vaultCopy.vault.create.submit }));
    expect(await screen.findByText(vaultCopy.vault.errors["vault-folder-not-empty"])).toBeTruthy();
    expect(useOpenLink.getState().step?.kind).toBe("ready");
  });

  it("says when there isn't enough space", async () => {
    mockCommands({
      open_link_list: () => folder,
      open_link_create: refuse({ code: "not-enough-space", needed: 41 * 1024 * 1024, free: 12 * 1024 * 1024, folder: "Documents" }),
    });
    await open(FOLDER);
    fireEvent.click(await screen.findByRole("button", { name: vaultCopy.vault.create.submit }));
    expect(await screen.findByRole("heading", { name: copy.refused.notEnoughSpace.title })).toBeTruthy();
    expect(screen.getByText("field-guide needs 41 MB and Documents has 12 MB free")).toBeTruthy();
  });

  it("asks for an update when a template needs a newer app", async () => {
    mockCommands({ open_link_list: refuse({ code: "update-first", name: "Worldbuilding", version: "0.7" }) });
    await open(TEMPLATE);
    expect(screen.getByRole("heading", { name: copy.refused.updateFirst.title })).toBeTruthy();
    expect(screen.getByText("Worldbuilding needs Netherstone 0.7 or later")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: copy.refused.updateFirst.update }));
    expect(useUIStore.getState().settingsCategory).toBe("about");
    await waitFor(() => expect(useOpenLink.getState().step).toBeNull());
  });

  it.each([
    [{ code: "template-not-found" }, copy.refused.templateNotFound.title],
    [{ code: "cant-open" }, copy.refused.cantOpen.title],
    [{ code: "nothing-to-open" }, copy.refused.nothingToOpen.title],
    [{ code: "too-many-files" }, copy.refused.tooManyFiles.title],
    [{ code: "download-failed" }, copy.refused.downloadFailed.title(null)],
  ] as [LinkRefusal, string][])("says why it can't open: %o", async (refusal, title) => {
    mockCommands({ open_link_list: refuse(refusal) });
    await open(FOLDER);
    expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: copy.refused.ok }));
    await waitFor(() => expect(useOpenLink.getState().step).toBeNull());
  });

  it("writes sizes the way the dialog shows them", () => {
    expect(formatSize(900)).toBe("900 B");
    expect(formatSize(48213)).toBe("47 KB");
    expect(formatSize(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(formatSize(41 * 1024 * 1024)).toBe("41 MB");
  });
});
