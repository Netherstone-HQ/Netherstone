// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { describeMissingAttachment } from "@/lib/commands";
import { useVaultStore } from "@/store/vault";
import {
  LinkedFileDetails,
  MediaFileRow,
  MissingVaultFileRow,
  VaultFileDetails,
} from "./media-file-row";

vi.mock("@/lib/commands", () => ({ describeMissingAttachment: vi.fn() }));

function renderRow(row: React.ReactNode) {
  return render(<TooltipProvider>{row}</TooltipProvider>);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useVaultStore.setState({ currentVaultPath: null });
});

describe("MediaFileRow", () => {
  it("shows a file's type and size, and opens it on click", () => {
    const onOpen = vi.fn();
    renderRow(
      <MediaFileRow
        name="Kitchen quote.pdf"
        details={
          <VaultFileDetails
            metadata={{
              netherstoneExtension: "pdf",
              netherstoneSizeBytes: 1_240_000,
              netherstoneSyncStatus: "syncable",
            }}
          />
        }
        onOpen={onOpen}
      />,
    );

    expect(screen.getByText("PDF · 1.2 MB")).toBeTruthy();
    expect(screen.queryByText("Won't sync")).toBeNull();
    fireEvent.click(screen.getByText("Kitchen quote.pdf"));
    expect(onOpen).toHaveBeenCalled();
  });

  it("says when a file won't sync", () => {
    renderRow(
      <MediaFileRow
        name="Floor plans.pdf"
        details={
          <VaultFileDetails
            metadata={{
              netherstoneExtension: "pdf",
              netherstoneSizeBytes: 32_500_000,
              netherstoneSyncStatus: "local_only",
            }}
          />
        }
      />,
    );

    expect(screen.getByText("Won't sync")).toBeTruthy();
  });

  it("marks a linked file", () => {
    renderRow(
      <MediaFileRow
        name="Site photos.pdf"
        details={<LinkedFileDetails metadata={{}} />}
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
