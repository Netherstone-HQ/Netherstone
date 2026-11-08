// The companion's rig: what he does and when. Tweens run a frame at a time
// only while one is in flight (companion-tween.ts), and each frame is drawn
// as SVG transforms (companion-draw.ts). Breathing and the floating z's are
// CSS animations (see App.css), so a sitting or sleeping companion costs no
// script time between the odd blink or glance.
//
// He has two lives. On his own he walks in, sits, lies down and sleeps, and
// answers a poke. As the assistant he answers a click with a menu, hops onto
// the panel's composer and back, and shows what the assistant is doing.

import { CompanionDrawing } from "./companion-draw";
import {
  type Animatable,
  FLEXES,
  MAX_BULK,
  type Mouth,
  NEUTRAL,
  type Pose,
  type Spot,
  STAGE,
  type Target,
} from "./companion-pose";
import {
  CANCEL,
  easeIn,
  easeOut,
  inOut,
  linear,
  overshoot,
  type Ease,
  type Step,
  Tweens,
} from "./companion-tween";

export { STAGE, type Spot } from "./companion-pose";

const ENTRY_X = 560;

// Seconds. Dev builds cycle faster so the whole loop is quick to check.
const PACE = import.meta.env.DEV
  ? { sit: [5, 9], minSit: 3, sleep: [8, 14], idle: 8, nodGap: 3 }
  : { sit: [40, 120], minSit: 20, sleep: [90, 240], idle: 60, nodGap: 20 };
/** How long after the last edit he keeps watching the editor. */
const WATCH_MS = 8000;
/** As the assistant: seconds between glances, and how long until he dozes. */
const GLANCE = [3.5, 7.5];
const DOZE_MS = 24_000;
/** The panel slides in before he hops onto it. */
const HOP_DELAY = 220;
/** Two clicks this close together are a double click. */
const DOUBLE_CLICK_MS = 220;

/** How a change to several shards ended. */
type HeavyEnd = "done" | "error" | "stop";

/** What the assistant is doing, as he shows it. */
export type Work = "idle" | "search" | "read" | "done" | "shrug" | "sleep";

/** His menu, which lives in React. */
export interface CompanionMenu {
  isOpen: () => boolean;
  open: () => void;
  close: () => void;
}

const between = ([min, max]: readonly number[]) =>
  (min + Math.random() * (max - min)) * 1000;
const clamp = (value: number, limit: number) =>
  Math.max(-limit, Math.min(limit, value));

export class CompanionRig {
  private readonly drawing: CompanionDrawing;
  private readonly motion: Tweens<Animatable>;
  private readonly reduced: boolean;
  private readonly pose: Pose;
  private readonly cleanups: (() => void)[] = [];
  /** Bumped by every new sequence; older ones end at their next step. */
  private gen = 0;

  // Where he is, in viewport pixels, and the hop he's on.
  private spot: Spot;
  private hop: { from: Spot; to: Spot; height: number } | null = null;
  private home: () => Spot;
  /** Where he belongs: on the panel, or his corner when null. */
  private target: (() => Spot) | null = null;
  /** Where he sits now; "between" once a hop is under way. */
  private at: "home" | "panel" | "between" = "home";

  // As the assistant.
  private assistant = false;
  private work: Work = "idle";
  /** Asked for while he couldn't play it yet. */
  private workWaiting = false;
  /** What he's showing now, which can differ from `work` for a moment. */
  private state: Work | "hello" | "enter" | "hop" | "leave" | "heavy" =
    "enter";
  private menu: CompanionMenu | null = null;
  /**
   * A change to several shards under way: the shards changed so far, and
   * how many he's flexed for. Null otherwise.
   */
  private heavy: { changed: number; flexed: number; done: boolean } | null =
    null;
  /** Whether he's flexing his way through `heavy` now. */
  private flexing = false;

  // On his own.
  private sitting = false;
  private reacting = false;
  private wakeEarly: (() => void) | null = null;
  private pointerX: number | null = null;
  private lastActivity = performance.now();
  private lastEdit = -Infinity;
  private lastNod = -Infinity;
  private pendingClick = 0;

