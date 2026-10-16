import { createLucideIcon } from "lucide-react";

// Icons Lucide doesn't ship, drawn on its 24px grid so they take the same
// size, colour and stroke props as every other icon in the app.

/** A drawing (Excalidraw canvas): one hand-drawn squiggle. */
export const DrawingIcon = createLucideIcon("drawing", [
  [
    "path",
    {
      d: "M3 17c2.5-5 5-9 7-8.5s-2.5 7.5-.5 8.5 4-6 6.5-6-1 5 1 5.5 3-2.5 3-2.5",
      key: "drawing",
    },
  ],
]);

/** GitHub's mark, outlined. Lucide dropped brand icons in 1.0. */
export const GitHubIcon = createLucideIcon("github", [
  [
    "path",
    {
      d: "M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4",
      key: "body",
    },
  ],
  ["path", { d: "M9 18c-4.51 2-5-2-7-2", key: "tail" }],
]);
