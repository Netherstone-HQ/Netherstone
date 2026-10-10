// Version rules and file edits for scripts/release.mjs, kept free of git and
// the filesystem so they can be tested on their own.

const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/;

export const KEYWORDS = ["beta", "stable", "patch", "minor", "major"];

/** Parses "0.2.0" or "0.2.0-beta.1". Anything else is refused. */
export function parseVersion(text) {
  const match = VERSION.exec(text);
  if (!match) return null;
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  const beta = match[4] === undefined ? null : Number(match[4]);
  return { major, minor, patch, beta };
}

export function formatVersion({ major, minor, patch, beta }) {
  const base = `${major}.${minor}.${patch}`;
  return beta === null ? base : `${base}-beta.${beta}`;
}

/** Negative when a comes first. A beta comes before its stable release. */
export function compareVersions(a, b) {
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (a.beta === b.beta) return 0;
  if (a.beta === null) return 1;
  if (b.beta === null) return -1;
  return a.beta - b.beta;
}

/**
 * The version to release after `currentText`, from a keyword or an exact
 * version. Throws with a message meant for the person running the release.
 */
export function nextVersion(currentText, input) {
  const current = parseVersion(currentText);
  if (!current) {
    throw new Error(
      `The app's version, ${currentText}, isn't one this script understands (like 0.2.0 or 0.2.0-beta.1).`,
    );
  }
  const inBeta = current.beta !== null;
  const stableOf = { ...current, beta: null };

  switch (input) {
    case "beta":
      if (!inBeta) {
        throw new Error(
          `${currentText} is a stable release, so there's no beta to continue. Start the next one with an exact version, like ${formatVersion({ ...current, minor: current.minor + 1, patch: 0, beta: 1 })}.`,
        );
      }
      return formatVersion({ ...current, beta: current.beta + 1 });

    case "stable":
      if (!inBeta) {
        throw new Error(`${currentText} is already a stable release.`);
      }
      return formatVersion(stableOf);

    case "patch":
    case "minor":
    case "major": {
      if (inBeta) {
        throw new Error(
          `You're in the ${formatVersion(stableOf)} beta. Use "stable" to release ${formatVersion(stableOf)}, or "beta" for the next beta.`,
        );
      }
      const bumped =
        input === "patch"
          ? { ...current, patch: current.patch + 1 }
          : input === "minor"
            ? { ...current, minor: current.minor + 1, patch: 0 }
            : { major: current.major + 1, minor: 0, patch: 0 };
      return formatVersion({ ...bumped, beta: null });
    }
  }

  const exact = parseVersion(input.replace(/^v/, ""));
  if (!exact) {
    throw new Error(
      `"${input}" isn't a version or a keyword. Use one of ${KEYWORDS.join(", ")}, or a version like 0.2.0 or 0.2.0-beta.2.`,
    );
  }
  if (compareVersions(exact, current) <= 0) {
    throw new Error(
      `${formatVersion(exact)} isn't newer than the current version, ${currentText}.`,
    );
  }
  return formatVersion(exact);
}

/** The top-level "version" of a JSON file, read the way the release workflow does. */
export function jsonVersion(text) {
  return JSON.parse(text).version;
}

/** The first `version = "…"` line of Cargo.toml, as the release workflow reads it. */
export function cargoVersion(text) {
  return /^version = "(.*)"/m.exec(text)?.[1];
}

/** The version Cargo.lock records for the `name` package. */
export function lockVersion(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^name = "${escaped}"\\r?\\nversion = "(.*)"`, "m").exec(
    text,
  )?.[1];
}

/**
 * Replaces the version in a JSON file's text, leaving its formatting alone.
 * Throws unless exactly the top-level version changed from `from` to `to`.
 */
export function setJsonVersion(text, from, to) {
  const next = text.replace(
    /("version"\s*:\s*")([^"]*)(")/,
    (whole, open, found, close) => (found === from ? `${open}${to}${close}` : whole),
  );
  if (jsonVersion(next) !== to) {
    throw new Error(`Couldn't find "version": "${from}" at the top level.`);
  }
  return next;
}

/** Replaces the first `version = "…"` line of Cargo.toml, the package's own. */
export function setCargoVersion(text, from, to) {
  const next = text.replace(/^version = "(.*)"/m, (whole, found) =>
    found === from ? `version = "${to}"` : whole,
  );
  if (cargoVersion(next) !== to) {
    throw new Error(`Couldn't find version = "${from}" in [package].`);
  }
  return next;
}
