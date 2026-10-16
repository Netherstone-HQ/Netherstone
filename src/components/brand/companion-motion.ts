// Moves the companion by writing SVG transforms straight to the DOM. Frames
// only run while a tween is in flight; breathing and the floating z's are CSS
// animations (see App.css), so a sitting or sleeping companion costs no script
// time between the odd blink or glance.

/** Stage size in SVG units; it's drawn at `scale` CSS pixels per unit. */
export const STAGE = {
  width: 440,
  height: 160,
  ground: 150,
  restX: 300,
  scale: 0.5,
} as const;

const ENTRY_X = 560;
/** Half the body's width, which is how high it sits when lying down. */
const HALF_WIDTH = 40;
/** Where the gem rests while he sleeps, in stage units. */
const GEM_GROUND = { x: STAGE.restX - 60, y: STAGE.ground - 12 };

// Seconds. Dev builds cycle faster so the whole loop is quick to check.
const PACE = import.meta.env.DEV
  ? { sit: [5, 9], minSit: 3, sleep: [8, 14], idle: 8, nodGap: 3 }
  : { sit: [40, 120], minSit: 20, sleep: [90, 240], idle: 60, nodGap: 20 };
/** How long after the last edit he keeps watching the editor. */
const WATCH_MS = 8000;

type Ease = (p: number) => number;
const linear: Ease = (p) => p;
const inOut: Ease = (p) =>
  p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
const easeIn: Ease = (p) => p * p;
const easeOut: Ease = (p) => 1 - (1 - p) ** 2;
const overshoot: Ease = (p) =>
  1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;

const MOUTHS = {
  smile: { d: "M-2,-60Q2,-56 6,-60", fill: "none" },
  o: {
    d: "M-0.6,-59.5a2.6,3 0 1,0 5.2,0a2.6,3 0 1,0-5.2,0Z",
    fill: "var(--companion-ink)",
  },
  flat: { d: "M-1,-59Q2,-58.4 5,-59", fill: "none" },
};
type Mouth = keyof typeof MOUTHS;

interface Pose {
  x: number;
  walk: number;
  phase: number;
  sit: number;
  squash: number;
  lie: number;
  /** Horizontal scale while turning around; 0 is edge-on. */
  turn: number;
  faceX: number;
  eye: number;
  blink: number;
  armsUpL: number;
  armsUpR: number;
  armsIn: number;
  /** The raised right arm swinging side to side, from -1 to 1. */
  wiggle: number;
  nod: number;
  /** 0 holds the gem in his lap, 1 has it on the ground beside him. */
  gemDown: number;
  /** Showing the back view. */
  back: boolean;
  mouth: Mouth;
}

type Animatable = Exclude<keyof Pose, "back" | "phase" | "mouth">;
type Target = Partial<Record<Animatable, number>>;

interface Tween {
  from: Target;
  to: Target;
  start: number;
  ms: number;
  ease: Ease;
  done: () => void;
}

const PARTS = [
  "hit",
  "root",
  "front",
  "back",
  "frontBody",
  "backBody",
  "frontLegL",
  "frontLegR",
  "frontArmL",
  "frontArmR",
  "backArmL",
  "backArmR",
  "backLegL",
  "backLegR",
  "face",
  "eyeL",
  "eyeR",
  "shine",
  "mouth",
  "shadow",
  "gem",
  "handL",
  "handR",
] as const;

type Parts = Record<(typeof PARTS)[number], SVGElement>;

export interface CompanionControls {
  /** A save finished. */
  nod: () => void;
  /** The open shard was edited. */
  noticeEdit: () => void;
  stop: () => void;
}

const between = ([min, max]: readonly number[]) =>
  (min + Math.random() * (max - min)) * 1000;
const clamp = (value: number, limit: number) =>
  Math.max(-limit, Math.min(limit, value));

