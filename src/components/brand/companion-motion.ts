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
const HALF_WIDTH = 34;

// Seconds. Dev builds cycle faster so the whole loop is quick to check.
const PACE = import.meta.env.DEV
  ? { sit: [5, 9], sleep: [8, 14] }
  : { sit: [40, 120], sleep: [90, 240] };

type Ease = (p: number) => number;
const linear: Ease = (p) => p;
const inOut: Ease = (p) =>
  p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
const easeIn: Ease = (p) => p * p;
const easeOut: Ease = (p) => 1 - (1 - p) ** 2;
const overshoot: Ease = (p) =>
  1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;

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
  armsUp: number;
  armsIn: number;
  /** Showing the back view. */
  back: boolean;
}

type Animatable = Exclude<keyof Pose, "back" | "phase">;
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
  "shadow",
] as const;

type Parts = Record<(typeof PARTS)[number], SVGElement>;

const between = ([min, max]: readonly number[]) =>
  (min + Math.random() * (max - min)) * 1000;

/** Starts the walk-in and the sit and sleep loop. Returns a function that stops it. */
export function runCompanion(
  host: HTMLElement,
  { reducedMotion }: { reducedMotion: boolean },
): () => void {
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
    armsUp: 0,
    armsIn: 0,
    back: false,
  };

  if (reducedMotion) {
    Object.assign(pose, { x: STAGE.restX, walk: 0, sit: 1 });
    render(pose, parts);
    return () => {};
  }

  let alive = true;
  let tweens: Tween[] = [];
  let frameId = 0;
  let last = 0;
  const timers = new Set<number>();

  const frame = (now: number) => {
    frameId = 0;
    const dt = Math.min(now - last, 64);
    last = now;
    tweens = tweens.filter((t) => {
      const p = Math.min(1, (now - t.start) / t.ms);
      for (const key of Object.keys(t.to) as Animatable[]) {
        const from = t.from[key] ?? 0;
        pose[key] = from + ((t.to[key] ?? 0) - from) * t.ease(p);
      }
      if (p < 1) return true;
      t.done();
      return false;
    });
    pose.phase += dt * 0.0105 * pose.walk;
    render(pose, parts);
    if (tweens.length) frameId = requestAnimationFrame(frame);
  };

  // Promises from a stopped run never settle, so the sequence just ends.
  const tween = (to: Target, ms: number, ease: Ease = inOut) =>
    new Promise<void>((resolve) => {
      if (!alive) return;
      const from: Target = {};
      for (const key of Object.keys(to) as Animatable[]) from[key] = pose[key];
      tweens.push({ from, to, start: performance.now(), ms, ease, done: resolve });
      if (!frameId) {
        last = performance.now();
        frameId = requestAnimationFrame(frame);
      }
    });

  const later = (ms: number, fn: () => void) => {
    const id = window.setTimeout(() => {
      timers.delete(id);
      if (alive) fn();
    }, ms);
    timers.add(id);
  };
  const wait = (ms: number) => new Promise<void>((r) => later(ms, r));

  const setFlag = (name: string, on: boolean) =>
    host.toggleAttribute(`data-${name}`, on);

  const turnAround = async (back: boolean, sleepy = false) => {
    await tween({ turn: 0 }, 200, easeIn);
    pose.back = back;
    pose.faceX = 0;
    if (sleepy) pose.eye = 0.25;
    await tween({ turn: 1 }, 220, easeOut);
  };

  const plop = () =>
    Promise.all([
      tween({ sit: 1 }, 500),
      tween({ squash: 1 }, 220).then(() => tween({ squash: 0 }, 420, overshoot)),
    ]);

  const sitAwhile = async () => {
    const until = performance.now() + between(PACE.sit);
    while (performance.now() < until) {
      await wait(between([4, 10]));
      await tween({ faceX: (Math.random() * 2 - 1) * 7 }, 500);
    }
    await tween({ faceX: 0 }, 400);
  };

  const lieDown = async () => {
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
    await Promise.all([tween({ armsUp: 1 }, 550), tween({ eye: 0 }, 300)]);
    await wait(500);
    await tween({ armsUp: 0 }, 500);
    await tween({ eye: 1 }, 250);
  };

  const blinkNow = () =>
    later(between([3, 7]), async () => {
      if (!pose.back && pose.lie === 0 && pose.eye > 0.9) {
        await tween({ blink: 0 }, 80, linear);
        await tween({ blink: 1 }, 110, linear);
      }
      blinkNow();
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
      await wait(between(PACE.sleep));
      await wakeUp();
    }
  };

  render(pose, parts);
  blinkNow();
  void live();

  return () => {
    alive = false;
    tweens = [];
    if (frameId) cancelAnimationFrame(frameId);
    for (const id of timers) clearTimeout(id);
    timers.clear();
  };
}

const place = (el: SVGElement, transform: string) =>
  el.setAttribute("transform", transform);

function render(p: Pose, el: Parts) {
  const { ground } = STAGE;
  const w = p.walk;
  const ph = p.phase;
  const bob = -Math.abs(Math.sin(ph)) * 5 * w;

  place(
    el.root,
    `translate(${p.x} ${ground - (HALF_WIDTH + 1) * p.lie}) rotate(${90 * p.lie + Math.sin(ph) * 2.5 * w}) scale(${p.turn} 1)`,
  );

  const sx = 1 + 0.03 * p.sit + 0.07 * p.squash;
  const sy = 1 - 0.05 * p.sit - 0.09 * p.squash + 0.06 * p.armsUp;
  const body = `translate(0 ${8 * p.sit + bob}) scale(${sx} ${sy})`;
  place(el.frontBody, body);
  place(el.backBody, body);

  for (const [side, s] of [["L", -1], ["R", 1]] as const) {
    const swing = Math.sin(ph + (s > 0 ? Math.PI : 0));
    const lift = Math.max(0, swing) * 8 * w;
    place(
      el[`frontLeg${side}`],
      `translate(${s * (13 + 6 * p.sit)} ${-22 + 12 * p.sit - lift}) rotate(${-swing * 14 * w}) scale(1 ${1 - 0.45 * p.sit})`,
    );
    const arm = `translate(${s * 31} -58) rotate(${-s * (12 + p.armsUp * 150 - p.armsIn * 18) + Math.sin(ph) * 16 * w})`;
    place(el[`frontArm${side}`], arm);
    place(el[`backArm${side}`], arm);
  }

  // Lying on his side, the lower leg rests along the floor and the upper
  // one slants down across it, so they cross near the feet.
  const legScale = 0.4 + 1.2 * p.lie;
  place(
    el.backLegR,
    `translate(9 ${-12 + 4 * p.lie}) rotate(${-22 * p.lie}) scale(1 ${legScale})`,
  );
  place(
    el.backLegL,
    `translate(-9 ${-12 + 4 * p.lie}) rotate(${-44 * p.lie}) scale(1 ${legScale})`,
  );

  place(el.face, `translate(${p.faceX} 0)`);
  const open = p.eye * p.blink;
  el.eyeL.setAttribute("ry", String(5.5 * open + 0.8));
  el.eyeR.setAttribute("ry", String(5.5 * open + 0.8));
  el.shine.setAttribute("visibility", open > 0.6 ? "visible" : "hidden");

  el.front.setAttribute("visibility", p.back ? "hidden" : "visible");
  el.back.setAttribute("visibility", p.back ? "visible" : "hidden");

  el.shadow.setAttribute("cx", String(p.x + 30 * p.lie));
  el.shadow.setAttribute("rx", String(36 + 58 * p.lie));
}
