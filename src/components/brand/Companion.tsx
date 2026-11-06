import { useEffect, useRef, useState } from "react";
import {
  EyeOffIcon,
  Link2Icon,
  MessageSquareIcon,
  NewspaperIcon,
  PanelRightIcon,
} from "lucide-react";

import { setupState, useSetup } from "@/components/assistant/setup";
import {
  CompanionRig,
  type CompanionMenu,
  type Spot,
  STAGE,
} from "@/components/brand/companion-motion";
import { chatWork, inlineWork } from "@/components/brand/companion-work";
import {
  BRAND,
  FACET,
  LEFT,
  RIGHT,
  SILHOUETTE,
  TOP,
} from "@/components/brand/NetherstoneMark";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { openAssistant, sendMessage } from "@/lib/assistant";
import { openShardPath } from "@/lib/assistant-changes";
import { useEditorStore } from "@/store";
import { useAssistantStore } from "@/store/assistant";
import { useCompanionStore } from "@/store/companion";
import { useInlineAskStore } from "@/store/inline-ask";
import { useSettingsStore } from "@/store/settings";
import { useVaultStore } from "@/store/vault";

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

/** Where his feet go on the composer card: on its top edge, near the right. */
function perchSpot(card: HTMLElement): Spot {
  const rect = card.getBoundingClientRect();
  return { x: rect.right - 52, y: rect.top + 1 };
}

/** His corner, at the bottom right of the window. */
function homeSpot(): Spot {
  const { width, height, ground, restX, scale } = STAGE;
  return {
    x: window.innerWidth - 12 - (width - restX) * scale,
    y: window.innerHeight - (height - ground) * scale,
  };
}

export function Companion() {
  const hostRef = useRef<HTMLDivElement>(null);
  const hitRef = useRef<SVGGElement>(null);
  const rigRef = useRef<CompanionRig | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(false);
  const [tipOpen, setTipOpen] = useState(false);
  const setMenu = (open: boolean) => {
    menuOpenRef.current = open;
    setMenuOpen(open);
  };
  const menu = useRef<CompanionMenu>({
    isOpen: () => menuOpenRef.current,
    open: () => setMenu(true),
    close: () => setMenu(false),
  }).current;

  // He's the assistant only while it's on.
  const assistant = useAssistantStore((s) => s.enabled === true);
  const perch = useCompanionStore((s) => s.perch);
  const { setup } = useSetup(assistant);
  const noProvider = assistant && setupState(setup) === "noProvider";

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const rig = new CompanionRig(host, { reducedMotion, home: homeSpot });
    rigRef.current = rig;
    const onResize = () => rig.relocate();
    window.addEventListener("resize", onResize);
    const unsubscribe = [
      useEditorStore.subscribe((state, prev) => {
        if (state.editTick !== prev.editTick) rig.noticeEdit();
        if (prev.isSaving && !state.isSaving && !state.isDirty) rig.nod();
      }),
      useAssistantStore.subscribe((state, prev) => {
        const work = chatWork(prev, state);
        if (work) rig.setWork(work);
      }),
      useInlineAskStore.subscribe((state, prev) => {
        const work = inlineWork(prev.phase, state.phase);
        if (work) rig.setWork(work);
      }),
    ];
    return () => {
      for (const stop of unsubscribe) stop();
      window.removeEventListener("resize", onResize);
      rig.stop();
      rigRef.current = null;
      useCompanionStore.setState({ perched: false });
    };
  }, []);

  // As the assistant he sits on the panel's composer while it's open.
  useEffect(() => {
    const rig = rigRef.current;
    if (!rig) return;
    rig.setAssistant(assistant, menu);
    if (!assistant) setMenu(false);
    const card = assistant ? perch : null;
    rig.setSpot(card ? () => perchSpot(card) : null);
    useCompanionStore.setState({ perched: card !== null });
    if (!card) return;
    const observer = new ResizeObserver(() => rig.relocate());
    observer.observe(card);
    return () => observer.disconnect();
  }, [assistant, perch, menu]);

  // With no provider set up, he sleeps until there is one.
  useEffect(() => {
    if (noProvider) rigRef.current?.setWork("sleep");
    else rigRef.current?.wakeFromSleep();
  }, [noProvider]);

  const choose = (item: "ask" | "summarize" | "related" | "chat") => {
    openAssistant();
    if (item === "ask") {
      useAssistantStore.setState({ focusComposer: true });
      return;
    }
    if (item === "chat") return;
    const shard = openShardPath(
      useVaultStore.getState().currentVaultPath,
      useEditorStore.getState().currentFilePath,
    );
    if (!shard || setupState(setup) !== "ready") return;
    const text =
      item === "summarize" ? "Summarize this shard" : "Find related shards";
    void sendMessage(text, [shard]);
  };

  const hide = () =>
    rigRef.current?.leave(() =>
      useSettingsStore.getState().setPreference("showCompanion", false),
    );

  const { width, height, ground, restX, scale } = STAGE;

  return (
    // Sits under dialogs and toasts, and only his own shapes take the pointer.
    <div
      ref={hostRef}
      className="companion pointer-events-none fixed top-0 left-0 z-40"
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
          <Tooltip
            delayDuration={1200}
            open={tipOpen && !menuOpen}
            onOpenChange={setTipOpen}
          >
            <TooltipTrigger asChild>
              <g
                ref={hitRef}
                data-part="hit"
                className="companion-hit pointer-events-auto"
              >
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
                        <path
                          data-part="happy"
                          d="M-15,-70q4,-5.5 8,0M10,-70q4,-5.5 8,0"
                          visibility="hidden"
                          style={{ ...OUTLINE, fill: "none", strokeWidth: 2 }}
                        />
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
      {/* His menu opens above him, its right edge lined up with his. */}
      <DropdownMenu open={menuOpen} onOpenChange={setMenu}>
        <DropdownMenuTrigger asChild>
          <span
            aria-hidden="true"
            tabIndex={-1}
            className="absolute size-0"
            style={{ left: restX * scale + 34, top: ground * scale - 66 }}
          />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="end"
          sideOffset={0}
          collisionPadding={8}
          aria-label="Kevin"
          className="companion-menu w-54"
          onInteractOutside={(event) => {
            // A click on him closes the menu himself.
            if (hitRef.current?.contains(event.target as Node)) {
              event.preventDefault();
            }
          }}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          <DropdownMenuItem onSelect={() => choose("ask")}>
            <MessageSquareIcon />
            Ask about this shard
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => choose("summarize")}>
            <NewspaperIcon />
            Summarize this shard
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => choose("related")}>
            <Link2Icon />
            Find related shards
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => choose("chat")}>
            <PanelRightIcon />
            Open chat
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={hide}>
            <EyeOffIcon />
            Hide Kevin
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
