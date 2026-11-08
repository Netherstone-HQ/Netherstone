// Draws the companion: writes a pose to his SVG parts as transforms.

import { MAX_BULK, MOUTHS, type Pose, type Spot, STAGE } from "./companion-pose";

/** Half the body's width, which is how high it sits when lying down. */
const HALF_WIDTH = 40;
/** Where the gem rests while he sleeps, in stage units. */
const GEM_GROUND = { x: STAGE.restX - 60, y: STAGE.ground - 12 };

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
  "happy",
  "mouth",
  "shadow",
  "gem",
  "handL",
  "handR",
] as const;

type Parts = Record<(typeof PARTS)[number], SVGElement>;

/** The limbs that bulk up, each with a plain and a muscled shape. */
const LIMBS = [
  "frontLegL",
  "frontLegR",
  "frontArmL",
  "frontArmR",
  "backArmL",
  "backArmR",
] as const;

type Limb = { plain: SVGElement | null; muscle: SVGElement | null };

/** Past this, a limb shows its muscled shape. */
const BULKED = 0.12;

export class CompanionDrawing {
  readonly parts: Parts;
  private readonly limbs: Record<(typeof LIMBS)[number], Limb>;

  constructor(private readonly host: HTMLElement) {
    this.parts = Object.fromEntries(
      PARTS.map((name) => [
        name,
        host.querySelector<SVGElement>(`[data-part="${name}"]`),
      ]),
    ) as Parts;
    this.limbs = Object.fromEntries(
      LIMBS.map((name) => [
        name,
        {
          plain: this.parts[name].querySelector<SVGElement>("[data-plain]"),
          muscle: this.parts[name].querySelector<SVGElement>("[data-muscle]"),
        },
      ]),
    ) as Record<(typeof LIMBS)[number], Limb>;
  }

  /** Swaps a limb to its muscled shape once he bulks up, mirrored per side. */
  private limb(
    pose: Pose,
    name: (typeof LIMBS)[number],
    side: number,
    width: number,
  ) {
    const { plain, muscle } = this.limbs[name];
    if (!plain || !muscle) return;
    const big = pose.bulk > BULKED;
    // "inherit", so a limb in the hidden back view stays hidden.
    plain.setAttribute("visibility", big ? "hidden" : "inherit");
    muscle.setAttribute("visibility", big ? "inherit" : "hidden");
    if (big) place(muscle, `scale(${side * width} 1)`);
  }

