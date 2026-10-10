import { describe, expect, it } from "vitest";

import {
  cargoVersion,
  compareVersions,
  lockVersion,
  nextVersion,
  parseVersion,
  releaseNoteSubjects,
  setCargoVersion,
  setJsonVersion,
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
        'Revert "Add Kevin (#22)"',
        "Fix sync (#23)",
        "Add Kevin (#22)",
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
