#!/usr/bin/env node
// Prints "true" when the changes from <base> to <head> only bump the app's
// version (see isVersionBump), otherwise "false". CI and the Release cache
// workflow use it to skip work a version bump doesn't need.
//
//   node scripts/version-bump.mjs <base> <head>

import { execFileSync } from "node:child_process";

import { isVersionBump } from "./release-version.mjs";

const [base, head] = process.argv.slice(2);
if (!base || !head) {
  console.error("Usage: node scripts/version-bump.mjs <base> <head>");
  process.exit(2);
}

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", maxBuffer: Infinity });

/** A file's text at `ref`, or null when it doesn't exist there. */
function show(ref, path) {
  try {
    return git("cat-file", "blob", `${ref}:${path}`);
  } catch {
    return null;
  }
}

const paths = git("diff", "--name-only", "--no-renames", base, head)
  .split("\n")
  .filter(Boolean);
const changes = Object.fromEntries(
  paths.map((path) => [path, { before: show(base, path), after: show(head, path) }]),
);
console.log(String(isVersionBump(changes)));
