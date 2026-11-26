import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  IS_ANDROID: true,
}));

import { androidBridge } from "./android-bridge";

/** Stands in for the object MainActivity.kt puts on the page. */
function fakePort() {
  let hear: (event: { data: string }) => void = () => {};
  const sent: { method: string; args: unknown[]; id?: number }[] = [];
  const port = {
    postMessage: (message: string) => sent.push(JSON.parse(message)),
    addEventListener: (_type: string, listener: typeof hear) => {
      hear = listener;
    },
  };
  const answer = (id: number, result: unknown) =>
    hear({ data: JSON.stringify({ id, result }) });
  return { port, sent, answer };
}

describe("androidBridge", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is missing when Android didn't put its object on the page", () => {
    vi.stubGlobal("window", {});
    expect(androidBridge()).toBeUndefined();
  });

  it("sends calls without waiting for an answer", () => {
    const { port, sent } = fakePort();
    vi.stubGlobal("window", { NetherstoneAndroid: port });
    androidBridge()?.shareFile("/cache/shared/Plan.md", "text/markdown");
    expect(sent).toEqual([
      { method: "shareFile", args: ["/cache/shared/Plan.md", "text/markdown"] },
    ]);
  });

  it("gives each question the answer that has its id", async () => {
    const { port, sent, answer } = fakePort();
    vi.stubGlobal("window", { NetherstoneAndroid: port });
    const bridge = androidBridge();
    const access = bridge?.hasAllFilesAccess();
    const installed = bridge?.installUpdate();
    const [accessId, installId] = sent.map((call) => call.id ?? 0);
    expect(accessId).not.toBe(installId);
    answer(installId, "not-this-app");
    answer(accessId, true);
    await expect(access).resolves.toBe(true);
    await expect(installed).resolves.toBe("not-this-app");
  });
});
