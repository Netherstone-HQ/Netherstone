import { type TCodeBlockElement, NodeApi } from "platejs";

/** A code block's text, one line per code line, indentation kept. */
export function codeBlockText(element: TCodeBlockElement): string {
  return element.children.map((line) => NodeApi.string(line)).join("\n");
}
