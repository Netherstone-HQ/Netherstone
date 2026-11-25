import { IS_MOBILE } from "@/lib/platform";

/** The widest screen, in CSS px, that gets the phone layout. */
const PHONE_MAX_WIDTH = 600;

/** Decided once from the screen's short side, so turning the phone keeps the layout. */
export const IS_PHONE =
  IS_MOBILE &&
  typeof screen !== "undefined" &&
  Math.min(screen.width, screen.height) < PHONE_MAX_WIDTH;
