import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { PREVIEW_SCRIPT } from "@/lib/export/html-scripts";

const config = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, "../../src-tauri/tauri.conf.json"), "utf8"),
);
const security = config.app.security;
const csp: Record<string, string> = security.csp;

describe("content security policy", () => {
  it("lets the export preview run its script", () => {
    // The preview is a blob: page, so it takes the app's policy, and its
    // inline script runs only if the policy carries the script's hash.
    const hash = createHash("sha256").update(PREVIEW_SCRIPT).digest("base64");
    expect(csp["script-src"].split(" ")).toContain(`'sha256-${hash}'`);
  });

  it("lets the backend answer and shard files load", () => {
    expect(csp["connect-src"]).toContain("ipc: http://ipc.localhost");
    for (const directive of ["img-src", "media-src"]) {
      expect(csp[directive]).toContain("asset: http://asset.localhost");
    }
  });

  it("leaves inline styles alone", () => {
    // Tauri would otherwise add a nonce to style-src, which turns off
    // 'unsafe-inline' and drops the styles the editor and drawings set.
    expect(security.dangerousDisableAssetCspModification).toEqual(["style-src"]);
    expect(csp["style-src"]).toContain("'unsafe-inline'");
  });

  it("serves only folders the app opens itself", () => {
    expect(security.assetProtocol.scope).toEqual([]);
  });
});