  constructor(
    private readonly host: HTMLElement,
    { reducedMotion, home }: { reducedMotion: boolean; home: () => Spot },
  ) {
    this.drawing = new CompanionDrawing(host);
    this.reduced = reducedMotion;
    this.home = home;
    this.spot = home();
    this.pose = {
      ...(NEUTRAL as Record<Animatable, number>),
      x: ENTRY_X,
      walk: 1,
      sit: 0,
      phase: 0,
      turn: 1,
      blink: 1,
      hopP: 0,
      empty: 0,
      stow: 1,
      gemHidden: true,
      back: false,
      mouth: "smile",
    };
    this.motion = new Tweens<Animatable>(
      this.pose,
      reducedMotion,
      (dt) => {
        this.pose.phase += dt * 0.0085 * this.pose.walk;
        this.render();
      },
      () => this.render(),
    );
    host.toggleAttribute("data-still", reducedMotion);

    this.listen(window, "pointermove", (e) => {
      this.pointerX = e.clientX;
      this.lastActivity = performance.now();
    });
    this.listen(this.drawing.parts.hit, "click", (e) =>
      this.clicked(e.detail),
    );
    this.cleanups.push(() => clearTimeout(this.pendingClick));
    // Asleep, he breathes for a while and then lies still (see App.css). The
    // first of the sleep animations to run out ends them all, so the z's
    // never blink out before they stand still.
    this.listen(host, "animationend", (e) => {
      const sleepy = e.animationName === "companion-breathe" || e.animationName === "companion-z";
      if (sleepy && host.hasAttribute("data-breathing")) {
        this.flag("breathing", false);
        this.flag("resting", true);
      }
    });
    // Nothing moves while the window is hidden or in the background.
    this.listen(window, "blur", () => this.pause(true));
    this.listen(window, "focus", () => this.pause(false));
    this.listen(document, "visibilitychange", () =>
      this.pause(document.hidden || !document.hasFocus()),
    );

    if (reducedMotion) {
      this.state = "idle";
      Object.assign(this.pose, NEUTRAL, { x: STAGE.restX, gemHidden: false });
      this.render();
      return;
    }
    this.render();
    this.blinkLater();
    void this.run((step) => this.walkIn(step));
  }

  // ── Outside ───────────────────────────────────────────────────────────────

  stop() {
    this.gen++;
    for (const cleanup of this.cleanups) cleanup();
    this.motion.stop();
  }

  /** Whether he's the assistant, rather than on his own. */
  setAssistant(on: boolean, menu: CompanionMenu | null) {
    this.menu = menu;
    if (on === this.assistant) return;
    this.assistant = on;
    if (!on) {
      this.target = null;
      this.work = "idle";
      this.heavy = null;
    }
    this.direct();
  }

  /** Wakes him if he was asleep for want of a provider. */
  wakeFromSleep() {
    if (this.work === "sleep") this.setWork("idle");
  }

  /** Where he sits: on the panel (`spot`), or his corner when null. */
  setSpot(spot: (() => Spot) | null) {
    if (!this.assistant) return;
    const before = this.where();
    this.target = spot;
    if (this.where() === before && this.at !== "between") {
      this.relocate();
      return;
    }
    // The panel slides in first.
    this.direct(this.at === "home" && spot !== null ? HOP_DELAY : 0);
  }

  /** His corner or his spot moved: he moves with it, unless mid-hop. */
  relocate() {
    if (this.at !== this.where()) return;
    this.spot = (this.target ?? this.home)();
    this.render();
  }

  /** What the assistant is doing now. */
  setWork(work: Work) {
    if (!this.assistant) return;
    if (work === this.work && work !== "done" && work !== "shrug") return;
    this.work = work;
    this.workWaiting = true;
    if (this.busy() || this.at !== this.where()) return;
    this.play(work);
  }

  /**
   * How many shards the answer coming in has changed so far. From the
   * second one, he eats his shard, bulks up and flexes once for each.
   */
  setChanged(count: number) {
    if (!this.assistant || this.reduced || count < 2) return;
    if (this.heavy) {
      this.heavy.changed = Math.max(this.heavy.changed, count);
      if (!this.flexing && this.state === "heavy") this.keepFlexing();
      return;
    }
    this.heavy = { changed: count, flexed: 0, done: false };
    if (this.busy() || this.at !== this.where()) return;
    this.bulkUp();
  }

  /** Waves, walks off to the right, and then `gone` runs. */
  leave(gone: () => void) {
    // Mid-hop, he lands where he was going first.
    if (this.at === "between") {
      this.at = this.where();
      this.relocate();
    }
    this.state = "leave";
    void this.run(async (step) => {
      await this.settle(step);
      const p = this.pose;
      p.mouth = "grin";
      if (!this.reduced) {
        await step(this.tween({ armsUpR: 0.85 }, 260));
        for (const s of [1, -1, 1]) await step(this.tween({ wiggle: s }, 130));
        await step(this.tween({ wiggle: 0, armsUpR: 0 }, 260));
      }
      p.mouth = "smile";
      await this.stowGem(step);
      if (!this.reduced) {
        await step(this.tween({ armsUpR: 0, faceX: 6 }, 200));
        await step(this.tween({ sit: 0, walk: 1 }, 300));
        await step(this.tween({ x: ENTRY_X + 40 }, 1900, linear));
      }
      gone();
    });
  }

  /** A save finished. */
  nod() {
    if (this.assistant) return;
    this.react(async (step) => {
      if (performance.now() - this.lastNod < PACE.nodGap * 1000) return;
      this.lastNod = performance.now();
      await step(this.tween({ nod: 1 }, 150));
      await step(this.tween({ nod: 0 }, 260));
    });
  }

