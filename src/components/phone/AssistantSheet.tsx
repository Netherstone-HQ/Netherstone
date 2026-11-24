import { Dialog as DialogPrimitive } from "radix-ui";
import { AssistantPanel } from "@/components/assistant/AssistantPanel";

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
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/55 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // The composer takes focus when it wants it, not on every open.
          onOpenAutoFocus={(event) => event.preventDefault()}
          className={`fixed inset-x-0 bottom-0 z-50 flex max-h-[calc(100dvh-3rem)] flex-col overflow-hidden rounded-t-[20px] border-t bg-popover pb-[var(--safe-area-bottom,env(safe-area-inset-bottom))] outline-none duration-200 data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom ${SHEET_HEIGHT}`}
        >
          <DialogPrimitive.Title className="sr-only">
            Assistant
          </DialogPrimitive.Title>
          <div
            aria-hidden="true"
            className="mx-auto mt-3 mb-1 h-1 w-8 shrink-0 rounded-full bg-input"
          />
          <AssistantPanel
            onHide={() => onOpenChange(false)}
            className="min-h-0 w-full flex-1 border-l-0 bg-popover text-base"
          />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
