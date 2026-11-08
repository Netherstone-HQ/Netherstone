/**
 * Shows streamed text at a steady pace, whatever bursts it arrives in:
 * from the first character, a little each frame, faster as more waits, so
 * it never falls far behind and never lands in one block.
 */

/** Characters a second when little is waiting. */
const STEADY_RATE = 120;
/** Seconds it takes to catch up on what's waiting, on top of the steady rate. */
const CATCH_UP = 0.8;
/** A frame's length, for the first frame, which has no previous one. */
const FRAME_MS = 1000 / 60;

export class TextPacer {
  private waiting = "";
  /** Characters owed but not shown yet, below one. */
  private carry = 0;
  private frame: number | null = null;
  private last: number | null = null;
  private waiters: (() => void)[] = [];

  constructor(private readonly show: (text: string) => void) {}

  push(text: string) {
    this.waiting += text;
    // A hidden window gets no frames: it shows at once.
    if (document.hidden) {
      this.flush();
    } else if (this.frame === null) {
      this.frame = requestAnimationFrame(this.step);
      document.addEventListener("visibilitychange", this.onHidden);
    }
  }

  /** Shows all that's waiting now. */
  flush() {
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null;
    document.removeEventListener("visibilitychange", this.onHidden);
    this.last = null;
    this.carry = 0;
    const text = this.waiting;
    this.waiting = "";
    if (text) this.show(text);
    for (const resolve of this.waiters.splice(0)) resolve();
  }

  /** Resolves once everything pushed is shown. */
  whenShown(): Promise<void> {
    if (!this.waiting || document.hidden) {
      this.flush();
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  private onHidden = () => {
    if (document.hidden) this.flush();
  };

  private step = (now: number) => {
    const seconds = (this.last === null ? FRAME_MS : now - this.last) / 1000;
    this.last = now;
    const rate = STEADY_RATE + this.waiting.length / CATCH_UP;
    const owed = rate * seconds + this.carry;
    let count = Math.floor(owed);
    this.carry = owed - count;
    // Never splits a character made of two code units.
    if (count > 0 && isHighSurrogate(this.waiting.charCodeAt(count - 1))) count += 1;
    if (count >= this.waiting.length) {
      this.flush();
      return;
    }
    if (count > 0) {
      const text = this.waiting.slice(0, count);
      this.waiting = this.waiting.slice(count);
      this.show(text);
    }
    this.frame = requestAnimationFrame(this.step);
  };
}

function isHighSurrogate(code: number) {
  return code >= 0xd800 && code <= 0xdbff;
}
