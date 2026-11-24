import { describe, expect, it } from "vitest";
import { deletedLabel, folderOf } from "./trash";

describe("deletedLabel", () => {
  const now = new Date(2026, 10, 24, 9, 30);
  const at = (year: number, month: number, day: number, hour = 12) =>
    new Date(year, month, day, hour).getTime();

  it("counts days for the last week", () => {
    expect(deletedLabel(at(2026, 10, 24, 8), now)).toBe("Deleted today");
    expect(deletedLabel(at(2026, 10, 23, 23), now)).toBe("Deleted yesterday");
    expect(deletedLabel(at(2026, 10, 21), now)).toBe("Deleted 3 days ago");
    expect(deletedLabel(at(2026, 10, 18), now)).toBe("Deleted 6 days ago");
  });

  it("gives the date after that, with the year only when it's another one", () => {
    const sameYear = new Date(at(2026, 10, 12)).toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
    });
    expect(deletedLabel(at(2026, 10, 12), now)).toBe(`Deleted ${sameYear}`);
    expect(deletedLabel(at(2025, 0, 3), now)).toMatch(/2025/);
  });
});

describe("folderOf", () => {
  it("shows the folder inside the vault", () => {
    expect(folderOf("/data/My Vault/Journal/2026/day.md", "/data/My Vault")).toBe(
      "Journal/2026",
    );
  });

  it("shows the vault's name for its top level", () => {
    expect(folderOf("/data/My Vault/day.md", "/data/My Vault")).toBe("My Vault");
  });

  it("takes Windows paths too", () => {
    expect(folderOf("C:\\Vaults\\Notes\\Ideas\\one.md", "C:\\Vaults\\Notes")).toBe(
      "Ideas",
    );
  });
});
