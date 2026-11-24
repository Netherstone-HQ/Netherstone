import { IS_MOBILE } from "@/lib/platform";

/**
 * The widest screen, in CSS px, that still gets the phone layout. Wider
 * screens (tablets) keep the desktop layout.
 */
const PHONE_MAX_WIDTH = 600;

/**
 * Whether this device gets the phone layout, decided once at startup from
 * the screen's short side, so turning the phone doesn't swap layouts.
 */
export const IS_PHONE =
  IS_MOBILE &&
  typeof screen !== "undefined" &&
  Math.min(screen.width, screen.height) < PHONE_MAX_WIDTH;
