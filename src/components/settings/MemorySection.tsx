import { useEffect, useState } from "react";
import { PencilIcon, TrashIcon } from "lucide-react";
import { toast } from "sonner";

import { SettingRow, SettingsGroup } from "@/components/settings/settings-ui";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Hint } from "@/components/ui/tooltip";
import {
  type AssistantMemory,
  deleteAllMemory,
  deleteMemory,
  editMemory,
  getMemory,
} from "@/lib/commands/assistant";

function showError(error: unknown) {
  toast.error(error instanceof Error ? error.message : String(error));
}

function DeleteAllMemoryDialog({
  open,
  onOpenChange,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete all memory?</AlertDialogTitle>
          <AlertDialogDescription>
            Memory is only on this computer, so it can't be brought back.
            Your shards and chats stay as they are.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() =>
              void deleteAllMemory().then(onDeleted, () =>
                toast.error("Couldn't delete memory"),
              )
            }
          >
            Delete all
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EditItem({
  item,
  maxLength,
  onSave,
  onCancel,
}: {
  item: string;
  maxLength: number;
  onSave: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(item);
  const [saving, setSaving] = useState(false);
  const canSave = draft.trim().length > 0 && draft.trim() !== item && !saving;
  return (
    <form
      className="flex items-center gap-2 px-4 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSave) return;
        setSaving(true);
        void onSave(draft).finally(() => setSaving(false));
      }}
    >
      <Input
        autoFocus
        aria-label="Memory item"
        value={draft}
        maxLength={maxLength}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        className="h-9 flex-1"
      />
      <Button type="submit" size="sm" disabled={!canSave}>
        Save
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Hint label={label} side="bottom">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={label}
        onClick={onClick}
        className="text-muted-foreground hover:text-foreground"
      >
        {children}
      </Button>
    </Hint>
  );
}

/**
 * What the assistant remembers: every item, to edit in place or delete. It
 * stays here while the assistant is off, as the saved chats do.
 */
export function MemorySection() {
  const [memory, setMemory] = useState<AssistantMemory | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    void getMemory().then(setMemory, showError);
  }, []);

  if (!memory) return null;
  const empty = memory.items.length === 0;

  async function save(item: string, text: string) {
    try {
      setMemory(await editMemory(item, text));
      setEditing(null);
    } catch (error) {
      showError(error);
    }
  }

  async function remove(item: string) {
    try {
      setMemory(await deleteMemory(item));
    } catch (error) {
      showError(error);
    }
  }

  return (
    <SettingsGroup title="Memory" bare>
      <div className="space-y-3">
        <div className="rounded-xl border bg-card shadow-xs">
          <SettingRow
            label="Memory"
            description={
              empty
                ? "Nothing remembered yet"
                : "Things the assistant remembers about you, kept on this computer"
            }
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={empty}
              onClick={() => setConfirming(true)}
            >
              Delete all
            </Button>
            <DeleteAllMemoryDialog
              open={confirming}
              onOpenChange={setConfirming}
              onDeleted={() => {
                setEditing(null);
                setMemory({ ...memory, items: [] });
              }}
            />
          </SettingRow>
        </div>
        {empty ? null : (
          <ul
            aria-label="Memory items"
            className="divide-y rounded-xl border bg-card shadow-xs"
          >
            {memory.items.map((item) => (
              <li key={item}>
                {editing === item ? (
                  <EditItem
                    item={item}
                    maxLength={memory.maxLength}
                    onSave={(text) => save(item, text)}
                    onCancel={() => setEditing(null)}
                  />
                ) : (
                  <div className="flex items-center gap-2 py-2.5 pr-2 pl-4">
                    <span className="min-w-0 flex-1 break-words">{item}</span>
                    <IconButton label="Edit" onClick={() => setEditing(item)}>
                      <PencilIcon className="size-4" />
                    </IconButton>
                    <IconButton
                      label="Delete"
                      onClick={() => void remove(item)}
                    >
                      <TrashIcon className="size-4" />
                    </IconButton>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingsGroup>
  );
}
