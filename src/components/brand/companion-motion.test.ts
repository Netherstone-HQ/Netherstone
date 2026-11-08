// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
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

const SVG = "http://www.w3.org/2000/svg";

function makeHost() {
  const host = document.createElement("div");
  for (const name of PARTS) {
    const el = document.createElementNS(SVG, "g");
    el.setAttribute("data-part", name);
    // Limbs have a plain shape and a muscled one.
    if (/Arm|Leg/.test(name)) {
      for (const shape of ["data-plain", "data-muscle"]) {
        const child = document.createElementNS(SVG, "g");
        child.setAttribute(shape, "");
        if (shape === "data-muscle") child.setAttribute("visibility", "hidden");
        el.appendChild(child);
      }
    }
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

  it("breathes a while once asleep, then lies still with his z's showing", async () => {
    const host = makeHost();
    const rig = new CompanionRig(host, { reducedMotion: false, home: () => HOME });
    rig.setAssistant(true, menu);
    await vi.advanceTimersByTimeAsync(10_000); // walked in and sat down
    rig.setWork("sleep");
    await vi.advanceTimersByTimeAsync(6000);
    expect(host.hasAttribute("data-breathing")).toBe(true);
    expect(host.hasAttribute("data-zz")).toBe(true);

    // The first of his z's runs out of floats (App.css).
    const ended = new Event("animationend", { bubbles: true });
    Object.defineProperty(ended, "animationName", { value: "companion-z" });
    host.querySelector('[data-part="root"]')!.dispatchEvent(ended);
    expect(host.hasAttribute("data-breathing")).toBe(false);
    expect(host.hasAttribute("data-resting")).toBe(true);
    expect(host.hasAttribute("data-zz")).toBe(true);

    // He still wakes from there.
    rig.wakeFromSleep();
    await vi.advanceTimersByTimeAsync(3000);
    expect(host.hasAttribute("data-resting")).toBe(false);
    expect(host.hasAttribute("data-zz")).toBe(false);
    rig.stop();
  });

  it("goes straight to each pose while the window is in the background", async () => {
    const host = makeHost();
    const rig = new CompanionRig(host, { reducedMotion: false, home: () => HOME });
    rig.setAssistant(true, menu);
    await vi.advanceTimersByTimeAsync(10_000);
    window.dispatchEvent(new Event("blur"));
    expect(host.hasAttribute("data-paused")).toBe(true);

    // Past the panel's slide-in, he's there: the hop takes no frames.
    rig.setSpot(() => PERCH);
    await vi.advanceTimersByTimeAsync(221);
    expect(feet(host)).toEqual(PERCH);

    window.dispatchEvent(new Event("focus"));
    expect(host.hasAttribute("data-paused")).toBe(false);
    rig.stop();
  });

  it("has no endless animation in his styles", () => {
    const css = readFileSync(path.resolve(__dirname, "../../App.css"), "utf8");
    const rules = css.match(/[^{}]*\.companion[^{}]*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) expect(rule).not.toMatch(/infinite/);
    expect(css).toMatch(/\.companion\[data-paused\][^{]*\{[^}]*animation-play-state: paused/);
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

  describe("on a change to several shards", () => {
    const part = (host: HTMLElement, name: string) =>
      host.querySelector(`[data-part="${name}"]`)!;
    const muscled = (host: HTMLElement) =>
      part(host, "frontArmR").querySelector("[data-muscle]")!.getAttribute("visibility") === "inherit";
    const plain = (host: HTMLElement) =>
      part(host, "frontArmR").querySelector("[data-plain]")!.getAttribute("visibility") === "inherit";
    const gemShown = (host: HTMLElement) => part(host, "gem").getAttribute("visibility") === "visible";

    /** On the panel, reading, as an answer starts. */
    async function reading(reducedMotion = false) {
      const host = makeHost();
      const rig = new CompanionRig(host, { reducedMotion, home: () => HOME });
      rig.setAssistant(true, menu);
      rig.setSpot(() => PERCH);
      await vi.advanceTimersByTimeAsync(12_000);
      rig.setWork("read");
      await vi.advanceTimersByTimeAsync(1000);
      return { host, rig };
    }

    /** The sideways leans seen over `ms`, from his body's tilt. */
    async function leans(host: HTMLElement, ms: number) {
      const seen = new Set<string>();
      for (let t = 0; t < ms; t += 16) {
        await vi.advanceTimersByTimeAsync(16);
        const tilt = part(host, "frontBody").getAttribute("transform")!.match(/rotate\((-?[\d.]+)/)![1];
        if (Math.abs(Number(tilt)) > 2.9) seen.add(Number(tilt) < 0 ? "left" : "right");
      }
      return seen;
    }

    it("stays as he is for one shard", async () => {
      const { host, rig } = await reading();
      rig.setChanged(1);
      await vi.advanceTimersByTimeAsync(5000);
      expect(muscled(host)).toBe(false);
      expect(gemShown(host)).toBe(true);
      rig.stop();
    });

    it("eats his shard, bulks up and flexes once for each shard, in turn", async () => {
      const { host, rig } = await reading();
      rig.setChanged(2);
      // Double biceps, then his left arm: never his right yet.
      expect([...(await leans(host, 6000))]).toEqual(["left"]);
      expect(muscled(host)).toBe(true);
      expect(gemShown(host)).toBe(false);

      rig.setChanged(3);
      expect([...(await leans(host, 3000))]).toEqual(["right"]);

      // The answer lands mid-flex: he finishes his flexes, then shrinks back
      // and spits his shard into his hands.
      rig.setChanged(4);
      await vi.advanceTimersByTimeAsync(200);
      rig.setWork("done");
      await vi.advanceTimersByTimeAsync(1000);
      expect(muscled(host)).toBe(true);
      await vi.advanceTimersByTimeAsync(4000);
      expect(muscled(host)).toBe(false);
      expect(plain(host)).toBe(true);
      expect(gemShown(host)).toBe(true);
      expect(part(host, "handR").getAttribute("visibility")).toBe("visible");
      rig.stop();
    });

    it("keeps eating when another shard changes meanwhile, and flexes for it after", async () => {
      const { host, rig } = await reading();
      rig.setChanged(2);
      await vi.advanceTimersByTimeAsync(500);
      rig.setChanged(3);
      await vi.advanceTimersByTimeAsync(2500);
      expect(muscled(host)).toBe(true);
      expect(gemShown(host)).toBe(false);
      expect([...(await leans(host, 6000))].sort()).toEqual(["left", "right"]);
      rig.stop();
    });

    it("still plays Done when the panel closes mid-flex after the answer landed", async () => {
      const { host, rig } = await reading();
      rig.setChanged(3);
      await vi.advanceTimersByTimeAsync(3000);
      rig.setWork("done");
      rig.setSpot(null);
      let happy = false;
      for (let t = 0; t < 8000; t += 16) {
        await vi.advanceTimersByTimeAsync(16);
        happy ||= part(host, "happy").getAttribute("visibility") === "visible";
      }
      expect(happy).toBe(true);
      expect(feet(host)).toEqual(HOME);
      expect(muscled(host)).toBe(false);
      expect(gemShown(host)).toBe(true);
      rig.stop();
    });

    it.each(["idle", "shrug"] as const)("shrinks back and spits his shard out on %s", async (work) => {
      const { host, rig } = await reading();
      rig.setChanged(2);
      await vi.advanceTimersByTimeAsync(2500);
      expect(muscled(host)).toBe(true);
      rig.setWork(work);
      await vi.advanceTimersByTimeAsync(2000);
      expect(muscled(host)).toBe(false);
      expect(gemShown(host)).toBe(true);
      rig.stop();
    });

    it("turned off mid-run, shrinks back with his shard and goes home, leaving nothing behind", async () => {
      const { host, rig } = await reading();
      rig.setChanged(2);
      await vi.advanceTimersByTimeAsync(2500);
      expect(muscled(host)).toBe(true);

      rig.setAssistant(false, null);
      await vi.advanceTimersByTimeAsync(4000);
      expect(feet(host)).toEqual(HOME);
      expect(muscled(host)).toBe(false);
      expect(plain(host)).toBe(true);
      expect(gemShown(host)).toBe(true);
      // Changes after that don't reach him.
      rig.setChanged(4);
      await vi.advanceTimersByTimeAsync(3000);
      expect(muscled(host)).toBe(false);
      rig.stop();
    });

    it("with reduced motion, never bulks up", async () => {
      const { host, rig } = await reading(true);
      rig.setChanged(3);
      await vi.advanceTimersByTimeAsync(5000);
      expect(muscled(host)).toBe(false);
      expect(gemShown(host)).toBe(true);
      rig.stop();
    });
  });
});
