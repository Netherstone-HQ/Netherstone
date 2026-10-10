#!/usr/bin/env node
// Releases Netherstone in one step: bumps the version everywhere the release
// workflow checks it, commits, tags and pushes. Dev-only; nothing here ships.
//
//   pnpm release beta            0.2.0-beta.1 -> 0.2.0-beta.2
//   pnpm release stable          0.2.0-beta.2 -> 0.2.0
//   pnpm release patch|minor|major
//   pnpm release 0.3.0-beta.1    an exact version
//
//   --dry-run   run every check and show the plan, change nothing
//   --skip-ci   release without checking CI on main (not recommended)
//
// It stops before changing anything unless every check passes, asks you to
// type the new version, and pushes the commit and tag together, so a release
// commit never lands without its tag.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import {
  KEYWORDS,
  cargoVersion,
  jsonVersion,
  lockVersion,
  nextVersion,
  setCargoVersion,
  setJsonVersion,
} from "./release-version.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRANCH = "main";
const REMOTE = "origin";
const CARGO_PACKAGE = "Netherstone";
const FILES = {
  package: "package.json",
  tauri: "src-tauri/tauri.conf.json",
  cargo: "src-tauri/Cargo.toml",
  lock: "src-tauri/Cargo.lock",
};

// ── Output ──────────────────────────────────────────────────────────────────

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (color ? `\x1b[${code}m${text}\x1b[0m` : text);
const bold = paint(1);
const dim = paint(2);
const red = paint(31);
const green = paint(32);
const yellow = paint(33);

const ok = (text) => console.log(`${green("✓")} ${text}`);
const warn = (text) => console.log(`${yellow("!")} ${text}`);

class Stop extends Error {}
/** Ends the run with a message; nothing after this point happens. */
const stop = (message) => {
  throw new Stop(message);
};

// ── Commands ────────────────────────────────────────────────────────────────

