import {
  ClockIcon,
  FolderInputIcon,
  PenLineIcon,
  PinIcon,
  PinOffIcon,
  SquareCheckIcon,
  TrashIcon,
} from "lucide-react";
import {
  BottomSheet,
  BottomSheetItem,
  BottomSheetSeparator,
} from "@/components/ui/bottom-sheet";
import { getVaultFileDisplayName, isSamePath } from "@/lib/drawing-files";
import { useUIStore, useVaultStore } from "@/store";
import { pinAll, trashAll } from "./item-batch";
import { usePhoneNav } from "./nav";
import { openFileScreen, openHistoryScreen } from "./open-file";
import { usePhoneSelection } from "./selection";
import { findNode } from "./vault-tree";

/** What a pressed-and-held row can do. */
export function RowMenuSheet({
  path,
  open,
  onOpenChange,
}: {
  path: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const node = useVaultStore((s) => findNode(s.fileTree, path));
  const isPinned = useUIStore((s) =>
    s.pinnedFiles.some((entry) => isSamePath(entry.path, path)),
  );
  const { replace } = usePhoneNav.getState();
  if (!node) return null;
  const isFile = node.kind === "file";

  const showHistory = async () => {
    await openFileScreen(path, true);
    openHistoryScreen(path);
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={isFile ? getVaultFileDisplayName(node.name) : node.name}
    >
      {isFile ? (
        <BottomSheetItem
          icon={isPinned ? <PinOffIcon /> : <PinIcon />}
          onClick={() => pinAll([path])}
        >
          {isPinned ? "Unpin" : "Pin"}
        </BottomSheetItem>
      ) : null}
      <BottomSheetItem
        icon={<PenLineIcon />}
        onClick={() => replace({ kind: "rename", path })}
      >
        Rename
      </BottomSheetItem>
      <BottomSheetItem
        icon={<FolderInputIcon />}
        onClick={() => replace({ kind: "move", paths: [path] })}
      >
        Move
      </BottomSheetItem>
      {isFile ? (
        <>
          <BottomSheetItem
            icon={<ClockIcon />}
            onClick={() => void showHistory()}
          >
            Show history
          </BottomSheetItem>
          <BottomSheetItem
            icon={<SquareCheckIcon />}
            onClick={() => {
              usePhoneSelection.getState().set([path]);
              replace({ kind: "select" });
            }}
          >
            Select
          </BottomSheetItem>
        </>
      ) : null}
      <BottomSheetSeparator />
      <BottomSheetItem
        danger
        icon={<TrashIcon />}
        onClick={() => trashAll([path])}
      >
        Move to trash
      </BottomSheetItem>
    </BottomSheet>
  );
}