  /** The open shard was edited. */
  noticeEdit() {
    const now = performance.now();
    const wasQuiet = now - this.lastEdit > WATCH_MS;
    this.lastEdit = this.lastActivity = now;
    if (this.assistant || this.reduced) return;
    if (wasQuiet && this.sitting && !this.reacting) {
      void this.tween({ faceX: -7 }, 450);
    }
  }

  // ── Engine ────────────────────────────────────────────────────────────────

  private listen<K extends keyof (WindowEventMap & DocumentEventMap)>(
    target: EventTarget,
    type: K,
    fn: (e: (WindowEventMap & DocumentEventMap)[K]) => void,
  ) {
    target.addEventListener(type, fn as EventListener, { passive: true });
    this.cleanups.push(() =>
      target.removeEventListener(type, fn as EventListener),
    );
  }

  private later(ms: number, fn: () => void) {
    this.motion.later(ms, fn);
  }

  private wait(ms: number) {
    return this.motion.wait(ms);
  }

  private tween(to: Target, ms: number, ease: Ease = inOut) {
    return this.motion.to(to, ms, ease);
  }

  private setMouth(mouth: Mouth) {
    this.pose.mouth = mouth;
    this.render();
  }

  private flag(name: string, on: boolean) {
    this.host.toggleAttribute(`data-${name}`, on);
  }

  /** Breathing while asleep; either way, he isn't lying still yet. */
  private breathe(on: boolean) {
    this.flag("breathing", on);
    this.flag("resting", false);
  }

  private pause(paused: boolean) {
    this.motion.paused = paused;
    this.flag("paused", paused);
  }

  private stepFor(gen: number): Step {
    return async (move) => {
      const value = await move;
      if (gen !== this.gen || !this.motion.alive) throw CANCEL;
      return value;
    };
  }

  /**
   * Starts a new sequence. The one running stops where it is: its moves
   * end, and a hop under way leaves him wherever he is in the air.
   */
  private async run(sequence: (step: Step) => Promise<void>) {
    const gen = ++this.gen;
    this.motion.keepOnly("blink");
    if (this.hop) {
      this.spot = this.hopPoint();
      this.hop = null;
      this.pose.hopP = 0;
    }
    this.wakeEarly = null;
    this.sitting = false;
    this.reacting = false;
    this.flexing = false;
    try {
      await sequence(this.stepFor(gen));
    } catch (error) {
      if (error !== CANCEL) throw error;
    }
  }

  /** A quick reaction alongside the sequence running, ended with it. */
  private react(move: (step: Step) => Promise<void>) {
    if (!this.sitting || this.reacting) return;
    this.reacting = true;
    const step = this.stepFor(this.gen);
    void move(step)
      .catch((error) => {
        if (error !== CANCEL) throw error;
      })
      .finally(() => {
        this.reacting = false;
      });
  }

  private blinkLater() {
    this.later(between([3, 7]), async () => {
      const p = this.pose;
      if (!p.back && p.lie === 0 && p.eye > 0.9 && p.happy < 0.5) {
        await this.tween({ blink: 0 }, 80, linear);
        await this.tween({ blink: 1 }, 110, linear);
      }
      this.blinkLater();
    });
  }

  // ── Where he goes ─────────────────────────────────────────────────────────

  private where() {
    return this.target ? "panel" : "home";
  }

  /** Walking in or out: he finishes that first. */
  private busy() {
    return this.state === "enter" || this.state === "leave";
  }

  /** Starts what he should be doing now, after hopping wherever he belongs. */
  private direct(delay = 0) {
    if (this.busy()) return;
    if (this.at === this.where()) {
      if (this.assistant) this.resume();
      else void this.run((step) => this.onHisOwn(step));
      return;
    }
    this.state = "hop";
    void this.run(async (step) => {
      if (delay && !this.reduced) await step(this.wait(delay));
      const going = this.where();
      this.at = "between";
      await this.hopTo(step, (this.target ?? this.home)());
      this.at = going;
      // His spot may have moved while he was in the air.
      this.relocate();
      if (this.assistant) this.resume();
      else await this.onHisOwn(step);
    });
  }

