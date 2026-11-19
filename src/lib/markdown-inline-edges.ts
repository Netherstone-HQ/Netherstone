import type { SlateEditor, TElement } from "platejs";

type Node = { text?: unknown; children?: unknown[] };

const isElement = (node: unknown): node is TElement =>
  !!node && Array.isArray((node as Node).children);

const isText = (node: unknown) => !!node && typeof (node as Node).text === "string";

/**
 * Slate keeps a text on both sides of every inline (an equation, a date, an
 * @ link), so the caret has somewhere to go there. Typing keeps that, but a
 * line read from Markdown that starts or ends with one has nothing on that
 * side, and the caret can't get before or after it. This adds the missing
 * empty texts, in one pass over the value.
 */
export function withTextAroundInlines<T>(editor: SlateEditor, value: T[]): T[] {
  const isInline = (node: unknown) => isElement(node) && editor.api.isInline(node);

  const visit = (nodes: unknown[]): unknown[] | null => {
    let next: unknown[] | null = null;

    nodes.forEach((node, index) => {
      const children = isElement(node) ? visit(node.children) : null;
      const current = children ? { ...(node as TElement), children } : node;
      const missingBefore = isInline(node) && !isText(nodes[index - 1]);

      if (next || children || missingBefore) {
        next ??= nodes.slice(0, index);
        if (missingBefore) next.push({ text: "" });
        next.push(current);
      }
    });

    if (isInline(nodes[nodes.length - 1])) {
      next ??= [...nodes];
      next.push({ text: "" });
    }
    return next;
  };

  return (visit(value) as T[] | null) ?? value;
}
