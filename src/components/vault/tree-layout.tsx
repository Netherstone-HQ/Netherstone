// Shared geometry for rows in the vault tree.

export const MAX_INDENT_DEPTH = 6;
const INDENT_STEP_PX = 16;
const BASE_INDENT_PX = 6;
export const DISCLOSURE_SLOT_PX = 16;
export const FILE_DISCLOSURE_SLOT_PX = 12;
export const ACTION_SLOT_PX = 24;

export function getRowIndent(depth: number) {
  return BASE_INDENT_PX + depth * INDENT_STEP_PX;
}

export function getGuideLeft(depth: number) {
  return getRowIndent(depth) + DISCLOSURE_SLOT_PX / 2;
}

/** The indent guides of a row's ancestors. */
export function TreeGuides({ depth }: { depth: number }) {
  return Array.from({ length: Math.min(depth, MAX_INDENT_DEPTH) }, (_, i) => (
    <div
      key={i}
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 w-px bg-sidebar-border/40"
      style={{ left: `${getGuideLeft(i)}px` }}
    />
  ));
}
