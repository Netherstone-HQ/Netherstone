type MdastNode = { type: string; value?: string; children?: MdastNode[] };

/**
 * remark-mdx parses `{...}` in prose as a JS expression, which Plate then
 * drops. Vault notes are plain markdown, so turn those expressions back into
 * the literal text the user wrote. Must run after `remarkMdx`.
 */
export function remarkLiteralMdxExpressions() {
  const restore = (node: MdastNode) => {
    if (!node.children) return;

    node.children = node.children.map((child) => {
      if (child.type === "mdxTextExpression") {
        return { type: "text", value: `{${child.value ?? ""}}` };
      }

      if (child.type === "mdxFlowExpression") {
        return {
          type: "paragraph",
          children: [{ type: "text", value: `{${child.value ?? ""}}` }],
        };
      }

      restore(child);
      return child;
    });
  };

  return restore;
}
