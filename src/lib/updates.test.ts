import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  IS_ANDROID: true,
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  invoke: vi.fn(async () => undefined),
}));
const backInFront = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/back-in-front", () => ({ backInFront }));

import type { UpdateInstall } from "./android-bridge";
import { installUpdate } from "./updates";

/** Android's answers to each "installUpdate" call, in order. */
function answering(...outcomes: UpdateInstall[]) {
  let hear: (event: { data: string }) => void = () => {};
  vi.stubGlobal("window", {
    NetherstoneAndroid: {
      postMessage: (message: string) => {
        const { id } = JSON.parse(message) as { id: number };
        queueMicrotask(() =>
          hear({ data: JSON.stringify({ id, result: outcomes.shift() }) }),
        );
      },
      addEventListener: (_type: string, listener: typeof hear) => {
        hear = listener;
      },
    },
  });
}

describe("installUpdate on Android", () => {
  beforeEach(() => {
    backInFront.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks again once the app is back from the install apps setting", async () => {
    answering("not-allowed", "started");
    await installUpdate();
    expect(backInFront).toHaveBeenCalledTimes(1);
  });

  it("says why when the update can't be installed", async () => {
    answering("not-this-app");
    await expect(installUpdate()).rejects.toThrow(
      "This update doesn't match the installed app, so it was deleted.",
    );
    expect(backInFront).not.toHaveBeenCalled();
  });
});
