// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useTagsStore } from "@/store/tags";
import { useUIStore } from "@/store/ui";
import { useVaultStore } from "@/store/vault";
import { DetailsSection } from "./DetailsSection";

const DETAILS = {
  created_at: 0,
  last_modified: 0,
  word_count: 1200,
  character_count: 7000,
  file_size: 7000,
  tags: ["ideas", "work"],
};

describe("DetailsSection", () => {
  beforeEach(() => {
    useVaultStore.setState({ currentVaultPath: "C:/Vault" });
    useUIStore.setState({ appMode: "notes", collapsedSections: {} });
  });
  afterEach(cleanup);

  it("shows the shard's numbers and opens Tags on a tag", () => {
    render(<DetailsSection details={DETAILS} />);

    expect(screen.getByText("1,200")).toBeTruthy();
    expect(screen.getByText("6.84 KB")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "#work" }));

    expect(useUIStore.getState().appMode).toBe("tags");
    expect(useTagsStore.getState()).toMatchObject({
      vaultPath: "C:/Vault",
      selectedTag: "work",
    });
  });

  it("shows nothing while the details load", () => {
    render(<DetailsSection details={undefined} />);

    expect(screen.getByRole("button", { name: /Details/ })).toBeTruthy();
    expect(screen.queryByText("Words")).toBeNull();
  });
});