/** Starts the walk-in and the sit and sleep loop, and listens for pokes. */
export function runCompanion(
  host: HTMLElement,
  { reducedMotion }: { reducedMotion: boolean },
): CompanionControls {
  const parts = Object.fromEntries(
    PARTS.map((name) => [
      name,
      host.querySelector<SVGElement>(`[data-part="${name}"]`),
    ]),
  ) as Parts;

  const pose: Pose = {
    x: ENTRY_X,
    walk: 1,
    phase: 0,
    sit: 0,
    squash: 0,
    lie: 0,
    turn: 1,
    faceX: 0,
    eye: 1,
    blink: 1,
    armsUpL: 0,
    armsUpR: 0,
    armsIn: 0,
    wiggle: 0,
    nod: 0,
    gemDown: 0,
    back: false,
    mouth: "smile",
  };

  const timers = new Set<number>();
  const cleanups: (() => void)[] = [];
  let alive = true;
  const later = (ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (alive) fn();
    }, ms);
    timers.add(id);
  };
  const wait = (ms: number) => new Promise<void>((r) => later(ms, r));

  const listen = <K extends keyof WindowEventMap>(
    target: EventTarget,
    type: K,
    fn: (e: WindowEventMap[K]) => void,
  ) => {
    target.addEventListener(type, fn as EventListener, { passive: true });
    cleanups.push(() =>
      target.removeEventListener(type, fn as EventListener),
    );
  };

  const stop = () => {
    alive = false;
    for (const cleanup of cleanups) cleanup();
    for (const id of timers) clearTimeout(id);
    timers.clear();
  };

  if (reducedMotion) {
    Object.assign(pose, { x: STAGE.restX, walk: 0, sit: 1 });
    render(pose, parts);
    // Still answers a poke, just without moving.
    listen(parts.hit, "click", () => {
      pose.mouth = "o";
      render(pose, parts);
      later(600, () => {
        pose.mouth = "smile";
        render(pose, parts);
      });
    });
    return { nod: () => {}, noticeEdit: () => {}, stop };
  }

  let tweens: Tween[] = [];
  let frameId = 0;
  let last = 0;

  const frame = (now: number) => {
    frameId = 0;
    const dt = Math.min(now - last, 64);
    last = now;
    tweens = tweens.filter((t) => {
      const p = Math.min(1, (now - t.start) / t.ms);
      const keys = Object.keys(t.to) as Animatable[];
      for (const key of keys) {
        const from = t.from[key] ?? 0;
        pose[key] = from + ((t.to[key] ?? 0) - from) * t.ease(p);
      }
      if (p < 1 && keys.length) return true;
      t.done();
      return false;
    });
    pose.phase += dt * 0.0105 * pose.walk;
    render(pose, parts);
    if (tweens.length) frameId = requestAnimationFrame(frame);
  };

  // Promises from a stopped run never settle, so the sequence just ends.
  // A newer tween takes over any values an older one was still moving.
  const tween = (to: Target, ms: number, ease: Ease = inOut) =>
    new Promise<void>((resolve) => {
      if (!alive) return;
      const from: Target = {};
      for (const key of Object.keys(to) as Animatable[]) {
        from[key] = pose[key];
        for (const t of tweens) delete t.to[key];
      }
      tweens.push({ from, to, start: performance.now(), ms, ease, done: resolve });
      if (!frameId) {
        last = performance.now();
        frameId = requestAnimationFrame(frame);
      }
    });

  const setMouth = (mouth: Mouth) => {
    pose.mouth = mouth;
    render(pose, parts);
  };

  const setFlag = (name: string, on: boolean) =>
    host.toggleAttribute(`data-${name}`, on);

  // ── What he notices ───────────────────────────────────────────────────────

  let pointerX: number | null = null;
  let lastActivity = performance.now();
  let lastEdit = -Infinity;
  listen(window, "pointermove", (e) => {
    pointerX = e.clientX;
    lastActivity = performance.now();
  });

  const drowsy = () => performance.now() - lastActivity > PACE.idle * 1000;

  /** Toward the editor while you write, otherwise toward the pointer. */
  const lookTarget = () => {
    if (performance.now() - lastEdit < WATCH_MS) return -7;
    if (pointerX === null || Math.random() < 0.3) {
      return (Math.random() * 2 - 1) * 7;
    }
    const rect = host.getBoundingClientRect();
    const dx = pointerX - (rect.left + STAGE.restX * STAGE.scale);
    return clamp(dx / 30 + (Math.random() - 0.5) * 2, 7);
  };

  // ── Moves ─────────────────────────────────────────────────────────────────

  /** True while he's sitting up and free to react to you. */
  let sitting = false;
  let reacting = false;
  const react = async (move: () => Promise<void>) => {
    if (!sitting || reacting) return;
    reacting = true;
    await move();
    reacting = false;
  };

  /** Ends the current sleep early; only set while he's asleep. */
  let wakeEarly: (() => void) | null = null;
  const doze = (ms: number) =>
    new Promise<void>((resolve) => {
      wakeEarly = resolve;
      later(ms, resolve);
    }).then(() => {
      wakeEarly = null;
    });

  const turnAround = async (back: boolean, sleepy = false) => {
    await tween({ turn: 0 }, 200, easeIn);
    pose.back = back;
    pose.faceX = 0;
    if (sleepy) {
      pose.eye = 0.25;
      pose.mouth = "flat";
    }
    await tween({ turn: 1 }, 220, easeOut);
  };

  const plop = () =>
    Promise.all([
      tween({ sit: 1 }, 500),
      tween({ squash: 1 }, 220).then(() => tween({ squash: 0 }, 420, overshoot)),
    ]);

  const sitAwhile = async () => {
    sitting = true;
    const start = performance.now();
    const until = start + between(PACE.sit);
    // Left alone, he lies down early, but never straight after getting up.
    const restless = () =>
      drowsy() && performance.now() - start > PACE.minSit * 1000;
    while (performance.now() < until && !restless()) {
      await wait(between([4, 10]));
      if (!reacting) await tween({ faceX: lookTarget() }, 500);
    }
    while (reacting) await wait(200);
    sitting = false;
    await tween({ faceX: 0 }, 400);
  };

  const setGemDown = async () => {
    await tween({ faceX: -6 }, 350);
    await Promise.all([
      tween({ gemDown: 1 }, 650),
      tween({ squash: 0.4 }, 300).then(() => tween({ squash: 0 }, 350)),
    ]);
    await wait(250);
  };

  const pickGemUp = async () => {
    await tween({ faceX: -6 }, 350);
    await tween({ gemDown: 0 }, 650);
    await tween({ faceX: 0 }, 300);
  };

  const lieDown = async () => {
    await setGemDown();
    await tween({ faceX: 8 }, 400);
    await wait(300);
    await turnAround(true);
    await wait(350);
    await Promise.all([tween({ lie: 1 }, 1100), tween({ armsIn: 1 }, 900)]);
    await tween({ squash: 0.6 }, 160);
    await tween({ squash: 0 }, 380, overshoot);
    setFlag("breathing", true);
    setFlag("zz", true);
  };

  const wakeUp = async () => {
    setFlag("zz", false);
    await wait(700);
    setFlag("breathing", false);
    await tween({ lie: 0.93 }, 300);
    await tween({ lie: 1 }, 300);
    await wait(400);
    await Promise.all([tween({ lie: 0 }, 900), tween({ armsIn: 0 }, 900)]);
    await wait(300);
    await turnAround(false, true);
    await wait(300);
    // A big stretch and a yawn, with both hands free.
    pose.mouth = "o";
    await Promise.all([
      tween({ armsUpL: 1, armsUpR: 1 }, 550),
      tween({ eye: 0 }, 300),
    ]);
    await wait(500);
    pose.mouth = "flat";
    await tween({ armsUpL: 0, armsUpR: 0 }, 500);
    await tween({ eye: 1 }, 250);
    setMouth("smile");
    await pickGemUp();
  };

  const poke = () => {
    if (wakeEarly) {
      wakeEarly();
      return;
    }
    void react(async () => {
      pose.mouth = "o";
      await tween({ squash: 1, eye: 0.15 }, 110, easeOut);
      await tween({ squash: 0 }, 420, overshoot);
      await tween({ eye: 1 }, 160);
      setMouth("smile");
    });
  };

  // He waves with his right hand and keeps the gem in his left.
  const wave = () =>
    void react(async () => {
      await tween({ armsUpR: 0.85 }, 320);
      for (const side of [1, -1, 1, -1]) await tween({ wiggle: side }, 150);
      await tween({ wiggle: 0 }, 120);
      await tween({ armsUpR: 0 }, 360);
    });

  let lastNod = -Infinity;
  const nod = () =>
    void react(async () => {
      if (performance.now() - lastNod < PACE.nodGap * 1000) return;
      lastNod = performance.now();
      await tween({ nod: 1 }, 150);
      await tween({ nod: 0 }, 260);
    });

  const noticeEdit = () => {
    const now = performance.now();
    const wasQuiet = now - lastEdit > WATCH_MS;
    lastEdit = lastActivity = now;
    if (wasQuiet && sitting && !reacting) void tween({ faceX: -7 }, 450);
  };

  // A double click waves instead of poking twice.
  let pendingPoke = 0;
  listen(parts.hit, "click", (e) => {
    clearTimeout(pendingPoke);
    if (e.detail >= 2) wave();
    else pendingPoke = window.setTimeout(() => alive && poke(), 220);
  });

  const live = async () => {
    const distance = ENTRY_X - STAGE.restX;
    await Promise.all([
      tween({ x: STAGE.restX }, distance * 12, linear),
      tween({ faceX: -6 }, 300),
    ]);
    await tween({ walk: 0 }, 250);
    await tween({ faceX: 0 }, 300);
    await plop();
    await wait(800);
    for (;;) {
      await sitAwhile();
      await lieDown();
      await doze(between(PACE.sleep));
      await wakeUp();
    }
  };

  const blinkNow = () =>
    later(between([3, 7]), async () => {
      if (!pose.back && pose.lie === 0 && pose.eye > 0.9) {
        await tween({ blink: 0 }, 80, linear);
        await tween({ blink: 1 }, 110, linear);
      }
      blinkNow();
    });

  render(pose, parts);
  blinkNow();
  void live();

  cleanups.push(() => {
    clearTimeout(pendingPoke);
    tweens = [];
    if (frameId) cancelAnimationFrame(frameId);
  });
  return { nod, noticeEdit, stop };
}