function run(command, args, { allowFailure = false } = {}) {
  try {
    return execFileSync(command, args, {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (allowFailure) return null;
    const detail = String(error.stderr || error.message).trim();
    throw new Error(`${command} ${args.join(" ")} failed:\n${detail}`);
  }
}

const git = (...args) => run("git", args);
const has = (command) => run(command, ["--version"], { allowFailure: true }) !== null;

const read = (file) => readFileSync(join(ROOT, file), "utf8");
const write = (file, text) => writeFileSync(join(ROOT, file), text);

// ── Checks ──────────────────────────────────────────────────────────────────

function readVersions() {
  return {
    [FILES.package]: jsonVersion(read(FILES.package)),
    [FILES.tauri]: jsonVersion(read(FILES.tauri)),
    [FILES.cargo]: cargoVersion(read(FILES.cargo)),
    [FILES.lock]: lockVersion(read(FILES.lock), CARGO_PACKAGE),
  };
}

function checkRepository() {
  for (const tool of ["git", "cargo"]) {
    if (!has(tool)) stop(`${tool} isn't installed or isn't on your PATH.`);
  }

  const branch = git("branch", "--show-current");
  if (branch !== BRANCH) {
    stop(`You're on ${branch || "a detached HEAD"}. Switch to ${BRANCH} first.`);
  }
  ok(`On ${BRANCH}`);

  const changes = git("status", "--porcelain", "--untracked-files=no");
  if (changes) {
    stop(`You have uncommitted changes. Commit or stash them first:\n${changes}`);
  }
  ok("No uncommitted changes");

  git("fetch", "--quiet", REMOTE, BRANCH);
  const [ahead, behind] = git(
    "rev-list",
    "--left-right",
    "--count",
    `HEAD...${REMOTE}/${BRANCH}`,
  )
    .split(/\s+/)
    .map(Number);
  if (behind > 0) stop(`${BRANCH} is ${behind} commit(s) behind ${REMOTE}. Pull first.`);
  if (ahead > 0) {
    stop(`${BRANCH} has ${ahead} commit(s) that aren't on ${REMOTE}. Push or drop them first.`);
  }
  ok(`Up to date with ${REMOTE}/${BRANCH}`);

  const name = git("config", "user.name");
  const email = git("config", "user.email");
  if (!name || !email.endsWith("@users.noreply.github.com")) {
    stop(
      `Git would commit as "${name} <${email}>". Releases use your GitHub noreply address; set it with git config user.email.`,
    );
  }
  ok(`Committing as ${name} <${email}>`);

  return { name, email };
}

function checkVersions() {
  const versions = readVersions();
  const distinct = new Set(Object.values(versions));
  if (distinct.size !== 1 || distinct.has(undefined)) {
    const list = Object.entries(versions)
      .map(([file, version]) => `  ${file}: ${version ?? "not found"}`)
      .join("\n");
    stop(`The version files disagree, so it's unclear what to bump from:\n${list}`);
  }
  const [current] = distinct;
  ok(`Every version file says ${current}`);
  return current;
}

function checkTag(tag) {
  if (git("tag", "--list", tag)) stop(`The tag ${tag} already exists locally.`);
  if (run("git", ["ls-remote", "--tags", REMOTE, `refs/tags/${tag}`])) {
    stop(`The tag ${tag} already exists on ${REMOTE}.`);
  }
  ok(`${tag} isn't taken`);
}

function changesSinceLastRelease() {
  const last = run("git", ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*"], {
    allowFailure: true,
  });
  const range = last ? `${last}..HEAD` : "HEAD";
  const subjects = git("log", "--no-merges", "--format=%s", range)
    .split("\n")
    .filter(Boolean);
  if (subjects.length === 0) stop(`Nothing has changed since ${last}.`);
  return { last, subjects };
}

function checkCi(skip) {
  if (skip) {
    warn(yellow("Skipping the CI check (--skip-ci)"));
    return;
  }
  if (!has("gh")) {
    warn(yellow("The GitHub CLI (gh) isn't installed, so CI on main wasn't checked"));
    return;
  }
  if (run("gh", ["auth", "status"], { allowFailure: true }) === null) {
    warn(yellow("The GitHub CLI isn't signed in, so CI on main wasn't checked"));
    return;
  }

  const sha = git("rev-parse", "HEAD");
  const runs = JSON.parse(
    run("gh", [
      "run",
      "list",
      "--workflow",
      "ci.yml",
      "--commit",
      sha,
      "--limit",
      "1",
      "--json",
      "status,conclusion,url",
    ]),
  );
  const [latest] = runs;
  if (!latest) stop(`CI hasn't run on ${sha.slice(0, 7)} yet. Try again once it has.`);
  if (latest.status !== "completed") {
    stop(`CI is still running on ${BRANCH}. Try again when it finishes:\n${latest.url}`);
  }
  if (latest.conclusion !== "success") {
    stop(`CI on ${BRANCH} ended with "${latest.conclusion}":\n${latest.url}`);
  }
  ok(`CI passed on ${sha.slice(0, 7)}`);
}

// ── Changes ─────────────────────────────────────────────────────────────────

function restoreFiles() {
  run("git", ["checkout", "HEAD", "--", ...Object.values(FILES)], {
    allowFailure: true,
  });
}

function bumpFiles(from, to) {
  write(FILES.package, setJsonVersion(read(FILES.package), from, to));
  write(FILES.tauri, setJsonVersion(read(FILES.tauri), from, to));
  write(FILES.cargo, setCargoVersion(read(FILES.cargo), from, to));

  // Only the workspace's own entry changes; dependencies stay where they are.
  const manifest = ["--manifest-path", FILES.cargo];
  const offline = ["update", "--workspace", "--offline", ...manifest];
  if (run("cargo", offline, { allowFailure: true }) === null) {
    run("cargo", ["update", "--workspace", ...manifest]);
  }

  const versions = readVersions();
  const wrong = Object.entries(versions).filter(([, version]) => version !== to);
  if (wrong.length > 0) {
    throw new Error(
      `After the bump, these files don't say ${to}: ${wrong.map(([file]) => file).join(", ")}`,
    );
  }

  const changed = git("diff", "--name-only").split("\n").filter(Boolean).sort();
  const expected = Object.values(FILES).sort();
  if (changed.join("\n") !== expected.join("\n")) {
    throw new Error(
      `The bump changed different files than expected:\n${changed.join("\n") || "(none)"}`,
    );
  }
}

async function confirm(version) {
  if (!process.stdin.isTTY) {
    stop("This needs a terminal to confirm the release. Run it directly, not piped.");
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await prompt.question(`\nType ${bold(version)} to release it: `);
    return answer.trim() === version;
  } finally {
    prompt.close();
  }
}

function repositoryUrl() {
  const remote = git("remote", "get-url", REMOTE);
  const match = /github\.com[:/](.+?)(?:\.git)?$/.exec(remote);
  return match ? `https://github.com/${match[1]}` : null;
}

// ── Main ────────────────────────────────────────────────────────────────────

const HELP = `Usage: pnpm release <${KEYWORDS.join("|")}|version> [--dry-run] [--skip-ci]

  beta     the next beta:      0.2.0-beta.1 -> 0.2.0-beta.2
  stable   finish the beta:    0.2.0-beta.2 -> 0.2.0
  patch    0.2.0 -> 0.2.1      (stable versions only)
  minor    0.2.0 -> 0.3.0
  major    0.2.0 -> 1.0.0
  0.3.0-beta.1                 an exact version, like the first beta of a new line

  --dry-run   check everything and show the plan, change nothing
  --skip-ci   don't check CI on main first`;

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean" },
      "skip-ci": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(HELP);
    return;
  }
  if (positionals.length !== 1) stop(`Say which version to release.\n\n${HELP}`);

  const identity = checkRepository();
  const current = checkVersions();
  let next;
  try {
    next = nextVersion(current, positionals[0]);
  } catch (error) {
    stop(error.message);
  }
  const tag = `v${next}`;
  checkTag(tag);
  checkCi(values["skip-ci"]);
  const { last, subjects } = changesSinceLastRelease();

  const kind = next.includes("-") ? "pre-release" : "stable release";
  console.log(`
${bold(`${current} -> ${next}`)} ${dim(`(${kind}, tag ${tag})`)}

Updates ${Object.values(FILES).join(", ")},
commits "Release ${next}" as ${identity.name}, then pushes it with ${tag}.

${subjects.length} change(s) since ${last ?? "the first commit"}, which become the release notes:
${subjects.map((subject) => `  - ${subject}`).join("\n")}`);

  if (values["dry-run"]) {
    console.log(`\n${dim("Dry run: nothing was changed.")}`);
    return;
  }

  if (!(await confirm(next))) stop("That didn't match, so nothing was released.");

  // Nothing may have moved while the prompt was open.
  if (git("status", "--porcelain", "--untracked-files=no")) {
    stop("Files changed while you were confirming. Nothing was released.");
  }

  try {
    bumpFiles(current, next);
  } catch (error) {
    restoreFiles();
    throw new Error(`${error.message}\nThe version files were put back. Nothing was committed.`);
  }
  ok(`Bumped to ${next}`);

  try {
    git("commit", "--quiet", "-m", `Release ${next}`, "--", ...Object.values(FILES));
  } catch (error) {
    restoreFiles();
    throw new Error(`${error.message}\nThe version files were put back. Nothing was committed.`);
  }
  const author = git("log", "-1", "--format=%ae %ce");
  if (author !== `${identity.email} ${identity.email}`) {
    git("reset", "--quiet", "--keep", "HEAD~1");
    stop(`The commit came out as ${author}, so it was undone. Nothing was pushed.`);
  }
  git("tag", tag);
  ok(`Committed and tagged ${tag}`);

  // Atomic: the commit and the tag land together, or neither does.
  try {
    git("push", "--quiet", "--atomic", REMOTE, BRANCH, `refs/tags/${tag}`);
  } catch (error) {
    // A dropped connection can report failure after GitHub took the push.
    if (run("git", ["ls-remote", "--tags", REMOTE, `refs/tags/${tag}`], { allowFailure: true })) {
      throw new Error(
        `${error.message}\nGit reported an error, but ${tag} is on ${REMOTE}, so the release went out. Check the release workflow.`,
      );
    }
    git("tag", "-d", tag);
    git("reset", "--quiet", "--keep", "HEAD~1");
    throw new Error(
      `${error.message}\nThe push failed, so the local commit and tag were undone. Nothing reached ${REMOTE}.`,
    );
  }
  ok(`Pushed ${BRANCH} and ${tag}`);

  const url = repositoryUrl();
  console.log(
    `\n${green(bold(`Released ${next}.`))} The release workflow is building it now${url ? `:\n${url}/actions/workflows/release.yml` : "."}`,
  );
}

main().catch((error) => {
  console.error(`\n${red("✗")} ${error instanceof Stop ? error.message : error.message || error}`);
  process.exit(1);
});
