// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { DndProvider } from "react-dnd";
import { HTML5Backend } from "react-dnd-html5-backend";
import {
  Plate,
  PlateContent,
  type PlateElementProps,
  createPlateEditor,
  useEditorReadOnly,
  useEditorRef,
} from "platejs/react";
import { afterEach, expect, it } from "vitest";
import { EditorKit } from "@/components/editor/editor-kit";
import { ParagraphElement } from "@/components/ui/paragraph-node";
import { TooltipProvider } from "@/components/ui/tooltip";

afterEach(cleanup);

/**
 * A block that renders twice keeps two copies of its React state, and a long
 * shard has thousands of blocks: Plate's store hooks re-rendered every block
 * once after mounting (see the jotai and @platejs/core patches).
 */
it("renders each block once when a shard opens", () => {
  let renders = 0;
  function CountedParagraph(props: PlateElementProps) {
    useEditorRef();
    useEditorReadOnly();
    renders += 1;
    return <ParagraphElement {...props} />;
  }

  const editor = createPlateEditor({
    plugins: EditorKit,
    override: { components: { p: CountedParagraph } },
    value: Array.from({ length: 20 }, (_, index) => ({
      type: "p",
      children: [{ text: `Block ${index}` }],
    })),
  });
  render(
    <DndProvider backend={HTML5Backend}>
      <TooltipProvider>
        <Plate editor={editor}>
          <PlateContent />
        </Plate>
      </TooltipProvider>
    </DndProvider>,
  );
  // render() runs the effects after mounting and any render they cause.
  // The empty line that ends every shard is a block too.
  expect(renders).toBe(editor.children.length);
});