const place = (el: SVGElement, transform: string) =>
  el.setAttribute("transform", transform);
const show = (el: SVGElement, visible: boolean) =>
  el.setAttribute("visibility", visible ? "visible" : "hidden");

function render(p: Pose, el: Parts) {
  const { ground } = STAGE;
  const w = p.walk;
  const ph = p.phase;
  const bob = -Math.abs(Math.sin(ph)) * 5 * w;

  place(
    el.root,
    `translate(${p.x} ${ground - (HALF_WIDTH + 1) * p.lie}) rotate(${90 * p.lie + Math.sin(ph) * 2.5 * w}) scale(${p.turn} 1)`,
  );

  const armsUp = (p.armsUpL + p.armsUpR) / 2;
  const sx = 1 + 0.03 * p.sit + 0.07 * p.squash;
  const sy =
    1 - 0.05 * p.sit - 0.09 * p.squash + 0.06 * armsUp - 0.03 * p.nod;
  const lift = 8 * p.sit + bob;
  const body = `translate(0 ${lift}) scale(${sx} ${sy})`;
  place(el.frontBody, body);
  place(el.backBody, body);

  // The gem sits in his lap and arcs down to the ground beside him.
  const down = p.gemDown;
  const arc = Math.sin(Math.PI * down);
  const lapX = p.x + 2 * sx;
  const lapY = ground + lift - 30 * sy;
  const gemX = lapX + (GEM_GROUND.x - lapX) * down;
  const gemY = lapY + (GEM_GROUND.y - lapY) * down - arc * 16;
  place(el.gem, `translate(${gemX} ${gemY}) rotate(${-arc * 20})`);

  for (const [side, s] of [["L", -1], ["R", 1]] as const) {
    const up = s < 0 ? p.armsUpL : p.armsUpR;
    const hold = (1 - down) * (1 - up);
    const swing = Math.sin(ph + (s > 0 ? Math.PI : 0));
    const step = Math.max(0, swing) * 8 * w;
    place(
      el[`frontLeg${side}`],
      `translate(${s * (15 + 6 * p.sit)} ${-22 + 12 * p.sit - step}) rotate(${-swing * 14 * w}) scale(1 ${1 - 0.45 * p.sit})`,
    );
    const wiggle = s > 0 ? p.wiggle * 22 : 0;
    const arm = `translate(${s * 30} -50) rotate(${-s * (12 - 44 * hold + 150 * up - 18 * p.armsIn + wiggle) + Math.sin(ph) * 16 * w * (1 - hold)})`;
    place(el[`frontArm${side}`], arm);
    place(el[`backArm${side}`], arm);

    const hand = el[`hand${side}`];
    place(hand, `translate(${gemX + s * 13} ${gemY + 3})`);
    show(hand, hold > 0.5 && !p.back);
  }

  // Lying on his side, the lower leg rests along the floor and the upper
  // one slants down across it, so they cross near the feet.
  const legScale = 0.4 + 1.2 * p.lie;
  place(
    el.backLegR,
    `translate(11 ${-12 + 4 * p.lie}) rotate(${-22 * p.lie}) scale(1 ${legScale})`,
  );
  place(
    el.backLegL,
    `translate(-11 ${-12 + 4 * p.lie}) rotate(${-44 * p.lie}) scale(1 ${legScale})`,
  );

  place(el.face, `translate(${p.faceX} ${4 * p.nod})`);
  const open = p.eye * p.blink;
  el.eyeL.setAttribute("ry", String(5.5 * open + 0.8));
  el.eyeR.setAttribute("ry", String(5.5 * open + 0.8));
  show(el.shine, open > 0.6);
  const mouth = MOUTHS[p.mouth];
  if (el.mouth.getAttribute("d") !== mouth.d) {
    el.mouth.setAttribute("d", mouth.d);
    el.mouth.style.fill = mouth.fill;
  }

  show(el.front, !p.back);
  show(el.back, p.back);

  el.shadow.setAttribute("cx", String(p.x + 27 * p.lie));
  el.shadow.setAttribute("rx", String(42 + 46 * p.lie));
}