  /** Hops to `to`, picking his shard up first so it never floats along. */
  private async hopTo(step: Step, to: Spot) {
    await this.getUp(step);
    await this.shrinkBack(step);
    const p = this.pose;
    if (p.gemDown > 0 || p.gemHidden) {
      p.mouth = "smile";
      if (p.gemHidden) await this.pullGem(step);
      else {
        await step(
          this.tween({ faceX: -6, armsUpL: 0, armsUpR: 0, tilt: 0 }, 260),
        );
        await step(this.tween({ gemDown: 0 }, 520));
      }
    }
    if (this.reduced) {
      this.spot = to;
      this.render();
      return;
    }
    const from = { ...this.spot };
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    await step(
      this.tween(
        { faceX: Math.sign(dx || 1) * 5, faceY: dy < 0 ? -3 : 2, gemUp: 0, happy: 0 },
        220,
      ),
    );
    p.mouth = "smile";
    await step(this.tween({ squash: 1 }, 200, easeOut));
    this.hop = { from, to, height: 36 + Math.abs(dy) * 0.35 };
    p.hopP = 0;
    p.mouth = "o";
    const flight = hopFlight(from, to);
    await step(
      Promise.all([
        this.tween({ hopP: 1 }, flight, linear),
        this.tween({ squash: -0.9 }, 110, easeOut).then(() =>
          this.tween({ squash: 0 }, flight - 110, inOut),
        ),
      ]),
    );
    this.spot = to;
    this.hop = null;
    p.hopP = 0;
    p.mouth = "smile";
    await step(this.tween({ squash: 1 }, 90, easeOut));
    await step(
      Promise.all([
        this.tween({ squash: 0 }, 420, overshoot),
        this.tween({ faceX: 0, faceY: 0 }, 300),
      ]),
    );
  }

  private hopPoint(): Spot {
    const hop = this.hop;
    if (!hop) return this.spot;
    const k = this.pose.hopP;
    return {
      x: hop.from.x + (hop.to.x - hop.from.x) * k,
      y:
        hop.from.y +
        (hop.to.y - hop.from.y) * k -
        hop.height * Math.sin(Math.PI * k),
    };
  }

  // ── Clicks ────────────────────────────────────────────────────────────────

  private clicked(detail: number) {
    clearTimeout(this.pendingClick);
    // A double click is one gesture, not two clicks.
    const now = (fn: () => void) =>
      detail >= 2
        ? fn()
        : (this.pendingClick = window.setTimeout(
            () => this.motion.alive && fn(),
            DOUBLE_CLICK_MS,
          ));
    if (this.assistant) now(() => void this.menuClick());
    else if (this.reduced) this.blinkPoke();
    else if (detail >= 2) this.wave();
    else now(() => this.poke());
  }

  private async menuClick() {
    const menu = this.menu;
    if (!menu) return;
    if (menu.isOpen()) {
      menu.close();
      return;
    }
    if (this.state === "hop" || this.busy()) {
      menu.open();
      return;
    }
    const resting = this.work === "idle" || this.work === "sleep";
    if (this.state === "sleep") {
      this.work = "idle";
      const waking = this.wakeUpQuick();
      const gen = this.gen;
      await waking;
      // Something else came first, like the assistant going off.
      if (gen !== this.gen || !this.assistant) return;
    }
    menu.open();
    if (resting) this.hello();
  }

  // ── On his own ────────────────────────────────────────────────────────────

  private drowsy() {
    return performance.now() - this.lastActivity > PACE.idle * 1000;
  }

  /** Toward the editor while you write, otherwise toward the pointer. */
  private lookTarget() {
    if (performance.now() - this.lastEdit < WATCH_MS) return -7;
    return this.lookAtPointer(0.3);
  }

  /** Toward the pointer, or now and then anywhere. */
  private lookAtPointer(wander: number) {
    if (this.pointerX === null || Math.random() < wander) {
      return (Math.random() * 2 - 1) * 7;
    }
    const rect = this.host.getBoundingClientRect();
    const dx = this.pointerX - (rect.left + STAGE.restX * STAGE.scale);
    return clamp(dx / 30 + (Math.random() - 0.5) * 2, 7);
  }

  private async walkIn(step: Step) {
    const distance = ENTRY_X - STAGE.restX;
    await step(
      Promise.all([
        this.tween({ x: STAGE.restX }, distance * 14, linear),
        this.tween({ faceX: -6 }, 300),
      ]),
    );
    await step(this.tween({ walk: 0 }, 250));
    await step(this.tween({ faceX: 0 }, 300));
    await step(this.plop());
    await step(this.wait(400));
    await this.pullGem(step);
    await step(this.wait(800));
    this.state = "idle";
    this.direct();
  }

  /** Today's loop: sits awhile, lies down, sleeps, wakes. */
  private async onHisOwn(step: Step) {
    this.state = "idle";
    if (this.reduced) {
      await this.settle(step);
      return;
    }
    // Asleep already, he sleeps on; caught half way, he sits up first.
    let asleep = this.pose.lie === 1 && this.host.hasAttribute("data-zz");
    if (!asleep) await this.settle(step);
    for (;;) {
      if (!asleep) {
        await this.sitAwhile(step);
        await this.lieDown(step);
      }
      await this.doze(step, between(PACE.sleep));
      await this.wakeUp(step);
      asleep = false;
    }
  }

  private async turnAround(step: Step, back: boolean, sleepy = false) {
    await step(this.tween({ turn: 0 }, 200, easeIn));
    this.pose.back = back;
    this.pose.faceX = 0;
    if (sleepy) {
      this.pose.eye = 0.25;
      this.pose.mouth = "flat";
    }
    await step(this.tween({ turn: 1 }, 220, easeOut));
  }

