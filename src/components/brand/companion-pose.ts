// What the companion's pose is made of, and the poses he goes back to.

/** Stage size in SVG units; it's drawn at `scale` CSS pixels per unit. */
export const STAGE = {
  width: 440,
  height: 160,
  ground: 150,
  restX: 300,
  scale: 0.6,
} as const;

/** Where his feet are, in viewport pixels. */
export interface Spot {
  x: number;
  y: number;
}

export const MOUTHS = {
  smile: { d: "M-2,-60Q2,-56 6,-60", fill: "none" },
  o: {
    d: "M-0.6,-59.5a2.6,3 0 1,0 5.2,0a2.6,3 0 1,0-5.2,0Z",
    fill: "var(--companion-ink)",
  },
  flat: { d: "M-1,-59Q2,-58.4 5,-59", fill: "none" },
  /** Wide open, to eat his shard or spit it out. */
  big: {
    d: "M-3.5,-59.5a5.5,6 0 1,0 11,0a5.5,6 0 1,0-11,0Z",
    fill: "var(--companion-ink)",
  },
  /** Unsure, for a shrug. */
  wobble: { d: "M-2,-58.8q1.5,-1.8 3,0t3,0", fill: "none" },
  grin: { d: "M-3,-60.5Q2,-54.5 7,-60.5Z", fill: "var(--companion-ink)" },
};
export type Mouth = keyof typeof MOUTHS;

export interface Pose {
  x: number;
  walk: number;
  phase: number;
  sit: number;
  squash: number;
  lie: number;
  /** Horizontal scale while turning around; 0 is edge-on. */
  turn: number;
  faceX: number;
  faceY: number;
  eye: number;
  blink: number;
  /** Closed, happy eyes once past 0.5. */
  happy: number;
  armsUpL: number;
  armsUpR: number;
  armsIn: number;
  /** The raised right arm swinging side to side, from -1 to 1. */
  wiggle: number;
  nod: number;
  /** Leaning sideways, from -1 to 1. */
  tilt: number;
  /** 0 holds the gem in his lap, 1 has it on the ground beside him. */
  gemDown: number;
  /** Holding the gem up to read it. */
  gemUp: number;
  /** 1 keeps the gem in his back; on the way out it rides in his right hand. */
  stow: number;
  /** How far along a hop is, from 0 to 1. */
  hopP: number;
  /** How muscled his arms and legs are, up to 1.3. */
  bulk: number;
  /** The gem on its way into his mouth, shrinking as it goes. */
  eat: number;
  /** The gem popping out of his mouth, spinning, from 0 to 1. */
  pop: number;
  /** Flexing, which widens his arms. */
  flex: number;
  /** 1 while the gem is in his tummy and his hands are free. */
  empty: number;
  gemHidden: boolean;
  /** Showing the back view. */
  back: boolean;
  mouth: Mouth;
}

export type Animatable = Exclude<
  keyof Pose,
  "back" | "phase" | "mouth" | "gemHidden"
>;
export type Target = Partial<Record<Animatable, number>>;

/** Sitting still with the gem in his lap. */
export const NEUTRAL: Target = {
  sit: 1,
  turn: 1,
  walk: 0,
  squash: 0,
  lie: 0,
  faceX: 0,
  faceY: 0,
  eye: 1,
  happy: 0,
  armsUpL: 0,
  armsUpR: 0,
  armsIn: 0,
  wiggle: 0,
  nod: 0,
  tilt: 0,
  gemDown: 0,
  gemUp: 0,
  stow: 0,
  bulk: 0,
  eat: 0,
  pop: 0,
  flex: 0,
};

/** The most muscled he gets. */
export const MAX_BULK = 1.3;

/**
 * His flexes, in turn: double biceps, then his left arm leaning left, then
 * his right arm leaning right.
 */
export const FLEXES: Target[] = [
  { armsUpL: 0.74, armsUpR: 0.74, tilt: 0 },
  { armsUpL: 0.74, armsUpR: 0.1, tilt: -0.5 },
  { armsUpL: 0.1, armsUpR: 0.74, tilt: 0.5 },
];
