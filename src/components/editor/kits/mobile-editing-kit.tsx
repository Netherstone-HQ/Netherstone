import { createPlatePlugin } from "platejs/react";

import { BlockSheet } from "@/components/editor/mobile/block-sheet";
import { KeyboardBar } from "@/components/editor/mobile/keyboard-bar";

import { BlockSelectionKit } from "./block-selection-kit";

/**
 * Editing on a phone, in place of the toolbars and the right-click menu: the
 * bar above the keyboard with its style panel, and the block menu a long
 * press opens.
 */
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