  private plop() {
    return Promise.all([
      this.tween({ sit: 1 }, 500),
      this.tween({ squash: 1 }, 220).then(() =>
        this.tween({ squash: 0 }, 420, overshoot),
      ),
    ]);
  }

  private async sitAwhile(step: Step) {
    this.sitting = true;
    try {
      const start = performance.now();
      const until = start + between(PACE.sit);
      // Left alone, he lies down early, but never straight after getting up.
      const restless = () =>
        this.drowsy() && performance.now() - start > PACE.minSit * 1000;
      while (performance.now() < until && !restless()) {
        await step(this.wait(between([4, 10])));
        if (!this.reacting) {
          await step(this.tween({ faceX: this.lookTarget() }, 500));
        }
      }
      while (this.reacting) await step(this.wait(200));
    } finally {
      this.sitting = false;
    }
    await step(this.tween({ faceX: 0 }, 400));
  }

  private async lieDown(step: Step) {
    await step(this.tween({ faceX: -6 }, 350));
    await step(
      Promise.all([
        this.tween({ gemDown: 1 }, 650),
        this.tween({ squash: 0.4 }, 300).then(() =>
          this.tween({ squash: 0 }, 350),
        ),
      ]),
    );
    await step(this.wait(250));
    await step(this.tween({ faceX: 8 }, 400));
    await step(this.wait(300));
    await this.turnAround(step, true);
    await step(this.wait(350));
    await step(
      Promise.all([this.tween({ lie: 1 }, 1100), this.tween({ armsIn: 1 }, 900)]),
    );
    await step(this.tween({ squash: 0.6 }, 160));
    await step(this.tween({ squash: 0 }, 380, overshoot));
    this.breathe(true);
    this.flag("zz", true);
  }

  /** Sleeps for `ms`, or until he's poked. */
  private doze(step: Step, ms: number) {
    let wake = () => {};
    return step(
      new Promise<void>((resolve) => {
        wake = resolve;
        this.wakeEarly = resolve;
        this.later(ms, resolve);
      }),
    ).finally(() => {
      if (this.wakeEarly === wake) this.wakeEarly = null;
    });
  }

  private async wakeUp(step: Step) {
    this.flag("zz", false);
    await step(this.wait(700));
    this.breathe(false);
    await step(this.tween({ lie: 0.93 }, 300));
    await step(this.tween({ lie: 1 }, 300));
    await step(this.wait(400));
    await step(
      Promise.all([this.tween({ lie: 0 }, 900), this.tween({ armsIn: 0 }, 900)]),
    );
    await step(this.wait(300));
    await this.turnAround(step, false, true);
    await step(this.wait(300));
    // A big stretch and a yawn, with both hands free.
    this.pose.mouth = "o";
    await step(
      Promise.all([
        this.tween({ armsUpL: 1, armsUpR: 1 }, 550),
        this.tween({ eye: 0 }, 300),
      ]),
    );
    await step(this.wait(500));
    this.pose.mouth = "flat";
    await step(this.tween({ armsUpL: 0, armsUpR: 0 }, 500));
    await step(this.tween({ eye: 1 }, 250));
    this.setMouth("smile");
    await step(this.tween({ faceX: -6 }, 350));
    await step(this.tween({ gemDown: 0 }, 650));
    await step(this.tween({ faceX: 0 }, 300));
  }

  private poke() {
    if (this.wakeEarly) {
      this.wakeEarly();
      return;
    }
    this.react(async (step) => {
      this.pose.mouth = "o";
      await step(this.tween({ squash: 1, eye: 0.15 }, 110, easeOut));
      await step(this.tween({ squash: 0 }, 420, overshoot));
      await step(this.tween({ eye: 1 }, 160));
      this.setMouth("smile");
    });
  }

  /** With reduced motion, a poke only opens his mouth for a moment. */
  private blinkPoke() {
    this.setMouth("o");
    this.later(600, () => this.setMouth("smile"));
  }

  // He waves with his right hand and keeps the gem in his left.
  private wave() {
    this.react(async (step) => {
      await step(this.tween({ armsUpR: 0.85 }, 320));
      for (const side of [1, -1, 1, -1]) {
        await step(this.tween({ wiggle: side }, 150));
      }
      await step(this.tween({ wiggle: 0 }, 120));
      await step(this.tween({ armsUpR: 0 }, 360));
    });
  }

  // ── As the assistant ──────────────────────────────────────────────────────

  private play(work: Work) {
    this.workWaiting = false;
    if (this.heavy) {
      // Finished, he flexes for the shards he hasn't yet, then ends.
      if (work === "done" && this.flexing) {
        this.heavy.done = true;
        // Still owed if a hop cuts the flexes short.
        this.workWaiting = true;
        return;
      }
      if (work !== "read" && work !== "search") {
        return this.heavyEnd(
          work === "done" ? "done" : work === "shrug" ? "error" : "stop",
        );
      }
      if (this.state !== "heavy") this.bulkUp();
      return;
    }
    switch (work) {
      case "idle":
        return this.idle();
      case "search":
        return this.search();
      case "read":
        return this.read();
      case "done":
        return this.done();
      case "shrug":
        return this.shrug();
      case "sleep":
        return this.sleep();
    }
  }

