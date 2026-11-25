import { Dialog as DialogPrimitive } from "radix-ui";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";
import { BottomSheetFrame, BottomSheetHandle } from "@/components/ui/bottom-sheet";

/** Tall enough for a chat, low enough that the shard's top stays in view. */
const SHEET_HEIGHT = "h-[65dvh]";

/**
 * The assistant in a sheet over the open shard. Its own header (chats, new
 * chat, close) takes the sheet's title row.
 */
export function AssistantSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <BottomSheetFrame
      open={open}
      onOpenChange={onOpenChange}
      // The composer takes focus when it wants it, not on every open.
      onOpenAutoFocus={(event) => event.preventDefault()}
      className={`max-h-[calc(100dvh-3rem)] overflow-hidden ${SHEET_HEIGHT}`}
    >
      <DialogPrimitive.Title className="sr-only">Assistant</DialogPrimitive.Title>
      <BottomSheetHandle className="mb-1" />
      <AssistantPanel
        onHide={() => onOpenChange(false)}
        className="min-h-0 w-full flex-1 border-l-0 bg-popover text-base"
      />
    </BottomSheetFrame>
  );
}
