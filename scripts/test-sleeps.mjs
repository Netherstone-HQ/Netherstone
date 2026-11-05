#!/usr/bin/env node
// Fails when test code waits on the clock. Tests wait on explicit signals
// (channels, events, promises, frames), and timeouts run on a paused or fake
// clock, so a slow machine can't make them fail.
//
//   node scripts/test-sleeps.mjs rust
//   node scripts/test-sleeps.mjs web

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const CHECKS = {
  rust: {
    folders: ["src-tauri/src", "src-tauri/tests"],
    isTest: (path) => path.endsWith(".rs"),
    // A test module's own file, a tests/ folder, or a #[cfg(test)] module,
    // which comes last in its file.
    testCode: (path, text) => {
      if (/(^|\/)tests(\.rs|\/)/.test(path)) return text;
      const start = text.search(/#\[cfg\(test\)\]\s*(pub(\([^)]*\))?\s+)?mod /);
      return start < 0 ? "" : text.slice(start);
    },
    waits: /\bsleep(_until)?\s*\(/,
  },
  web: {
    folders: ["src", "scripts", "e2e"],
    isTest: (path) =>
      /\.(test|spec)\.(ts|tsx|js|jsx|mjs)$/.test(path) || path.startsWith("e2e/"),
    testCode: (_, text) => text,
    // Typing with a delay between keys paces the test by the clock too.
    waits: /\b(setTimeout|setInterval|waitForTimeout|sleep)\s*\(|\bdelay\s*:/,
  },
};

const check = CHECKS[process.argv[2]];
if (!check) {
  console.error("Usage: node scripts/test-sleeps.mjs rust|web");
  process.exit(2);
}

const found = [];
for (const folder of check.folders) {
  let entries;
  try {
    entries = readdirSync(folder, { recursive: true, withFileTypes: true });
  } catch {
    continue;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath ?? entry.path, entry.name).replaceAll("\\", "/");
    if (!check.isTest(path)) continue;
    const text = readFileSync(path, "utf8");
    const code = check.testCode(path, text);
    const offset = text.length - code.length;
    code.split("\n").forEach((line, i) => {
      if (check.waits.test(line)) {
        const number = text.slice(0, offset).split("\n").length + i;
        found.push(`${path}:${number}: ${line.trim()}`);
      }
    });
  }
}

if (found.length > 0) {
  console.error("Tests wait on a signal, never on the clock:");
  for (const line of found) console.error(`  ${line}`);
  process.exit(1);
}
