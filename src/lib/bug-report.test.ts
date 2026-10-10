import { describe, expect, it } from "vitest";

import { bugReportUrl, osName, versionDetails } from "./bug-report";

const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";
const LINUX =
  "Mozilla/5.0 (X11; Ubuntu; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)";

describe("osName", () => {
  it.each([
    [WINDOWS, "Windows"],
    [MAC, "macOS"],
    [LINUX, "Linux"],
    ["SomethingElse/1.0", "Unknown"],
  ])("reads %s", (userAgent, expected) => {
    expect(osName(userAgent)).toBe(expected);
  });
});

describe("versionDetails", () => {
  it("names the app, version and OS", () => {
    expect(versionDetails("0.2.0-beta.1", WINDOWS)).toBe(
      "Netherstone 0.2.0-beta.1 · Windows",
    );
  });
});

describe("bugReportUrl", () => {
  it("fills the issue body with the version and OS", () => {
    const url = new URL(
      bugReportUrl("https://github.com/o/r", "0.2.0-beta.1", MAC),
    );
    expect(url.pathname).toBe("/o/r/issues/new");
    const body = url.searchParams.get("body") ?? "";
    expect(body).toContain("**Version:** 0.2.0-beta.1");
    expect(body).toContain("**OS:** macOS");
    expect(body).toContain("**What happened?**");
  });
});
