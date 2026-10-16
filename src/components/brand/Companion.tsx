import { useEffect, useRef } from "react";

import { runCompanion, STAGE } from "@/components/brand/companion-motion";
import {
  BRAND,
  FACET,
  LEFT,
  RIGHT,
  SILHOUETTE,
  TOP,
} from "@/components/brand/NetherstoneMark";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useEditorStore } from "@/store";

// Colors come from App.css so the dark themes can soften him.
const FILL = { fill: "var(--companion-fill)" };
const SHADE = { fill: "var(--companion-shade)" };
const INK = { fill: "var(--companion-ink)" };

const FRONT =
  "M-40,-46C-42,-72-24,-96 3,-96C28,-96 42,-74 39,-48C37,-22 22,-10 0,-10C-24,-10-38,-22-40,-46Z";
// The front mirrored, with a lobe on each side of the crease.
const BACK =
  "M40,-46C42,-72 24,-96-3,-96C-28,-96-42,-74-39,-48C-38,-30-33,-16-23,-10C-18,-4-6,-4 0,-11C6,-3 19,-3 24,-9C34,-16 39,-28 40,-46Z";

// Outlines keep one width however the limbs stretch.
const OUTLINE = {
  stroke: "var(--companion-ink)",
  strokeWidth: 1.6,
  strokeLinejoin: "round",
  strokeLinecap: "round",
  vectorEffect: "non-scaling-stroke",
} as const;

const Leg = () => (
  <rect x={-9} y={-6} width={18} height={28} rx={9} style={{ ...FILL, ...OUTLINE }} />
);
const Arm = () => (
  <rect x={-7} y={-4} width={14} height={36} rx={7} style={{ ...FILL, ...OUTLINE }} />
);
const Hand = () => <circle r={5.5} style={{ ...FILL, ...OUTLINE }} />;

/** The Netherstone mark, about 23 units across and centered on its origin. */
const Gem = () => (
  <g transform="scale(0.5) translate(-32 -32)">
    <path d={SILHOUETTE} fill={BRAND.left} />
    <path d={LEFT} fill={BRAND.left} />
    <path d={RIGHT} fill={BRAND.right} />
    <path d={TOP} fill={BRAND.top} />
    <path d={FACET} fill={BRAND.facet} />
    <path d={SILHOUETTE} style={{ ...OUTLINE, fill: "none" }} />
  </g>
);

export function Companion() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const companion = runCompanion(host, { reducedMotion });
    const unsubscribe = useEditorStore.subscribe((state, prev) => {
      if (state.editTick !== prev.editTick) companion.noticeEdit();
      if (prev.isSaving && !state.isSaving && !state.isDirty) companion.nod();
    });
    return () => {
      unsubscribe();
      companion.stop();
    };
  }, []);

  const { width, height, ground, restX, scale } = STAGE;

  return (
    // Sits under dialogs and toasts, and only his own shapes take the pointer.
    <div
      ref={hostRef}
      className="companion pointer-events-none fixed right-3 bottom-0 z-40"
      style={{ width: width * scale, height: height * scale }}
    >
      <div
        className="companion-body"
        style={{
          transformOrigin: `${restX * scale}px ${ground * scale}px`,
        }}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          width={width * scale}
          height={height * scale}
          className="overflow-visible"
          aria-hidden="true"
        >
          <defs>
            <clipPath id="companion-front-clip">
              <path d={FRONT} />
            </clipPath>
            <clipPath id="companion-back-clip">
              <path d={BACK} />
            </clipPath>
          </defs>
          <ellipse
            data-part="shadow"
            cx={restX}
            cy={ground + 1}
            rx={42}
            ry={4.5}
            className="fill-foreground/10"
          />
          <Tooltip delayDuration={1200}>
            <TooltipTrigger asChild>
              <g data-part="hit" className="companion-hit pointer-events-auto">
                <g data-part="root">
                  <g data-part="front">
                    <g data-part="frontLegL">
                      <Leg />
                    </g>
                    <g data-part="frontLegR">
                      <Leg />
                    </g>
                    <g data-part="frontBody">
                      <g data-part="frontArmL">
                        <Arm />
                      </g>
                      <g data-part="frontArmR">
                        <Arm />
                      </g>
                      <path d={FRONT} style={FILL} />
                      <g clipPath="url(#companion-front-clip)">
                        <ellipse cx={54} cy={-54} rx={24} ry={64} style={SHADE} />
                        <ellipse cx={0} cy={-2} rx={50} ry={11} style={SHADE} />
                      </g>
                      <path d={FRONT} style={{ ...OUTLINE, fill: "none" }} />
                      <g data-part="face">
                        <g className="companion-blush">
                          <ellipse cx={-22} cy={-60} rx={6} ry={3.5} />
                          <ellipse cx={24} cy={-60} rx={6} ry={3.5} />
                        </g>
                        <ellipse data-part="eyeL" cx={-11} cy={-71} rx={4} ry={6.3} style={INK} />
                        <ellipse data-part="eyeR" cx={14} cy={-71} rx={4} ry={6.3} style={INK} />
                        <g data-part="shine">
                          <circle cx={-12.3} cy={-73.3} r={1.5} style={FILL} />
                          <circle cx={12.7} cy={-73.3} r={1.5} style={FILL} />
                        </g>
                        <path data-part="mouth" style={{ ...OUTLINE, strokeWidth: 1.3 }} />
                      </g>
                    </g>
                  </g>
                  <g data-part="back" visibility="hidden">
                    <g data-part="backLegR">
                      <Leg />
                    </g>
                    <g data-part="backLegL">
                      <Leg />
                    </g>
                    <g data-part="backBody">
                      <g data-part="backArmL">
                        <Arm />
                      </g>
                      <g data-part="backArmR">
                        <Arm />
                      </g>
                      <path d={BACK} style={FILL} />
                      <g clipPath="url(#companion-back-clip)">
                        <ellipse cx={54} cy={-54} rx={24} ry={64} style={SHADE} />
                        <ellipse cx={-12} cy={-6} rx={9} ry={5} style={SHADE} />
                        <ellipse cx={12} cy={-5} rx={9} ry={5} style={SHADE} />
                      </g>
                      <path d={BACK} style={{ ...OUTLINE, fill: "none" }} />
                      <path d="M0,-11Q-1,-16 1,-21" style={{ ...OUTLINE, strokeWidth: 1.3, fill: "none" }} />
                    </g>
                  </g>
                </g>
                <g data-part="gem">
                  <Gem />
                </g>
                <g data-part="handL">
                  <Hand />
                </g>
                <g data-part="handR">
                  <Hand />
                </g>
              </g>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              Kevin
            </TooltipContent>
          </Tooltip>
        </svg>
      </div>
      <div className="companion-zs" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="companion-z font-medium text-muted-foreground text-ui-sm"
            style={{
              left: (restX + 92) * scale + i * 3,
              top: (ground - 80) * scale,
              animationDelay: `${-i * 1.15}s`,
            }}
          >
            z
          </span>
        ))}
      </div>
    </div>
  );
}