  /**
   * Back to what's asked of him. A Done or a shrug he was already playing
   * isn't played again.
   */
  private resume() {
    const once = this.work === "done" || this.work === "shrug";
    if (once && !this.workWaiting) this.work = "idle";
    this.play(this.work);
  }

  private async getUp(step: Step) {
    const p = this.pose;
    if (p.lie > 0 || p.back) {
      this.flag("zz", false);
      this.breathe(false);
      await step(this.tween({ lie: 0, armsIn: 0 }, 700));
      await this.turnAround(step, false, true);
      p.mouth = "flat";
      await step(this.tween({ eye: 1 }, 250));
      p.mouth = "smile";
    } else if (p.turn < 1) {
      await step(this.tween({ turn: 1 }, 220, easeOut));
    } else if (p.eye < 1) {
      // Asleep where he sat, with reduced motion.
      this.flag("zz", false);
      p.mouth = "smile";
      await step(this.tween({ eye: 1 }, 250));
    }
  }

  /** Back to sitting with the gem in his lap, from whatever he was doing. */
  private async settle(step: Step) {
    const p = this.pose;
    await this.getUp(step);
    await this.shrinkBack(step);
    if (p.gemHidden) await this.pullGem(step);
    p.mouth = "smile";
    await step(this.tween({ ...NEUTRAL, x: STAGE.restX }, 380));
  }

  // Reaches over his shoulder, rummages, and brings the gem round to his lap.
  // On his own he takes his time over it.
  private async pullGem(step: Step) {
    const slow = !this.assistant;
    const p = this.pose;
    await step(this.tween({ faceX: 6, stow: 1 }, 300));
    await step(this.tween({ armsUpR: 1 }, slow ? 450 : 400));
    if (!this.reduced) {
      for (const side of [1, -1, 1]) {
        await step(this.tween({ wiggle: side * 0.4 }, slow ? 120 : 110));
      }
    }
    await step(this.tween({ wiggle: 0 }, slow ? 100 : 90));
    p.gemHidden = false;
    await step(
      Promise.all([
        this.tween({ armsUpR: 0, stow: 0 }, slow ? 700 : 600),
        this.tween({ faceX: 0 }, slow ? 450 : 420),
      ]),
    );
  }

  private async stowGem(step: Step) {
    await step(this.tween({ faceX: 6 }, 260));
    await step(this.tween({ stow: 1, armsUpR: 1 }, 520));
    this.pose.gemHidden = true;
  }

  /** Glances around, and dozes off when left alone long enough. */
  private idle() {
    this.state = "idle";
    void this.run(async (step) => {
      await this.settle(step);
      const until = performance.now() + DOZE_MS;
      while (performance.now() < until) {
        await step(this.wait(between(GLANCE)));
        if (this.reduced) continue;
        await step(this.tween({ faceX: this.lookAtPointer(0.3) }, 500));
      }
      if (!this.reduced) await this.sleepNow(step);
    });
  }

  private sleep() {
    void this.run(async (step) => {
      await this.settle(step);
      await this.sleepNow(step);
    });
  }

  private async sleepNow(step: Step) {
    this.state = "sleep";
    const p = this.pose;
    if (this.reduced) {
      // His eyes close where he sits, and the z's stand still.
      p.mouth = "flat";
      await step(this.tween({ ...NEUTRAL, eye: 0 }, 0));
      this.flag("zz", true);
      return;
    }
    await step(this.tween({ faceX: -6 }, 350));
    await step(
      Promise.all([
        this.tween({ gemDown: 1 }, 650),
        this.tween({ squash: 0.4 }, 300).then(() =>
          this.tween({ squash: 0 }, 350),
        ),
      ]),
    );
    await step(this.tween({ faceX: 8 }, 400));
    await step(this.wait(300));
    await this.turnAround(step, true);
    await step(this.wait(300));
    await step(
      Promise.all([this.tween({ lie: 1 }, 1100), this.tween({ armsIn: 1 }, 900)]),
    );
    await step(this.tween({ squash: 0.6 }, 160));
    await step(this.tween({ squash: 0 }, 380, overshoot));
    this.breathe(true);
    this.flag("zz", true);
  }