  draw(p: Pose, at: Spot, inAir: boolean) {
    const el = this.parts;
    const { ground, restX, scale } = STAGE;

    this.host.style.transform = `translate(${at.x - restX * scale}px, ${at.y - ground * scale}px)`;

    const w = p.walk;
    const ph = p.phase;
    const b = p.bulk;
    // A heavy pebble waddles: it rocks side to side more than it bounces,
    // and squashes a little each time a foot lands.
    const bob = -Math.abs(Math.sin(ph)) * 3 * w;
    const land = (1 - Math.abs(Math.sin(ph))) * w;

    place(
      el.root,
      `translate(${p.x} ${ground - (HALF_WIDTH + 1) * p.lie}) rotate(${90 * p.lie + Math.sin(ph) * 5 * w}) scale(${p.turn} 1)`,
    );

    const armsUp = (p.armsUpL + p.armsUpR) / 2;
    const sx = 1 + 0.03 * p.sit + 0.07 * p.squash + 0.02 * land + 0.1 * b;
    const sy =
      1 -
      0.05 * p.sit -
      0.09 * p.squash +
      0.06 * armsUp -
      0.03 * p.nod -
      0.03 * land +
      0.03 * b;
    const lift = 8 * p.sit + bob;
    const body = `translate(0 ${lift}) rotate(${p.tilt * 6} 0 -40) scale(${sx} ${sy})`;
    place(el.frontBody, body);
    place(el.backBody, body);

    const down = p.gemDown;
    // Eating, the gem rises to his mouth.
    const raise = p.gemUp + 1.35 * p.eat;
    const muscle = Math.min(b, MAX_BULK) / MAX_BULK;
    const legWidth = 0.55 + 0.7 * muscle;
    const armWidth = (0.5 + 0.75 * muscle) * (1 + 0.18 * p.flex);
    const holds = { L: 0, R: 0 };
    let handAngle = 0;
    for (const [side, s] of [
      ["L", -1],
      ["R", 1],
    ] as const) {
      const up = s < 0 ? p.armsUpL : p.armsUpR;
      const hold = (1 - down) * (1 - up) * (1 - p.stow) * (1 - p.empty);
      holds[side] = hold;
      const swing = Math.sin(ph + (s > 0 ? Math.PI : 0));
      const step = Math.max(0, swing) * 6 * w;
      place(
        el[`frontLeg${side}`],
        `translate(${s * (17 + 4 * p.sit + 5 * b)} ${-22 + 12 * p.sit - step}) rotate(${-swing * 10 * w}) scale(1 ${1 - 0.45 * p.sit + 0.15 * b})`,
      );
      this.limb(p, `frontLeg${side}`, s, legWidth);
      const wiggle = s > 0 ? p.wiggle * 22 : 0;
      const angle =
        -s *
          (12 -
            44 * hold -
            52 * raise * hold +
            150 * up -
            18 * p.armsIn +
            wiggle) +
        Math.sin(ph) * 12 * w * (1 - hold);
      if (s > 0) handAngle = angle;
      const arm = `translate(${s * (30 + 6 * b)} -50) rotate(${angle}) scale(1 ${1 + 0.08 * b})`;
      this.limb(p, `frontArm${side}`, s, armWidth);
      this.limb(p, `backArm${side}`, s, armWidth);
      place(el[`frontArm${side}`], arm);
      place(el[`backArm${side}`], arm);
    }

    // The gem sits in his lap, rises to read, and arcs down to the ground
    // beside him. Coming out of his back, it starts in his right hand.
    const arc = Math.sin(Math.PI * down);
    const rad = (handAngle * Math.PI) / 180;
    const handX = p.x + p.turn * sx * (30 - 26 * Math.sin(rad));
    const handY = ground + lift + sy * (-50 + 26 * Math.cos(rad));
    const lapX = p.x + 2 * sx;
    const lapY = ground + lift - 30 * sy - raise * 21;
    const heldX = lapX + (handX - lapX) * p.stow;
    const heldY = lapY + (handY - lapY) * p.stow;
    const gemX = heldX + (GEM_GROUND.x - heldX) * down;
    // Spat out, it arcs up and spins once on its way back to his hands.
    const gemY =
      heldY +
      (GEM_GROUND.y - heldY) * down -
      arc * 16 -
      Math.sin(Math.PI * p.pop) * 34;
    const gemScale = 1 - 0.62 * p.eat;
    place(
      el.gem,
      `translate(${gemX} ${gemY}) rotate(${-arc * 20 + p.pop * 360}) scale(${gemScale})`,
    );
    show(el.gem, !p.gemHidden);

    for (const [side, s] of [
      ["L", -1],
      ["R", 1],
    ] as const) {
      const hand = el[`hand${side}`];
      place(
        hand,
        `translate(${gemX + s * 13 * Math.max(gemScale, 0.55)} ${gemY + 3})`,
      );
      show(hand, holds[side] > 0.5 && !p.back && !p.gemHidden && p.pop === 0);
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

    place(el.face, `translate(${p.faceX} ${4 * p.nod + p.faceY})`);
    const open = p.eye * p.blink;
    const happy = p.happy > 0.5;
    el.eyeL.setAttribute("ry", String(5.5 * open + 0.8));
    el.eyeR.setAttribute("ry", String(5.5 * open + 0.8));
    show(el.eyeL, !happy);
    show(el.eyeR, !happy);
    show(el.happy, happy);
    show(el.shine, open > 0.6 && !happy);
    const mouth = MOUTHS[p.mouth];
    if (el.mouth.getAttribute("d") !== mouth.d) {
      el.mouth.setAttribute("d", mouth.d);
      el.mouth.style.fill = mouth.fill;
    }

    show(el.front, !p.back);
    show(el.back, p.back);

    // His shadow shrinks while he's in the air.
    const air = inAir ? 1 - 0.4 * Math.sin(Math.PI * p.hopP) : 1;
    el.shadow.setAttribute("cx", String(p.x + 27 * p.lie));
    el.shadow.setAttribute("rx", String((42 + 46 * p.lie + 10 * b) * air));
  }
}

const place = (el: SVGElement, transform: string) =>
  el.setAttribute("transform", transform);
const show = (el: SVGElement, visible: boolean) =>
  el.setAttribute("visibility", visible ? "visible" : "hidden");
