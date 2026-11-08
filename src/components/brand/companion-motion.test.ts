// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CompanionRig, hopFlight, PACE, STAGE, type Spot } from "./companion-motion";

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

/** You move the pointer, as anyone using the app does. */
const stir = () => window.dispatchEvent(new MouseEvent("pointermove", { clientX: 600 }));

/** Lets `ms` go by while you're using the app, stirring every second. */
async function whileActive(ms: number) {
  for (let t = 0; t < ms; t += 1000) {
    stir();
    await vi.advanceTimersByTimeAsync(1000);
  }
}

const asleep = (host: HTMLElement) => host.hasAttribute("data-zz");
/** Whether he's lying down, turned away, as he does to sleep. */
const lyingDown = (host: HTMLElement) =>
  host.querySelector('[data-part="back"]')!.getAttribute("visibility") !== "hidden";

/** Sets whether the window is hidden, as minimizing or covering it does. */
function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event("visibilitychange"));
}

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
    await whileActive(10_000); // walked in and sat down
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

  it("carries on as usual while the window is only unfocused, and jumps to each pose while it's hidden", async () => {
    const host = makeHost();
    const rig = new CompanionRig(host, { reducedMotion: false, home: () => HOME });
    rig.setAssistant(true, menu);
    await whileActive(10_000);

    // Unfocused, as on a second screen or with the browser panel in use,
    // he still hops all the way.
    window.dispatchEvent(new Event("blur"));
    expect(host.hasAttribute("data-paused")).toBe(false);
    rig.setSpot(() => PERCH);
    await vi.advanceTimersByTimeAsync(220 + 220 + 200 + 50);
    expect(feet(host)).not.toEqual(HOME);
    expect(feet(host)).not.toEqual(PERCH);
    await vi.advanceTimersByTimeAsync(2000);
    expect(feet(host)).toEqual(PERCH);

    // Hidden, the hop takes no frames.
    setHidden(true);
    expect(host.hasAttribute("data-paused")).toBe(true);
    rig.setSpot(null);
    await vi.advanceTimersByTimeAsync(0);
    expect(feet(host)).toEqual(HOME);

    setHidden(false);
    expect(host.hasAttribute("data-paused")).toBe(false);
    rig.stop();
  });

  it("as the assistant, never dozes off while you're using the app", async () => {
    const host = makeHost();
    const rig = new CompanionRig(host, { reducedMotion: false, home: () => HOME });
    rig.setAssistant(true, menu);
    // Longer than the 24 s he used to count from each return to idle.
    for (let t = 0; t < 60_000; t += 1000) {
      await whileActive(1000);
      expect(lyingDown(host)).toBe(false);
    }

    // Left alone for his idle pace, he lies down and sleeps.
    await vi.advanceTimersByTimeAsync(PACE.idle * 1000 - 500);
    expect(lyingDown(host)).toBe(false);
    await vi.advanceTimersByTimeAsync(8000);
    expect(lyingDown(host)).toBe(true);
    expect(asleep(host)).toBe(true);
    rig.stop();
  });

  it("as the assistant, wakes slowly when you're back", async () => {
    const host = makeHost();
    const rig = new CompanionRig(host, { reducedMotion: false, home: () => HOME });
    rig.setAssistant(true, menu);
    await vi.advanceTimersByTimeAsync(PACE.idle * 1000 + 15_000);
    expect(asleep(host)).toBe(true);

    stir();
    expect(asleep(host)).toBe(false);
    // Not with a jump: he's still lying there a moment.
    await vi.advanceTimersByTimeAsync(500);
    expect(lyingDown(host)).toBe(true);
    await whileActive(8000);
    expect(lyingDown(host)).toBe(false);
    rig.stop();
  });

  it("as the assistant, stays awake while you use a page in the browser panel", async () => {
    const host = makeHost();
    const rig = new CompanionRig(host, { reducedMotion: false, home: () => HOME });
    rig.setAssistant(true, menu);
    await whileActive(5000);
    // Its clicks and keys never reach him.
    rig.setElsewhere(true);
    await vi.advanceTimersByTimeAsync(4 * PACE.idle * 1000);
    expect(lyingDown(host)).toBe(false);

    // Back from it, he counts from then.
    rig.setElsewhere(false);
    await vi.advanceTimersByTimeAsync(PACE.idle * 1000 - 500);
    expect(lyingDown(host)).toBe(false);
    await vi.advanceTimersByTimeAsync(8000);
    expect(asleep(host)).toBe(true);
    rig.stop();
  });

  it("as the assistant, gets straight back up when you're back while he lies down", async () => {
    const host = makeHost();
    const rig = new CompanionRig(host, { reducedMotion: false, home: () => HOME });
    rig.setAssistant(true, menu);
    // Turned away, on his way down.
    while (!lyingDown(host)) await vi.advanceTimersByTimeAsync(16);
    stir();
    // Up in about a second, rather than lying all the way down first.
    await vi.advanceTimersByTimeAsync(1500);
    expect(lyingDown(host)).toBe(false);
    expect(asleep(host)).toBe(false);
    rig.stop();
  });

  it("as the assistant, sleeps on while there's no provider, whatever you do", async () => {
    const host = makeHost();
    const rig = new CompanionRig(host, { reducedMotion: false, home: () => HOME });
    rig.setAssistant(true, menu);
    await whileActive(8000);
    rig.setWork("sleep");
    await whileActive(8000);
    expect(asleep(host)).toBe(true);
    expect(lyingDown(host)).toBe(true);
    rig.stop();
  });

  it("on his own, lies down only once you've left him alone, and wakes when you're back", async () => {
    const host = makeHost();
    const rig = new CompanionRig(host, { reducedMotion: false, home: () => HOME });
    for (let t = 0; t < 4 * PACE.idle * 1000; t += 1000) {
      await whileActive(1000);
      expect(lyingDown(host)).toBe(false);
    }
    // He looks around every 4 to 10 s while he sits, and lies down at the
    // first look after his idle pace.
    await vi.advanceTimersByTimeAsync(PACE.idle * 1000 - 500);
    expect(lyingDown(host)).toBe(false);
    while (!asleep(host)) await vi.advanceTimersByTimeAsync(100);

    stir();
    await vi.advanceTimersByTimeAsync(500);
    expect(asleep(host)).toBe(false);
    expect(lyingDown(host)).toBe(true);
    await whileActive(8000);
    expect(lyingDown(host)).toBe(false);
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

    it("shrinks back and spits his shard out, without Done, when a change is discarded mid-flex", async () => {
      const { host, rig } = await reading();
      rig.setChanged(3);
      await vi.advanceTimersByTimeAsync(3000);
      // The answer lands while he still flexes, then a change is discarded.
      rig.setWork("done");
      await vi.advanceTimersByTimeAsync(200);
      expect(muscled(host)).toBe(true);
      rig.discarded();
      let happy = false;
      for (let t = 0; t < 4000; t += 16) {
        await vi.advanceTimersByTimeAsync(16);
        happy ||= part(host, "happy").getAttribute("visibility") === "visible";
      }
      expect(happy).toBe(false);
      expect(muscled(host)).toBe(false);
      expect(gemShown(host)).toBe(true);
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
