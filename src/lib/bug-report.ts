// Version details for bug reports. The OS comes from the webview's user
// agent, which is enough to tell platforms apart without the OS plugin.
// Windows 11 still reports itself as Windows NT 10.0, so no version number.

export function osName(userAgent: string): string {
  if (/Windows/i.test(userAgent)) return "Windows";
  if (/Macintosh|Mac OS X/i.test(userAgent)) return "macOS";
  if (/Linux/i.test(userAgent)) return "Linux";
  return "Unknown";
}

/** One line to paste into a bug report, like "Netherstone 0.2.0 · Windows". */
export function versionDetails(version: string, userAgent: string): string {
  return `Netherstone ${version} · ${osName(userAgent)}`;
}

export function bugReportBody(version: string, userAgent: string): string {
  return [
    `**Version:** ${version}`,
    `**OS:** ${osName(userAgent)}`,
    "",
    "**What happened?**",
    "",
    "",
    "**What did you expect?**",
    "",
  ].join("\n");
}

/** A new-issue link with the version and OS already filled in. */
export function bugReportUrl(
  repositoryUrl: string,
  version: string,
  userAgent: string,
): string {
  const body = encodeURIComponent(bugReportBody(version, userAgent));
  return `${repositoryUrl}/issues/new?body=${body}`;
}
