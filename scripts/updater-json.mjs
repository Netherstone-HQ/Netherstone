// latest.json, the file installed apps update from, built from a release's
// assets. Kept free of the network and the filesystem so it can be tested on
// its own.
//
// The release builds upload each updater bundle with its signature (the same
// name plus .sig). The publish job writes latest.json once from all of them,
// so builds that finish at the same moment don't race to upload it.

import { tagVersion } from "./channel-files.mjs";

const REPOSITORY = "Netherstone-HQ/Netherstone";

/**
 * Each updater bundle, by version, and the platform keys it serves. The
 * updater tries `{os}-{arch}-{installer}` first, then `{os}-{arch}`.
 */
export const UPDATER_BUNDLES = [
  { name: () => "Netherstone_aarch64.app.tar.gz", keys: ["darwin-aarch64", "darwin-aarch64-app"] },
  { name: () => "Netherstone_x64.app.tar.gz", keys: ["darwin-x86_64", "darwin-x86_64-app"] },
  {
    name: (version) => `Netherstone_${version}_amd64.AppImage`,
    keys: ["linux-x86_64", "linux-x86_64-appimage"],
  },
  { name: (version) => `Netherstone_${version}_amd64.deb`, keys: ["linux-x86_64-deb"] },
  { name: (version) => `Netherstone-${version}-1.x86_64.rpm`, keys: ["linux-x86_64-rpm"] },
  {
    name: (version) => `Netherstone_${version}_x64-setup.exe`,
    keys: ["windows-x86_64", "windows-x86_64-nsis"],
  },
];

/**
 * latest.json for the release, as GitHub's API returns it. `signatures` maps
 * each .sig asset's name to its text. Fails when a bundle or its signature is
 * missing, so the release stays a draft.
 */
export function updaterJson(release, signatures, pubDate) {
  const tag = release.tag_name;
  const version = tagVersion(tag);
  const assets = new Set(release.assets.map((asset) => asset.name));
  const platforms = {};

  for (const bundle of UPDATER_BUNDLES) {
    const name = bundle.name(version);
    if (!assets.has(name)) throw new Error(`${tag} has no ${name}.`);
    const signature = signatures[`${name}.sig`];
    if (!signature) throw new Error(`${tag} has no signature for ${name}.`);
    const url = `https://github.com/${REPOSITORY}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
    for (const key of bundle.keys) platforms[key] = { signature, url };
  }

  return { version, notes: "", pub_date: pubDate, platforms };
}
