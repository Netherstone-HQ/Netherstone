#!/usr/bin/env node
// Writes a release's files for a package manager or its latest.json, names a
// release asset or its link, or gives a tag's version.
// The Release and Channels workflows use it to publish each release.
//
//   node scripts/channels.mjs render <channel> <release.json> <out-dir>
//   node scripts/channels.mjs updater <release.json> <signatures-dir>
//   node scripts/channels.mjs asset <asset> <version>
//   node scripts/channels.mjs url <asset> <version>
//   node scripts/channels.mjs version <tag>
//
// release.json is the release as `gh api repos/{owner}/{repo}/releases/tags/<tag>`
// prints it. Every file in packaging/<channel>/ is written to <out-dir>.
// `updater` prints latest.json, reading each .sig asset from <signatures-dir>.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assetName, assetUrl, renderTemplate, tagVersion } from "./channel-files.mjs";
import { updaterJson } from "./updater-json.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const [command, ...args] = process.argv.slice(2);

if (command === "render" && args.length === 3) {
  const [channel, releaseFile, outDir] = args;
  const release = JSON.parse(readFileSync(releaseFile, "utf8"));
  const dir = path.join(root, "packaging", channel);
  mkdirSync(outDir, { recursive: true });
  for (const file of readdirSync(dir)) {
    const text = renderTemplate(readFileSync(path.join(dir, file), "utf8"), release);
    writeFileSync(path.join(outDir, file), text);
    console.log(`Wrote ${path.join(outDir, file)}`);
  }
} else if (command === "updater" && args.length === 2) {
  const [releaseFile, signaturesDir] = args;
  const release = JSON.parse(readFileSync(releaseFile, "utf8"));
  const signatures = Object.fromEntries(
    readdirSync(signaturesDir).map((file) => [
      file,
      readFileSync(path.join(signaturesDir, file), "utf8"),
    ]),
  );
  const json = updaterJson(release, signatures, new Date().toISOString());
  console.log(JSON.stringify(json, null, 2));
} else if (command === "asset" && args.length === 2) {
  console.log(assetName(args[0], args[1]));
} else if (command === "url" && args.length === 2) {
  console.log(assetUrl(args[0], args[1]));
} else if (command === "version" && args.length === 1) {
  console.log(tagVersion(args[0]));
} else {
  console.error(
    "Usage: node scripts/channels.mjs render <channel> <release.json> <out-dir>\n" +
      "       node scripts/channels.mjs updater <release.json> <signatures-dir>\n" +
      "       node scripts/channels.mjs asset <asset> <version>\n" +
      "       node scripts/channels.mjs url <asset> <version>\n" +
      "       node scripts/channels.mjs version <tag>",
  );
  process.exit(2);
}
