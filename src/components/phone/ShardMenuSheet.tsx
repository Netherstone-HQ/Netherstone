import { useState, type ReactNode } from "react";
import {
  FileCodeIcon,
  FileTextIcon,
  FileTypeIcon,
  FolderInputIcon,
  ClockIcon,
  Link2Icon,
  ListTreeIcon,
  PenLineIcon,
  PinIcon,
  PinOffIcon,
  ShareIcon,
  TrashIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  BottomSheet,
  BottomSheetItem,
  BottomSheetSeparator,
} from "@/components/ui/bottom-sheet";
import { LinkedFromSection } from "@/components/sidebar/right-sidebar/LinkedFromSection";
import { LinksSection } from "@/components/sidebar/right-sidebar/LinksSection";
import { OutlineSection } from "@/components/sidebar/right-sidebar/OutlineSection";
import {
  useIndexedShard,
  useShardLinks,
} from "@/components/sidebar/right-sidebar/useShardInfo";
import { useVaultItem } from "@/components/vault/useVaultItem";
import { openFileHistory } from "@/lib/open-vault-file";
import type { ExportFormat } from "@/lib/export";
import { isSamePath } from "@/lib/drawing-files";
import { shareExport } from "@/lib/export/share";
import { useEditorStore, useVaultStore } from "@/store";
import { trashAll } from "./item-batch";
import { NameSheet } from "./NameSheet";
import { usePhoneNav } from "./nav";
import { errorText } from "@/lib/utils";

type Part = "menu" | "outline" | "links" | "rename" | "export";

/** What a shard can be shared as from a phone. */
const SHARED_FORMATS: { format: ExportFormat; label: string; icon: ReactNode }[] = [
  { format: "pdf", label: "PDF", icon: <FileTextIcon /> },
  { format: "docx", label: "Word document", icon: <FileTypeIcon /> },
  { format: "html", label: "Web page", icon: <FileCodeIcon /> },
];

/** Builds the open shard as `format` and opens the share sheet with it. */
async function share(path: string, name: string, format: ExportFormat) {
  const { plateEditor, currentFilePath } = useEditorStore.getState();
  const value =
    plateEditor && currentFilePath && isSamePath(currentFilePath, path)
      ? (plateEditor.children as unknown[])
      : undefined;
  try {
    await shareExport(
      {
        filePath: path,
        fileName: name,
        value,
        vaultPath: useVaultStore.getState().currentVaultPath,
      },
      format,
    );
  } catch (error) {
    toast.error(`Couldn't export ${name}`, {
      description: errorText(error),
    });
  }
}

/** The open shard's menu: what's in it, its history, and file actions. */
export function ShardMenuSheet({
  path,
  open,
  onOpenChange,
}: {
  path: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [part, setPart] = useState<Part>("menu");
  const name = path.split(/[\\/]/).pop() ?? path;
  const item = useVaultItem({ name, path, kind: "file" });
  const links = useShardLinks(open);
  const indexed = useIndexedShard(open);
  const replace = usePhoneNav((s) => s.replace);

  const close = (next: boolean) => {
    if (!next) setPart("menu");
    onOpenChange(next);
  };

  return (
    <>
      <BottomSheet
        open={open && part === "menu"}
        onOpenChange={close}
        title={item.displayName}
      >
        <BottomSheetItem
          icon={<ListTreeIcon />}
          onClick={() => setPart("outline")}
        >
          Outline
        </BottomSheetItem>
        <BottomSheetItem
          icon={<Link2Icon />}
          onClick={() => setPart("links")}
          end={<span className="text-sm">{links.length}</span>}
        >
          Links
        </BottomSheetItem>
        <BottomSheetItem
          icon={<ClockIcon />}
          onClick={() => {
            replace({ kind: "history" });
            void openFileHistory(path).catch((error: unknown) =>
              console.error("[Netherstone] Couldn't show history:", error),
            );
          }}
        >
          Show history
        </BottomSheetItem>
        <BottomSheetSeparator />
        <BottomSheetItem
          icon={item.isPinned ? <PinOffIcon /> : <PinIcon />}
          onClick={() => {
            item.togglePin();
            close(false);
          }}
        >
          {item.isPinned ? "Unpin" : "Pin"}
        </BottomSheetItem>
        <BottomSheetItem
          icon={<PenLineIcon />}
          onClick={() => setPart("rename")}
        >
          Rename
        </BottomSheetItem>
        <BottomSheetItem
          icon={<FolderInputIcon />}
          onClick={() => {
            item.startMove();
            close(false);
          }}
        >
          Move
        </BottomSheetItem>
        <BottomSheetItem icon={<ShareIcon />} onClick={() => setPart("export")}>
          Export
        </BottomSheetItem>
        <BottomSheetSeparator />
        <BottomSheetItem
          danger
          icon={<TrashIcon />}
          onClick={() => trashAll([path])}
        >
          Move to trash
        </BottomSheetItem>
      </BottomSheet>

      <BottomSheet
        open={open && part === "outline"}
        onOpenChange={close}
        title="Outline"
        height="half"
      >
        <div className="px-2 pb-4">
          <OutlineSection />
        </div>
      </BottomSheet>

      <BottomSheet
        open={open && part === "links"}
        onOpenChange={close}
        title="Links"
        height="half"
      >
        <div className="px-2 pb-4">
          <LinksSection links={links} />
          <LinkedFromSection backlinks={indexed?.linkedFrom ?? null} />
        </div>
      </BottomSheet>

      <BottomSheet
        open={open && part === "export"}
        onOpenChange={close}
        title="Export"
      >
        {SHARED_FORMATS.map(({ format, label, icon }) => (
          <BottomSheetItem
            key={format}
            icon={icon}
            onClick={() => {
              close(false);
              void share(path, item.displayName, format);
            }}
          >
            {label}
          </BottomSheetItem>
        ))}
      </BottomSheet>

      <NameSheet
        open={open && part === "rename"}
        onOpenChange={close}
        title="Rename"
        initialName={item.displayName}
        submitLabel="Rename"
        onCreate={async (next) => {
          try {
            await item.renameTo(next);
            close(false);
            return null;
          } catch (error) {
            return errorText(error);
          }
        }}
      />
      {item.dialogs}
    </>
  );
}