  /** Wakes from a click, quicker than when he wakes on his own. */
  private wakeUpQuick() {
    this.state = "idle";
    return this.run(async (step) => {
      const p = this.pose;
      this.flag("zz", false);
      if (this.reduced) {
        p.mouth = "smile";
        await step(this.tween({ eye: 1 }, 0));
        return;
      }
      await step(this.wait(300));
      this.breathe(false);
      await step(this.tween({ lie: 0.93 }, 260));
      await step(this.tween({ lie: 1 }, 260));
      await step(
        Promise.all([this.tween({ lie: 0 }, 800), this.tween({ armsIn: 0 }, 800)]),
      );
      await this.turnAround(step, false, true);
      p.mouth = "o";
      await step(
        Promise.all([
          this.tween({ armsUpL: 1, armsUpR: 1 }, 500),
          this.tween({ eye: 0 }, 280),
        ]),
      );
      await step(this.wait(350));
      p.mouth = "flat";
      await step(this.tween({ armsUpL: 0, armsUpR: 0 }, 450));
      await step(this.tween({ eye: 1 }, 220));
      p.mouth = "smile";
      await step(this.tween({ faceX: -6 }, 300));
      await step(this.tween({ gemDown: 0 }, 600));
      await step(this.tween({ faceX: 0 }, 280));
    });
  }

  /** Hello: a quick wave with his right hand, the gem kept in his left. */
  private hello() {
    this.state = "hello";
    void this.run(async (step) => {
      await this.settle(step);
      const p = this.pose;
      p.mouth = "grin";
      if (this.reduced) {
        this.render();
        await step(this.wait(500));
      } else {
        await step(this.tween({ armsUpR: 0.85 }, 260));
        for (const s of [1, -1, 1, -1]) {
          await step(this.tween({ wiggle: s }, 130));
        }
        await step(this.tween({ wiggle: 0 }, 110));
        await step(this.tween({ armsUpR: 0 }, 300));
      }
      this.setMouth("smile");
      this.resume();
    });
  }

  /** Searching: rummages behind his back while the vault is searched. */
  private search() {
    this.state = "search";
    void this.run(async (step) => {
      await this.settle(step);
      this.pose.mouth = "flat";
      await this.stowGem(step);
      if (this.reduced) {
        await step(this.tween({ faceX: 6, faceY: -2 }, 0));
        return;
      }
      for (let i = 0; ; i++) {
        await step(this.tween({ faceX: i % 4 < 2 ? 6 : 3, faceY: -2 }, 260));
        for (const s of [1, -1, 1, -1]) {
          await step(
            this.tween({ wiggle: s * 0.5, squash: s > 0 ? 0.15 : 0 }, 140),
          );
        }
        await step(this.wait(160));
      }
    });
  }

  /** Reading: holds the shard up and reads it, eyes moving along lines. */
  private read() {
    this.state = "read";
    void this.run(async (step) => {
      await this.settle(step);
      this.pose.mouth = "o";
      await step(this.tween({ gemUp: 0.75, faceY: 2, nod: 0.4 }, 420));
      if (this.reduced) return;
      for (;;) {
        await step(this.tween({ faceX: -3 }, 120));
        await step(this.tween({ faceX: 3 }, 900, linear));
        await step(this.wait(120));
      }
    });
  }

  /** Done: happy eyes and a nod as the answer lands, then back to idle. */
  private done() {
    this.state = "done";
    void this.run(async (step) => {
      const p = this.pose;
      if (p.gemHidden || p.lie > 0 || p.back || p.eye < 1) {
        await this.settle(step);
      }
      p.mouth = "smile";
      await step(
        this.tween(
          {
            gemUp: 0,
            faceX: 0,
            faceY: 0,
            nod: 0,
            wiggle: 0,
            armsUpR: 0,
            stow: 0,
            tilt: 0,
          },
          320,
        ),
      );
      await step(this.tween({ happy: 1 }, 1, linear));
      await step(this.tween({ nod: 1, squash: 0.25 }, 150));
      await step(this.tween({ nod: 0, squash: 0 }, 300, overshoot));
      await step(this.wait(1400));
      await step(this.tween({ happy: 0 }, 1, linear));
      this.resume();
    });
  }

  /** Something went wrong: sets the shard down and shrugs. */
  private shrug() {
    this.state = "shrug";
    void this.run(async (step) => {
      await this.settle(step);
      const p = this.pose;
      p.mouth = "wobble";
      await step(this.tween({ faceX: -6 }, 260));
      await step(this.tween({ gemDown: 1 }, 520));
      await step(
        this.tween(
          { armsUpL: 0.3, armsUpR: 0.3, faceX: 0, tilt: 1, squash: -0.35 },
          380,
          easeOut,
        ),
      );
      if (!this.reduced) {
        await step(this.tween({ squash: -0.6 }, 160));
        await step(this.tween({ squash: -0.35 }, 300, overshoot));
      }
      await step(this.wait(1800));
      await step(
        this.tween({ armsUpL: 0, armsUpR: 0, tilt: 0, squash: 0 }, 360),
      );
      p.mouth = "flat";
      await step(this.tween({ faceX: -6 }, 260));
      await step(this.tween({ gemDown: 0 }, 520));
      this.resume();
    });
  }

  // ── A change to several shards ────────────────────────────────────────────

