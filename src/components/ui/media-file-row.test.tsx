// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { attachmentSyncInfo, describeMissingAttachment } from "@/lib/commands";
import { useVaultStore } from "@/store/vault";
import {
  LinkedFileDetails,
  MediaFileRow,
  MissingVaultFileRow,
  VaultFileDetails,
} from "./media-file-row";

vi.mock("@/lib/commands", () => ({
  attachmentSyncInfo: vi.fn(),
  describeMissingAttachment: vi.fn(),
}));

const LIMIT = 20 * 1024 * 1024;

/** A vault file whose sync check finds `info`. */
function vaultFile(info: Awaited<ReturnType<typeof attachmentSyncInfo>>) {
  useVaultStore.setState({ currentVaultPath: "C:/Vault" });
  vi.mocked(attachmentSyncInfo).mockResolvedValue(info);
}

function renderRow(row: React.ReactNode) {
  return render(<TooltipProvider>{row}</TooltipProvider>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useVaultStore.setState({ currentVaultPath: null });
});

describe("MediaFileRow", () => {
  it("shows a file's type and size, and opens it on click", async () => {
    vaultFile({
      extension: "pdf",
      sizeBytes: 1_240_000,
      syncStatus: "syncable",
      syncLimitBytes: LIMIT,
    });
    const onOpen = vi.fn();
    renderRow(
      <MediaFileRow
        name="Kitchen quote.pdf"
        details={
          <VaultFileDetails metadata={{ url: "_attachments/Kitchen quote.pdf" }} />
        }
        onOpen={onOpen}
      />,
    );

    expect(await screen.findByText("PDF · 1.2 MB")).toBeTruthy();
    expect(attachmentSyncInfo).toHaveBeenCalledWith(
      "C:/Vault",
      "_attachments/Kitchen quote.pdf",
    );
    expect(screen.queryByText("Won't sync")).toBeNull();
    fireEvent.click(screen.getByText("Kitchen quote.pdf"));
    expect(onOpen).toHaveBeenCalled();
  });

  it("says when a file won't sync", async () => {
    vaultFile({
      extension: "pdf",
      sizeBytes: 32_500_000,
      syncStatus: "local_only",
      syncLimitBytes: LIMIT,
    });
    renderRow(
      <MediaFileRow
        name="Floor plans.pdf"
        details={
          <VaultFileDetails metadata={{ url: "_attachments/Floor plans.pdf" }} />
        }
      />,
    );

    expect(await screen.findByText("Won't sync")).toBeTruthy();
  });

  it("goes by the file as it is now, not what the shard saved", async () => {
    vaultFile({
      extension: "mp3",
      sizeBytes: 4_200_000,
      syncStatus: "syncable",
      syncLimitBytes: LIMIT,
    });
    const saved = {
      url: "_attachments/Interview.mp3",
      netherstoneExtension: "mp3",
      netherstoneSizeBytes: 900,
      netherstoneSyncStatus: "local_only",
    };
    renderRow(
      <MediaFileRow
        name="Interview.mp3"
        details={<VaultFileDetails metadata={saved} />}
      />,
    );

    expect(await screen.findByText("MP3 · 4.0 MB")).toBeTruthy();
    expect(screen.queryByText("Won't sync")).toBeNull();
  });

  it("marks a linked file", () => {
    renderRow(
      <MediaFileRow
        name="Site photos.pdf"
        details={<LinkedFileDetails />}
      />,
    );

    expect(screen.getByText("Linked")).toBeTruthy();
  });

  it("offers a renamed file with the same content when one is missing", async () => {
    useVaultStore.setState({ currentVaultPath: "C:/Vault" });
    vi.mocked(describeMissingAttachment).mockResolvedValue({
      originalName: "Kitchen quote.pdf",
      foundAbsolutePath: "C:/Vault/_attachments/Kitchen quote (2).pdf",
    } as Awaited<ReturnType<typeof describeMissingAttachment>>);
    const onRelinkTo = vi.fn();

    renderRow(
      <MissingVaultFileRow
        attachmentPath="C:/Vault/_attachments/Kitchen quote.pdf"
        onRelink={() => {}}
        onRelinkTo={onRelinkTo}
      />,
    );

    expect(screen.getByText("Not found")).toBeTruthy();
    fireEvent.click(
      await screen.findByRole("button", { name: "Use Kitchen quote (2).pdf" }),
    );
    expect(onRelinkTo).toHaveBeenCalledWith(
      "C:/Vault/_attachments/Kitchen quote (2).pdf",
    );
  });
});
