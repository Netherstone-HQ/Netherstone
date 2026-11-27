import { describe, expect, it } from "vitest";

import {
  androidVersionCode,
  cargoVersion,
  compareVersions,
  isVersionBump,
  lockVersion,
  nextVersion,
  parseVersion,
  releaseNoteSubjects,
  setCargoVersion,
  setJsonVersion,
  setLockVersion,
  setTauriVersion,
  tauriAndroidCode,
} from "./release-version.mjs";

describe("nextVersion", () => {
  it.each([
    ["0.2.0-beta.1", "beta", "0.2.0-beta.2"],
    ["0.2.0-beta.9", "beta", "0.2.0-beta.10"],
    ["0.2.0-beta.3", "stable", "0.2.0"],
    ["0.2.0", "patch", "0.2.1"],
    ["0.2.3", "minor", "0.3.0"],
    ["0.2.3", "major", "1.0.0"],
    ["0.2.0-beta.1", "0.2.0-beta.4", "0.2.0-beta.4"],
    ["0.2.0-beta.1", "v0.3.0-beta.1", "0.3.0-beta.1"],
    ["0.2.0", "0.3.0-beta.1", "0.3.0-beta.1"],
  ])("%s with %s gives %s", (current, input, expected) => {
    expect(nextVersion(current, input)).toBe(expected);
  });

  it("refuses keywords that don't fit the current version", () => {
    expect(() => nextVersion("0.2.0", "beta")).toThrow(/0\.3\.0-beta\.1/);
    expect(() => nextVersion("0.2.0", "stable")).toThrow(/already/);
    expect(() => nextVersion("0.2.0-beta.2", "patch")).toThrow(/"stable"/);
    expect(() => nextVersion("0.2.0-beta.2", "minor")).toThrow(/beta/);
  });

  it("refuses versions that aren't newer", () => {
    expect(() => nextVersion("0.2.0-beta.2", "0.2.0-beta.2")).toThrow(/newer/);
    expect(() => nextVersion("0.2.0-beta.2", "0.2.0-beta.1")).toThrow(/newer/);
    expect(() => nextVersion("0.2.0", "0.2.0-beta.5")).toThrow(/newer/);
  });

  it("refuses typos", () => {
    expect(() => nextVersion("0.2.0-beta.1", "bta")).toThrow(/keyword/);
    expect(() => nextVersion("0.2.0-beta.1", "0.2.0-bta.2")).toThrow(/keyword/);
    expect(() => nextVersion("0.2.0-beta.1", "0.2")).toThrow(/keyword/);
  });
});

describe("releaseNoteSubjects", () => {
  it("drops a reverted change along with its revert", () => {
    expect(
      releaseNoteSubjects([
        'Revert "Add the companion (#22)"',
        "Fix sync (#23)",
        "Add the companion (#22)",
      ]),
    ).toEqual(["Fix sync (#23)"]);
  });

  it("leaves out release commits and repeats", () => {
    expect(
      releaseNoteSubjects([
        "Fix sync",
        "Release 0.2.0-beta.2",
        "Netherstone 0.2.0",
        "Fix sync",
        "Add Outline",
      ]),
    ).toEqual(["Fix sync", "Add Outline"]);
  });

  it("keeps a change whose title starts with Release", () => {
    expect(
      releaseNoteSubjects([
        "Release 0.6.0-beta.2 (#202)",
        "Release vault folders (#201)",
      ]),
    ).toEqual(["Release vault folders (#201)"]);
  });

  it("keeps a change whose title only starts like a reverted one", () => {
    expect(
      releaseNoteSubjects(['Revert "Add X"', "Add X and Y", "Add X"]),
    ).toEqual(["Add X and Y"]);
  });
});

describe("compareVersions", () => {
  it("puts a beta before its stable release", () => {
    const order = ["0.2.0-beta.1", "0.2.0-beta.2", "0.2.0", "0.2.1-beta.1", "0.10.0"];
    const sorted = [...order]
      .reverse()
      .sort((a, b) => compareVersions(parseVersion(a), parseVersion(b)));
    expect(sorted).toEqual(order);
  });
});

describe("file edits", () => {
  it("changes only the top-level JSON version and keeps formatting", () => {
    const text = '{\n  "name": "x",\n  "version": "0.2.0-beta.1",\n  "deps": {}\n}\n';
    expect(setJsonVersion(text, "0.2.0-beta.1", "0.2.0-beta.2")).toBe(
      text.replace("0.2.0-beta.1", "0.2.0-beta.2"),
    );
  });

  it("refuses a JSON file whose version isn't the expected one", () => {
    const text = '{ "version": "0.1.0" }';
    expect(() => setJsonVersion(text, "0.2.0-beta.1", "0.2.0-beta.2")).toThrow();
  });

  it("refuses a nested version that comes first", () => {
    const text = '{ "app": { "version": "0.2.0-beta.1" }, "version": "9.9.9" }';
    expect(() => setJsonVersion(text, "0.2.0-beta.1", "0.2.0-beta.2")).toThrow();
  });

  it("changes the package version in Cargo.toml, not a dependency's", () => {
    const text =
      '[package]\nname = "Netherstone"\nversion = "0.2.0-beta.1"\n\n[dependencies]\nserde = { version = "1" }\n';
    const next = setCargoVersion(text, "0.2.0-beta.1", "0.2.0-beta.2");
    expect(cargoVersion(next)).toBe("0.2.0-beta.2");
    expect(next).toContain('serde = { version = "1" }');
  });

  it("reads the package's entry in Cargo.lock", () => {
    const lock =
      '[[package]]\nname = "Netherstone"\r\nversion = "0.2.0-beta.2"\n\n[[package]]\nname = "serde"\nversion = "1.0.0"\n';
    expect(lockVersion(lock, "Netherstone")).toBe("0.2.0-beta.2");
    expect(lockVersion(lock, "serde")).toBe("1.0.0");
  });
});