  /** He eats his shard, bulks up, and flexes for the shards changed so far. */
  private bulkUp() {
    this.state = "heavy";
    void this.run(async (step) => {
      // Shards changed meanwhile wait for the flexes at the end.
      this.flexing = true;
      await this.settle(step);
      const p = this.pose;
      await step(this.tween({ faceY: 3, gemUp: 0.3 }, 260));
      p.mouth = "big";
      await step(this.tween({ eat: 1, gemUp: 0 }, 420, easeIn));
      p.gemHidden = true;
      p.empty = 1;
      p.mouth = "flat";
      // A gulp.
      await step(this.tween({ squash: 0.6, eye: 0.4 }, 120));
      await step(
        this.tween({ squash: 0, eye: 1, eat: 0, faceY: 0 }, 280, overshoot),
      );
      await step(this.wait(220));
      // His arms and legs swell in two pulses.
      p.mouth = "o";
      await step(this.tween({ bulk: 0.55, squash: -0.3 }, 200, easeOut));
      await step(this.tween({ squash: 0.15 }, 120));
      await step(this.tween({ bulk: MAX_BULK, squash: -0.4 }, 260, easeOut));
      p.mouth = "grin";
      await step(this.tween({ squash: 0 }, 360, overshoot));
      await this.flexAll(step);
    });
  }

  /** Flexes for the shards changed since he last did. */
  private keepFlexing() {
    this.state = "heavy";
    void this.run((step) => this.flexAll(step));
  }

  private async flexAll(step: Step) {
    const gen = this.gen;
    this.flexing = true;
    try {
      while (this.heavy && this.heavy.flexed < this.heavy.changed) {
        await this.flex(step, this.heavy.flexed++);
      }
    } finally {
      // A cancelled run's wait still ends: leave a newer run's flag alone.
      if (gen === this.gen) this.flexing = false;
    }
    if (this.heavy?.done) this.heavyEnd("done");
  }

  private async flex(step: Step, turn: number) {
    const p = this.pose;
    p.mouth = "grin";
    await step(
      this.tween(
        { ...FLEXES[turn % FLEXES.length], flex: 1, squash: 0.35 },
        240,
        easeOut,
      ),
    );
    await step(this.tween({ squash: -0.15 }, 160, easeOut));
    await step(this.tween({ squash: 0 }, 260, overshoot));
    await step(this.wait(380));
    p.mouth = "smile";
    await step(
      this.tween({ armsUpL: 0.08, armsUpR: 0.08, tilt: 0, flex: 0 }, 300),
    );
  }

  /** However it ended, he shrinks back and spits the shard into his hands. */
  private heavyEnd(how: HeavyEnd) {
    this.heavy = null;
    this.state = "heavy";
    void this.run(async (step) => {
      await this.shrinkBack(step);
      if (how === "done") return this.done();
      if (how === "error") return this.shrug();
      this.pose.mouth = "flat";
      await step(this.wait(500));
      this.resume();
    });
  }

  /** Back to his own size with the shard in his hands, if he'd bulked up. */
  private async shrinkBack(step: Step) {
    const p = this.pose;
    if (p.bulk === 0 && p.empty === 0 && p.flex === 0) return;
    await step(
      this.tween(
        { armsUpL: 0, armsUpR: 0, tilt: 0, squash: 0, flex: 0, faceY: 0 },
        220,
      ),
    );
    if (p.bulk > 0) {
      // A quick, wobbly deflate.
      p.mouth = "o";
      await step(this.tween({ bulk: p.bulk * 0.35, squash: 0.4 }, 260, easeIn));
      await step(this.tween({ bulk: 0, squash: -0.3 }, 220, easeOut));
      await step(this.tween({ squash: 0 }, 260, overshoot));
    }
    if (p.empty > 0) await this.spit(step);
  }

  /** He swells his cheeks, then the shard pops out and lands in his hands. */
  private async spit(step: Step) {
    const p = this.pose;
    p.mouth = "big";
    await step(this.tween({ squash: 0.7, eye: 0.3 }, 180, easeOut));
    p.gemHidden = false;
    p.eat = 1;
    p.pop = 0;
    this.render();
    await step(
      Promise.all([
        this.tween({ squash: -0.4 }, 140, easeOut).then(() =>
          this.tween({ squash: 0 }, 380, overshoot),
        ),
        this.tween({ eat: 0, empty: 0 }, 560, easeOut),
        this.tween({ pop: 1 }, 560, linear),
      ]),
    );
    p.pop = 0;
    p.mouth = "smile";
    await step(this.tween({ eye: 1 }, 160));
  }

  // ── Drawing ───────────────────────────────────────────────────────────────
  private render() {
    this.drawing.draw(this.pose, this.hopPoint(), this.hop !== null);
  }
}

/** How long a hop from `from` to `to` is in the air, in ms. */
export function hopFlight(from: Spot, to: Spot) {
  return 300 + Math.min(260, Math.hypot(to.x - from.x, to.y - from.y) * 1.4);
}
