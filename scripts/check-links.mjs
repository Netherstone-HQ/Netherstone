#!/usr/bin/env node
// Fails when app code has a web address of its own. Every address the app
// uses lives in src/data/links.json, so it can be changed in one place.
// Tests, comments, this computer's addresses and XML namespaces are left
// alone.
//
//   node scripts/check-links.mjs

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const FOLDERS = ["src", "src-tauri/src"];
const LINKS = "src/data/links.json";

// Names, not addresses: XML and SVG namespaces in documents the app writes
// and reads.
const NAMESPACE_FILES = [
  "src/lib/import/formats/docx/xml.ts",
  "src/lib/import/formats/docx/xml-tree.ts",
  "src/lib/export/docx.ts",
];

const ADDRESS = /\bhttps?:\/\/[A-Za-z0-9[][^\s"'`)>\]]*/g;
const ALLOWED = [
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])([:/]|$)/,
  /^https?:\/\/[a-z0-9-]+\.localhost([:/]|$)/,
  /^https?:\/\/www\.w3\.org\//,
  // Domains kept for examples, as in a placeholder.
  /^https?:\/\/([a-z0-9-]+\.)*example\.(com|org|net)([:/]|$)/,
];

// Examples in text the app gives, which nothing opens.
const EXAMPLES = {
  "src-tauri/src/tools/guide.rs": ["https://www.youtube.com/watch?v=abc"],
};

const isTestPath = (path) =>
  /\.(test|spec)\.(ts|tsx)$/.test(path) ||
  /(^|\/)(tests?|__fixtures__|fixtures)(\/|\.rs$)/.test(path);

/** The code of a file that isn't tests, without comments. */
function code(path, text) {
  if (path.endsWith(".rs")) {
    const start = text.search(/#\[cfg\(test\)\]\s*(pub(\([^)]*\))?\s+)?mod /);
    if (start >= 0) text = text.slice(0, start);
  }
  return text
    .split("\n")
    .map((line) => (/^\s*(\/\/|\/?\*)/.test(line) ? "" : line));
}

function* files(folder) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (/\.(ts|tsx|rs)$/.test(entry.name)) yield path;
  }
}

const found = [];
for (const folder of FOLDERS) {
  for (const path of files(folder)) {
    if (path === LINKS || NAMESPACE_FILES.includes(path) || isTestPath(path)) continue;
    code(path, readFileSync(path, "utf8")).forEach((line, i) => {
      for (const [address] of line.matchAll(ADDRESS)) {
        const example = EXAMPLES[path]?.includes(address);
        if (!example && !ALLOWED.some((allowed) => allowed.test(address))) {
          found.push(`${path}:${i + 1}: ${address}`);
        }
      }
    });
  }
}

if (found.length) {
  console.error(`Web addresses belong in ${LINKS}:\n${found.join("\n")}`);
  process.exit(1);
}
