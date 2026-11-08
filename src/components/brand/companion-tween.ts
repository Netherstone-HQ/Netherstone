// The companion's animation runtime: tweens his pose values a frame at a
// time, and keeps his timers, so stopping ends all of it at once.

export type Ease = (p: number) => number;
export const linear: Ease = (p) => p;
export const inOut: Ease = (p) =>
  p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
export const easeIn: Ease = (p) => p * p;
export const easeOut: Ease = (p) => 1 - (1 - p) ** 2;
export const overshoot: Ease = (p) =>
  1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;

export const CANCEL = Symbol("cancel");
/** Awaits a move, and ends the sequence if a newer one has started. */
export type Step = <T>(move: Promise<T>) => Promise<T>;

interface Tween<K extends string> {
  from: Partial<Record<K, number>>;
  to: Partial<Record<K, number>>;
  start: number;
  ms: number;
  ease: Ease;
  done: () => void;
}

export class Tweens<K extends string> {
  alive = true;
  private tweens: Tween<K>[] = [];
  private frameId = 0;
  private last = 0;
  private readonly timers = new Set<number>();

  /**
   * `tick` runs after each frame's values are set, with the ms since the
   * last one; `render` draws a pose set straight away.
   */
  constructor(
    private readonly values: Record<K, number>,
    private readonly reduced: boolean,
    private readonly tick: (dt: number) => void,
    private readonly render: () => void,
  ) {}

  stop() {
    this.alive = false;
    this.tweens = [];
    if (this.frameId) cancelAnimationFrame(this.frameId);
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
  }

  later(ms: number, fn: () => void) {
    const id = window.setTimeout(() => {
      this.timers.delete(id);
      if (this.alive) fn();
    }, ms);
    this.timers.add(id);
  }

  wait(ms: number) {
    return new Promise<void>((resolve) => this.later(ms, resolve));
  }

  /** Drops every tween but those moving only `key`. */
  keepOnly(key: K) {
    this.tweens = this.tweens.filter((t) =>
      Object.keys(t.to).every((k) => k === key),
    );
  }

  private frame = (now: number) => {
    this.frameId = 0;
    const dt = Math.min(now - this.last, 64);
    this.last = now;
    const values = this.values;
    this.tweens = this.tweens.filter((t) => {
      const p = Math.min(1, (now - t.start) / t.ms);
      const keys = Object.keys(t.to) as K[];
      for (const key of keys) {
        const from = t.from[key] ?? 0;
        values[key] = from + ((t.to[key] ?? 0) - from) * t.ease(p);
      }
      if (p < 1 && keys.length) return true;
      t.done();
      return false;
    });
    this.tick(dt);
    if (this.tweens.length) this.frameId = requestAnimationFrame(this.frame);
  };

  // Promises from a stopped run never settle, so the sequence just ends.
  // A newer tween takes over any values an older one was still moving.
  // With reduced motion, he goes straight to each pose.
  to(to: Partial<Record<K, number>>, ms: number, ease: Ease = inOut) {
    return new Promise<void>((resolve) => {
      if (!this.alive) return;
      if (this.reduced) {
        Object.assign(this.values, to);
        this.render();
        resolve();
        return;
      }
      const from: Partial<Record<K, number>> = {};
      for (const key of Object.keys(to) as K[]) {
        from[key] = this.values[key];
        for (const t of this.tweens) delete t.to[key];
      }
      this.tweens.push({
        from,
        to,
        start: performance.now(),
        ms,
        ease,
        done: resolve,
      });
      if (!this.frameId) {
        this.last = performance.now();
        this.frameId = requestAnimationFrame(this.frame);
      }
    });
  }
}
