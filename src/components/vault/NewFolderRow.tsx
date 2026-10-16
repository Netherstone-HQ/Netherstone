import { useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

import { Input } from "@/components/ui/input";
import { SidebarMenuItem } from "@/components/ui/sidebar";
import {
  ACTION_SLOT_PX,
  FolderChevron,
  RowSlot,
  TreeGuides,
  getRowIndent,
} from "@/components/vault/tree-layout";
import { refreshVault } from "@/lib/refresh-vault";
import { useVaultStore } from "@/store";

type NewFolderRowProps = {
  parent: string;
  depth: number;
};

/** A tree row where a new folder is named. Enter or leaving it creates it. */
export function NewFolderRow({ parent, depth }: NewFolderRowProps) {
  const [name, setName] = useState("");
  const isCreatingRef = useRef(false);
  const setNewFolderParent = useVaultStore((s) => s.setNewFolderParent);

  const close = () => setNewFolderParent(null);

  const create = async ({ keepOpenOnError }: { keepOpenOnError: boolean }) => {
    if (isCreatingRef.current) return;

    const trimmedName = name.trim();
    if (!trimmedName) {
      close();
      return;
    }

    isCreatingRef.current = true;
    try {
      await invoke<string>("create_folder", { parent, name: trimmedName });
      await refreshVault(useVaultStore.getState().currentVaultPath);
      close();
    } catch (error) {
      isCreatingRef.current = false;
      toast.error(error instanceof Error ? error.message : String(error));
      if (!keepOpenOnError) close();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void create({ keepOpenOnError: true });
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  };

  return (
    <SidebarMenuItem className="w-full min-w-0 overflow-hidden">
      <div className="relative w-full min-w-0">
        <TreeGuides depth={depth} />
        <div
          className="flex h-row w-full min-w-0 items-center gap-1 pr-1 text-ui"
          style={{ paddingLeft: `${getRowIndent(depth)}px` }}
        >
          <RowSlot>
            <FolderChevron isOpen={false} />
          </RowSlot>
          <Input
            autoFocus
            aria-label="Folder name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => void create({ keepOpenOnError: false })}
            className="h-6 min-w-0 flex-1 px-2 py-0 text-ui"
          />
          <span
            aria-hidden="true"
            className="shrink-0"
            style={{ width: `${ACTION_SLOT_PX}px` }}
          />
        </div>
      </div>
    </SidebarMenuItem>
  );
}
