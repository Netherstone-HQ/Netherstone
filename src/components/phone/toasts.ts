import { toast } from "sonner";
import { errorText } from "@/lib/utils";

/** How long a toast offering Undo stays, in ms. */
export const UNDO_TOAST_MS = 8000;

/** Shows that `what` failed, and why. */
export function reportFailure(what: string, error: unknown) {
  toast.error(what, { description: errorText(error) });
}
