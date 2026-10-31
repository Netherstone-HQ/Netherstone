/** The code block language whose code is drawn as a diagram. */
export const DIAGRAM_LANG = "mermaid";

/** The code a new diagram starts with, so it draws right away. */
export const DIAGRAM_STARTER = "flowchart LR\n  A --> B";

let nextId = 0;

/** How a diagram block shows: its code, its diagram, or both. */
export type DiagramView = "code" | "both" | "diagram";

/** Ids of diagram blocks just added, which open showing both. */
const newDiagrams = new Set<string>();

/** Notes the block `id` as a diagram just added. */
export function markNewDiagram(id: string) {
  newDiagrams.add(id);
}

/**
 * How the diagram block `id` shows when it appears: both for one just
 * added, so its code can be typed with the diagram drawn under it, and the
 * diagram alone for any other.
 */
export function takeFirstView(id: string | undefined): DiagramView {
  return id !== undefined && newDiagrams.delete(id) ? "both" : "diagram";
}

/** The settings Mermaid was last given, so it's only set up again when they change. */
let lastConfig: string | undefined;

/** Reads a color token of the current theme, as set in App.css. */
const token = (styles: CSSStyleDeclaration, name: string) =>
  styles.getPropertyValue(`--${name}`).trim();

/**
 * Draws Mermaid code as an SVG string in the app's current colors. Mermaid
 * is loaded on the first diagram, so shards without one never pay for it.
 * A diagram that sets its own theme in its code keeps it.
 */
export async function renderDiagram(code: string, dark: boolean) {
  const { default: mermaid } = await import("mermaid");
  const styles = getComputedStyle(document.documentElement);

  const config = {
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    fontFamily: "inherit",
    themeVariables: {
      darkMode: dark,
      background: token(styles, "background"),
      primaryColor: token(styles, "muted"),
      primaryTextColor: token(styles, "foreground"),
      primaryBorderColor: token(styles, "muted-foreground"),
      lineColor: token(styles, "muted-foreground"),
      textColor: token(styles, "foreground"),
      edgeLabelBackground: token(styles, "muted"),
    },
  } as const;
  const key = JSON.stringify(config);
  if (key !== lastConfig) {
    mermaid.initialize(config);
    lastConfig = key;
  }

  // Checked first, so a mistake throws here instead of drawing Mermaid's
  // error picture.
  await mermaid.parse(code);
  nextId += 1;
  const { svg } = await mermaid.render(`diagram-${nextId}`, code);
  return svg;
}
