// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { useVaultStore } from "./vault";

describe("recent vaults", () => {
  beforeEach(() => {
    useVaultStore.setState({ currentVaultPath: null, recentVaults: [] });
  });

  it("keeps opened vaults newest first, once each", () => {
    const { setCurrentVaultPath } = useVaultStore.getState();
    setCurrentVaultPath("C:/Notes");
    setCurrentVaultPath("D:/Work");
    setCurrentVaultPath("C:\\Notes\\");

    expect(useVaultStore.getState().recentVaults).toEqual([
      "C:\\Notes\\",
      "D:/Work",
    ]);
  });

  it("remembers the last five", () => {
    const { setCurrentVaultPath } = useVaultStore.getState();
    for (const name of ["a", "b", "c", "d", "e", "f"]) {
      setCurrentVaultPath(`C:/${name}`);
    }

    expect(useVaultStore.getState().recentVaults).toEqual([
      "C:/f",
      "C:/e",
      "C:/d",
      "C:/c",
      "C:/b",
    ]);
  });

  it("forgets a vault whose folder is gone", () => {
    useVaultStore.setState({ recentVaults: ["C:/Notes", "D:/Work"] });
    useVaultStore.getState().forgetRecentVault("D:/Work");

    expect(useVaultStore.getState().recentVaults).toEqual(["C:/Notes"]);
  });
});
