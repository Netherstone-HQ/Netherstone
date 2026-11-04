import { describe, expect, it } from "vitest";

import { UPDATER_BUNDLES, updaterJson } from "./updater-json.mjs";

const version = "0.6.0-beta.5";
const tag = `v${version}`;
const names = UPDATER_BUNDLES.map((bundle) => bundle.name(version));

/** A release with every updater bundle and its signature. */
const release = {
  tag_name: tag,
  assets: names.flatMap((name) => [{ name }, { name: `${name}.sig` }]),
};
const signatures = Object.fromEntries(names.map((name) => [`${name}.sig`, `sig of ${name}`]));

describe("updaterJson", () => {
  it("lists every platform with its signature and tagged link", () => {
    const json = updaterJson(release, signatures, "2026-11-04T21:00:00.000Z");
    expect(json.version).toBe(version);
    expect(json.notes).toBe("");
    expect(json.pub_date).toBe("2026-11-04T21:00:00.000Z");
    expect(Object.keys(json.platforms).sort()).toEqual([
      "darwin-aarch64",
      "darwin-aarch64-app",
      "darwin-x86_64",
      "darwin-x86_64-app",
      "linux-x86_64",
      "linux-x86_64-appimage",
      "linux-x86_64-deb",
      "linux-x86_64-rpm",
      "windows-x86_64",
      "windows-x86_64-nsis",
    ]);
    expect(json.platforms["windows-x86_64"]).toEqual({
      signature: `sig of Netherstone_${version}_x64-setup.exe`,
      url: `https://github.com/Netherstone-HQ/Netherstone/releases/download/${tag}/Netherstone_${version}_x64-setup.exe`,
    });
    expect(json.platforms["darwin-aarch64-app"]).toEqual(json.platforms["darwin-aarch64"]);
  });

  it("fails when a bundle is missing", () => {
    const partial = {
      ...release,
      assets: release.assets.filter((asset) => !asset.name.startsWith("Netherstone_aarch64")),
    };
    expect(() => updaterJson(partial, signatures, "")).toThrow(
      `${tag} has no Netherstone_aarch64.app.tar.gz.`,
    );
  });

  it("fails when a signature is missing or empty", () => {
    const unsigned = { ...signatures, "Netherstone_x64.app.tar.gz.sig": "" };
    expect(() => updaterJson(release, unsigned, "")).toThrow(
      `${tag} has no signature for Netherstone_x64.app.tar.gz.`,
    );
  });
});
