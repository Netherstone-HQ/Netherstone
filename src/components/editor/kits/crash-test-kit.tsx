import { useEffect, useState } from "react";
import { createPlatePlugin } from "platejs/react";

/** Dispatched on `window`, it makes the whole editor fail to draw. */
const CRASH_EDITOR_EVENT = "netherstone:crash-editor";

function FailingBlock(): never {
  throw new Error("This test block fails to draw");
}

// Plate calls this as a function; the block fails as it draws its parts.
const failToDraw = () => <FailingBlock />;

function EditorCrash({ children }: { children: React.ReactNode }) {
  const [crashed, setCrashed] = useState(false);
  useEffect(() => {
    const crash = () => setCrashed(true);
    window.addEventListener(CRASH_EDITOR_EVENT, crash);
    return () => window.removeEventListener(CRASH_EDITOR_EVENT, crash);
  }, []);
  if (crashed) throw new Error("The test editor crash");
  return children;
}

/**
 * Only in builds for the browser tests (`vite build --mode e2e`): a block
 * with `failsToDraw` set throws as it draws, and the event above throws from
 * outside every block.
 */
export function crashTestKit() {
  return [
    createPlatePlugin({
      key: "crashTest",
      render: {
        aboveEditable: EditorCrash,
        belowNodes: ({ element }) => (element.failsToDraw ? failToDraw : undefined),
      },
    }),
  ];
}
