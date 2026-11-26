import { createPlatePlugin } from "platejs/react";

import { BlockSheet } from "@/components/editor/mobile/block-sheet";
import { KeyboardBar } from "@/components/editor/mobile/keyboard-bar";

import { BlockSelectionKit } from "./block-selection-kit";

/** Phone editing: the keyboard bar and the long-press block menu, in place of toolbars. */
export const MobileEditingKit = [
  ...BlockSelectionKit,
  createPlatePlugin({
    key: "mobile-editing",
    render: {
      afterEditable: () => (
        <>
          <KeyboardBar />
          <BlockSheet />
        </>
      ),
    },
  }),
];
