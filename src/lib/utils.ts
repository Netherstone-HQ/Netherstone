import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The interface scale in App.css (@theme). Without these, tailwind-merge reads
// text-ui-sm as a colour and drops it when a text colour class follows.
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["ui", "ui-sm"],
      spacing: ["icon", "control", "row", "header"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
