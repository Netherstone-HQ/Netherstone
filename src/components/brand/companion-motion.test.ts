// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CompanionRig, hopFlight, STAGE, type Spot } from "./companion-motion";

const PARTS = [
  "hit", "root", "front", "back", "frontBody", "backBody", "frontLegL",
  "frontLegR", "frontArmL", "frontArmR", "backArmL", "backArmR", "backLegL",
  "backLegR", "face", "eyeL", "eyeR", "shine", "happy", "mouth", "shadow",
  "gem", "handL", "handR",
];

const HOME = { x: 1300, y: 890 };
const PERCH = { x: 1376, y: 760 };

function makeHost() {
  const host = document.createElement("div");
  for (const name of PARTS) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "g");
    el.setAttribute("data-part", name);
    host.appendChild(el);
  }
  document.body.appendChild(host);
  return host;
}

/** Where his feet are, from the host's transform. */
function feet(host: HTMLElement): Spot {
  const [x, y] = host.style.transform.match(/-?[\d.]+/g)!.map(Number);
  return { x: x + STAGE.restX * STAGE.scale, y: y + STAGE.ground * STAGE.scale };
}

const menu = { isOpen: () => false, open: () => {}, close: () => {} };

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame", "performance"],
  });
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("CompanionRig", () => {
  it("waits for the panel, then hops onto it in the time the design sets", async () => {
    const host = makeHost();
    const rig = new CompanionRig(host, { reducedMotion: false, home: () => HOME });
    rig.setAssistant(true, menu);
    await vi.advanceTimersByTimeAsync(10_000); // walked in and sat down
    expect(feet(host)).toEqual(HOME);

    rig.setSpot(() => PERCH);
    await vi.advanceTimersByTimeAsync(219);
    expect(feet(host)).toEqual(HOME);

    // Look (220 ms) and crouch (200 ms), then he's off the ground.
    await vi.advanceTimersByTimeAsync(1 + 220 + 200 + 50);
    const midway = feet(host);
    expect(midway).not.toEqual(HOME);
    expect(midway.y).toBeLessThan(HOME.y);

    await vi.advanceTimersByTimeAsync(hopFlight(HOME, PERCH) + 1000);
    expect(feet(host)).toEqual(PERCH);
    rig.stop();
  });

  it("picks his shard up before hopping, so it never floats along", async () => {
    const host = makeHost();
    const rig = new CompanionRig(host, { reducedMotion: false, home: () => HOME });
    rig.setAssistant(true, menu);
    await vi.advanceTimersByTimeAsync(10_000);
    rig.setWork("shrug"); // sets the shard down beside him
    const gem = host.querySelector('[data-part="gem"]')!;
    // Until it's on the ground beside him.
    const onGround = `translate(${STAGE.restX - 60} ${STAGE.ground - 12})`;
    while (!gem.getAttribute("transform")?.startsWith(onGround)) {
      await vi.advanceTimersByTimeAsync(16);
    }

    rig.setSpot(() => PERCH);
    const start = feet(host);
    let checked = 0;
    for (let t = 0; t < 4000; t += 16) {
      await vi.advanceTimersByTimeAsync(16);
      const at = feet(host);
      const flying = at.x !== start.x || at.y !== start.y;
      if (flying && (at.x !== PERCH.x || at.y !== PERCH.y)) {
        expect(gem.getAttribute("transform")).not.toMatch(onGround);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
    rig.stop();
  });

  it("with reduced motion, goes straight to the panel and back", async () => {
    const host = makeHost();
    const rig = new CompanionRig(host, { reducedMotion: true, home: () => HOME });
    rig.setAssistant(true, menu);
    rig.setSpot(() => PERCH);
    await vi.advanceTimersByTimeAsync(0);
    expect(feet(host)).toEqual(PERCH);

    // Turned off, he's home again.
    rig.setAssistant(false, null);
    await vi.advanceTimersByTimeAsync(0);
    expect(feet(host)).toEqual(HOME);
    rig.stop();
  });

  it("opens the menu on a click only as the assistant", async () => {
    const host = makeHost();
    const open = vi.fn();
    const rig = new CompanionRig(host, { reducedMotion: true, home: () => HOME });
    const hit = host.querySelector('[data-part="hit"]')!;

    hit.dispatchEvent(new MouseEvent("click", { detail: 1 }));
    await vi.advanceTimersByTimeAsync(500);
    expect(open).not.toHaveBeenCalled();

    rig.setAssistant(true, { isOpen: () => false, open, close: () => {} });
    hit.dispatchEvent(new MouseEvent("click", { detail: 1 }));
    await vi.advanceTimersByTimeAsync(500);
    expect(open).toHaveBeenCalledOnce();
    rig.stop();
  });
});
