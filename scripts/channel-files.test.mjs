import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ASSETS, assetUrl, renderTemplate, tagVersion } from "./channel-files.mjs";

const packaging = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "packaging");
const version = "0.6.0-beta.2";

/** A release with every asset package managers install. */
const release = {
  tag_name: `v${version}`,
  assets: Object.values(ASSETS).map((name, index) => ({
    name: name(version),
    digest: `sha256:${String(index).repeat(64)}`,
  })),
};

describe("tagVersion", () => {
  it("drops the v", () => {
    expect(tagVersion("v0.6.0-beta.2")).toBe("0.6.0-beta.2");
  });

  it("refuses tags that aren't versions", () => {
    expect(() => tagVersion("updates")).toThrow("not a version tag");
  });
});

describe("renderTemplate", () => {
  it("fills in versions, links and checksums", () => {
    const text = renderTemplate(
      "{{version}} {{pkgver}} {{url.macArm}} {{sha256.macIntel}}",
      release,
    );
    expect(text).toBe(
      `0.6.0-beta.2 0.6.0beta.2 ${assetUrl("macArm", version)} ${"1".repeat(64)}`,
    );
    expect(assetUrl("macArm", version)).toBe(
      "https://github.com/Netherstone-HQ/Netherstone/releases/download/v0.6.0-beta.2/Netherstone_0.6.0-beta.2_aarch64.dmg",
    );
  });

  it("fails when the release lacks an asset", () => {
    const older = { ...release, assets: release.assets.slice(0, 3) };
    expect(() => renderTemplate("{{sha256.linuxTarball}}", older)).toThrow(
      "v0.6.0-beta.2 has no Netherstone_0.6.0-beta.2_linux-x86_64.tar.gz.",
    );
  });

  it("fails on an asset without a digest", () => {
    const undigested = {
      ...release,
      assets: release.assets.map((asset) => ({ ...asset, digest: null })),
    };
    expect(() => renderTemplate("{{sha256.macArm}}", undigested)).toThrow(
      "has no SHA-256 digest",
    );
  });

  it("fails on an unknown placeholder", () => {
    expect(() => renderTemplate("{{name}}", release)).toThrow("Unknown placeholder");
    expect(() => renderTemplate("{{url.snap}}", release)).toThrow("no asset called snap");
  });

  it("fills in every packaging file", () => {
    for (const channel of readdirSync(packaging)) {
      for (const file of readdirSync(path.join(packaging, channel))) {
        const text = renderTemplate(
          readFileSync(path.join(packaging, channel, file), "utf8"),
          release,
        );
        expect(text).not.toContain("{{");
      }
    }
  });
});
