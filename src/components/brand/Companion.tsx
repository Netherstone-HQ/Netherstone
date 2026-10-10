import { useEffect, useRef } from "react";

import { runCompanion, STAGE } from "@/components/brand/companion-motion";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCompanionStore } from "@/store/companion";

const INK = "#2B2733";
const SHADE = "#ECE9F2";
const BLUSH = "#F6B7C1";

const FRONT =
  "M-34,-40L-34,-72C-34,-92-19,-106 0,-106C19,-106 34,-92 34,-72L34,-40C34,-18 22,-10 0,-10C-22,-10-34,-18-34,-40Z";
const BACK =
  "M-34,-40L-34,-72C-34,-92-19,-106 0,-106C19,-106 34,-92 34,-72L34,-40C34,-24 29,-14 21,-10C16,-5 5,-5 0,-11C-5,-5-16,-5-21,-10C-29,-14-34,-24-34,-40Z";

// Outlines keep one width however the limbs stretch.
const OUTLINE = {
  stroke: INK,
  strokeWidth: 1.6,
  strokeLinejoin: "round",
  strokeLinecap: "round",
  vectorEffect: "non-scaling-stroke",
} as const;

const Leg = () => (
  <rect x={-9} y={-6} width={18} height={28} rx={9} fill="#fff" {...OUTLINE} />
);
const Arm = () => (
  <rect x={-8} y={-4} width={16} height={34} rx={8} fill="#fff" {...OUTLINE} />
);

export function Companion() {
  const visible = useCompanionStore((s) => s.visible);
  return visible ? <CompanionStage /> : null;
}

function CompanionStage() {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    return runCompanion(host, { reducedMotion });
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
            rx={36}
            ry={4.5}
            className="fill-foreground/10"
          />
          <Tooltip delayDuration={1200}>
            <TooltipTrigger asChild>
              <g data-part="root" className="pointer-events-auto">
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
                    <path d={FRONT} fill="#fff" />
                    <g clipPath="url(#companion-front-clip)">
                      <ellipse cx={48} cy={-58} rx={24} ry={70} fill={SHADE} />
                      <ellipse cx={0} cy={-3} rx={44} ry={11} fill={SHADE} />
                    </g>
                    <path d={FRONT} fill="none" {...OUTLINE} />
                    <g data-part="face">
                      <ellipse cx={-21} cy={-67} rx={6} ry={3.5} fill={BLUSH} opacity={0.7} />
                      <ellipse cx={21} cy={-67} rx={6} ry={3.5} fill={BLUSH} opacity={0.7} />
                      <ellipse data-part="eyeL" cx={-12} cy={-78} rx={4} ry={6.3} fill={INK} />
                      <ellipse data-part="eyeR" cx={12} cy={-78} rx={4} ry={6.3} fill={INK} />
                      <g data-part="shine">
                        <circle cx={-13.3} cy={-80.3} r={1.5} fill="#fff" />
                        <circle cx={10.7} cy={-80.3} r={1.5} fill="#fff" />
                      </g>
                      <path d="M-4,-67Q0,-63 4,-67" fill="none" {...OUTLINE} strokeWidth={1.3} />
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
                    <path d={BACK} fill="#fff" />
                    <g clipPath="url(#companion-back-clip)">
                      <ellipse cx={48} cy={-58} rx={24} ry={70} fill={SHADE} />
                      <ellipse cx={-10} cy={-7} rx={9} ry={5} fill={SHADE} />
                      <ellipse cx={10} cy={-7} rx={9} ry={5} fill={SHADE} />
                    </g>
                    <path d={BACK} fill="none" {...OUTLINE} />
                    <path d="M0,-11Q-1,-16 1,-21" fill="none" {...OUTLINE} strokeWidth={1.3} />
                  </g>
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
            className="companion-z font-medium text-muted-foreground text-xs"
            style={{
              left: (restX + 100) * scale + i * 3,
              top: (ground - 84) * scale,
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
