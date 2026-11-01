// Package manager files for scripts/channels.mjs, kept free of the network and
// the filesystem so they can be tested on their own.
//
// Each channel's files live in packaging/<channel>/ with placeholders:
//
//   {{version}}       the app version, e.g. 0.6.0-beta.2
//   {{pkgver}}        the version without "-", for pacman (0.6.0beta.2)
//   {{url.<asset>}}   the download link of a release asset (see ASSETS)
//   {{sha256.<asset>}} its SHA-256, from the release's asset digests

import { parseVersion } from "./release-version.mjs";

const REPOSITORY = "Netherstone-HQ/Netherstone";

/** The release assets package managers install, by version. */
export const ASSETS = {
  macArm: (version) => `Netherstone_${version}_aarch64.dmg`,
  macIntel: (version) => `Netherstone_${version}_x64.dmg`,
  windowsSetup: (version) => `Netherstone_${version}_x64-setup.exe`,
  // The Linux app without the updater, for package managers that update it.
  linuxTarball: (version) => `Netherstone_${version}_linux-x86_64.tar.gz`,
};

/** The version a tag like "v0.6.0-beta.2" releases. Anything else is refused. */
export function tagVersion(tag) {
  const version = tag.replace(/^v/, "");
  if (!parseVersion(version)) throw new Error(`${tag} is not a version tag.`);
  return version;
}

export function assetName(key, version) {
  const name = ASSETS[key];
  if (!name) throw new Error(`There is no asset called ${key}.`);
  return name(version);
}

export function assetUrl(key, version) {
  return `https://github.com/${REPOSITORY}/releases/download/v${version}/${assetName(key, version)}`;
}

/**
 * Fills in a template for the release, as GitHub's API returns it. Fails on
 * an unknown placeholder or an asset the release doesn't have.
 */
export function renderTemplate(template, release) {
  const version = tagVersion(release.tag_name);
  const digests = new Map(release.assets.map((asset) => [asset.name, asset.digest]));

  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key) => {
    if (key === "version") return version;
    if (key === "pkgver") return version.replaceAll("-", "");
    const [kind, asset] = key.split(".");
    if (kind === "url") return assetUrl(asset, version);
    if (kind === "sha256") {
      const name = assetName(asset, version);
      if (!digests.has(name)) throw new Error(`${release.tag_name} has no ${name}.`);
      const digest = digests.get(name);
      if (!digest?.startsWith("sha256:")) throw new Error(`${name} has no SHA-256 digest.`);
      return digest.slice("sha256:".length);
    }
    throw new Error(`Unknown placeholder {{${key}}}.`);
  });
}
