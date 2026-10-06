import { all, createLowlight } from "lowlight";

import type { CodeToken } from "./model";
import { CODE_TOKEN_STYLES } from "./theme";

type HastNode =
  | { type: "text"; value: string }
  | {
      type: "element";
      properties?: { className?: string[] };
      children: HastNode[];
    }
  | { type: "root"; children: HastNode[] };

let lowlight: ReturnType<typeof createLowlight> | null = null;

function getLowlight() {
  lowlight ??= createLowlight(all);
  return lowlight;
}

/** `hljs-title function_` → `title.function_` */
function scopeFromClasses(classNames: string[] | undefined): string | undefined {
  if (!classNames?.length) return undefined;
  const parts = classNames.map((name) => name.replace(/^hljs-/, ""));
  return parts.join(".");
}

function styleFor(scopes: string[]) {
  // The innermost scope that has a style wins, like CSS specificity in the
  // editor; `title.function_` falls back to `title`.
  for (let index = scopes.length - 1; index >= 0; index -= 1) {
    const scope = scopes[index];
    const style = CODE_TOKEN_STYLES[scope] ?? CODE_TOKEN_STYLES[scope.split(".")[0]];
    if (style) return { scope, ...style };
  }
  return null;
}

/**
 * Splits code into lines of colored tokens with the editor's highlighting.
 * Unknown languages come back as plain text.
 */
export function highlightCode(code: string, language: string): CodeToken[][] {
  const lines: CodeToken[][] = [[]];
  const engine = getLowlight();

  const push = (text: string, scopes: string[]) => {
    const style = styleFor(scopes);
    text.split("\n").forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (!part) return;
      const line = lines[lines.length - 1];
      const previous = line[line.length - 1];
      const token: CodeToken = style
        ? { text: part, scope: style.scope, color: style.color, bold: style.bold, italic: style.italic }
        : { text: part };

      if (
        previous &&
        previous.scope === token.scope &&
        previous.color === token.color &&
        previous.bold === token.bold &&
        previous.italic === token.italic
      ) {
        previous.text += part;
      } else {
        line.push(token);
      }
    });
  };

  const visit = (node: HastNode, scopes: string[]) => {
    if (node.type === "text") {
      push(node.value, scopes);
      return;
    }
    const scope = node.type === "element" ? scopeFromClasses(node.properties?.className) : undefined;
    const nextScopes = scope ? [...scopes, scope] : scopes;
    node.children.forEach((child) => visit(child, nextScopes));
  };

  const normalized = code.replace(/\r\n?/g, "\n");
  if (language && engine.registered(language)) {
    try {
      visit(engine.highlight(language, normalized) as HastNode, []);
      return lines;
    } catch {
      // Fall through to plain text.
      lines.splice(0, lines.length, []);
    }
  }

  push(normalized, []);
  return lines;
}
