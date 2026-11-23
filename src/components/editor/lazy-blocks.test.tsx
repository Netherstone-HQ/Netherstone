// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import { Plate, PlateContent, createPlateEditor } from "platejs/react";
import { afterEach, expect, it } from "vitest";
import { EditorKit } from "@/components/editor/editor-kit";
import { TooltipProvider } from "@/components/ui/tooltip";

afterEach(cleanup);

function renderShard(value: unknown[]) {
  const editor = createPlateEditor({ plugins: EditorKit, value: value as never });
  return render(
    <DndProvider backend={HTML5Backend}>
      <TooltipProvider>
        <Plate editor={editor}>
          <PlateContent />
        </Plate>
      </TooltipProvider>
    </DndProvider>,
  );
}

// The highlighter and KaTeX load with the first code block or equation
// shown, not with the app.
it("colors a code block once the highlighter has loaded", async () => {
  const { container } = renderShard([
    {
      type: "code_block",
      lang: "javascript",
      children: [{ type: "code_line", children: [{ text: "const a = 1;" }] }],
    },
  ]);

  await waitFor(() =>
    expect(container.querySelector("[class*=hljs-keyword]")).not.toBeNull(),
  );
});

it("shows an equation once KaTeX has loaded", async () => {
  const { container } = renderShard([
    { type: "equation", texExpression: "x^2", children: [{ text: "" }] },
  ]);

  await waitFor(() =>
    expect(container.querySelector(".katex")).not.toBeNull(),
  );
});