describe("isVersionBump", () => {
  const json = (version) => `{\n  "name": "x",\n  "version": "${version}"\n}\n`;
  const conf = (version, code = androidVersionCode(version)) =>
    `{\n  "version": "${version}",\n  "bundle": { "android": { "versionCode": ${code} } }\n}\n`;
  const toml = (version, serde = "1") =>
    `[package]\nname = "Netherstone"\nversion = "${version}"\n\n[dependencies.serde]\nversion = "${serde}"\n`;
  const lock = (version, serde = "1.0.0") =>
    `version = 4\n\n[[package]]\nname = "Netherstone"\nversion = "${version}"\n\n[[package]]\nname = "serde"\nversion = "${serde}"\n`;
  const bump = (make, ...rest) => ({ before: make("0.5.0", ...rest), after: make("0.6.0-beta.1", ...rest) });
  const release = {
    "package.json": bump(json),
    "src-tauri/tauri.conf.json": bump(conf),
    "src-tauri/Cargo.toml": bump(toml),
    "src-tauri/Cargo.lock": bump(lock),
  };

  it("accepts a release bump", () => {
    expect(isVersionBump(release)).toBe(true);
  });

  it("refuses a dependency version change, alone or with a bump", () => {
    const dep = { before: toml("0.5.0", "1"), after: toml("0.5.0", "2") };
    expect(isVersionBump({ "src-tauri/Cargo.toml": dep })).toBe(false);
    const both = { before: toml("0.5.0", "1"), after: toml("0.6.0-beta.1", "2") };
    expect(isVersionBump({ ...release, "src-tauri/Cargo.toml": both })).toBe(false);
    const locked = { before: lock("0.5.0", "1.0.0"), after: lock("0.6.0-beta.1", "1.0.1") };
    expect(isVersionBump({ ...release, "src-tauri/Cargo.lock": locked })).toBe(false);
  });

  it("refuses an Android version code that doesn't follow the version", () => {
    const wrong = { before: conf("0.5.0"), after: conf("0.6.0-beta.1", 1) };
    expect(isVersionBump({ ...release, "src-tauri/tauri.conf.json": wrong })).toBe(false);
  });

  it("refuses files set to different versions", () => {
    const other = { before: json("0.5.0"), after: json("0.6.0") };
    expect(isVersionBump({ ...release, "package.json": other })).toBe(false);
  });

  it("refuses other files, new files and no changes", () => {
    expect(isVersionBump({ ...release, "src/main.tsx": { before: "a", after: "b" } })).toBe(false);
    expect(isVersionBump({ "package.json": { before: null, after: json("0.6.0") } })).toBe(false);
    expect(isVersionBump({})).toBe(false);
  });

  it("sets the package's version in Cargo.lock only", () => {
    expect(setLockVersion(lock("0.5.0"), "Netherstone", "0.5.0", "0.6.0")).toBe(lock("0.6.0"));
    expect(() => setLockVersion(lock("0.5.0"), "Netherstone", "0.4.0", "0.6.0")).toThrow();
  });
});

describe("androidVersionCode", () => {
  it.each([
    ["0.8.0-beta.1", 800010],
    ["0.8.0-beta.12", 800120],
    ["0.8.0", 800990],
    ["1.2.3", 10203990],
  ])("gives %s the code %i", (version, code) => {
    expect(androidVersionCode(version)).toBe(code);
  });

  it("orders betas below their stable release and the next version", () => {
    const codes = ["0.8.0-beta.1", "0.8.0-beta.2", "0.8.0", "0.8.1-beta.1"].map(androidVersionCode);
    expect([...codes].sort((a, b) => a - b)).toEqual(codes);
  });

  it("refuses beta 99 and versions it can't read", () => {
    expect(() => androidVersionCode("0.8.0-beta.99")).toThrow();
    expect(() => androidVersionCode("0.8")).toThrow();
  });

  it("is set with tauri.conf.json's version", () => {
    const text = '{\n  "version": "0.8.0-beta.1",\n  "bundle": {\n    "android": { "versionCode": 800010 }\n  }\n}\n';
    const next = setTauriVersion(text, "0.8.0-beta.1", "0.8.0-beta.2");
    expect(tauriAndroidCode(next)).toBe(800020);
    expect(next).toBe(text.replace("0.8.0-beta.1", "0.8.0-beta.2").replace("800010", "800020"));
    expect(() => setTauriVersion('{ "version": "0.8.0-beta.1" }', "0.8.0-beta.1", "0.8.0-beta.2")).toThrow();
  });
});
