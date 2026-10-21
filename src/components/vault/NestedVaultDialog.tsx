import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useNestedVaultQuestion } from "@/lib/nested-vault";
import { folderName } from "@/lib/open-vault";

/**
 * Asks before a vault opens inside another one, or around one: either vault's
 * files would show up in both.
 */
export function NestedVaultDialog() {
  const question = useNestedVaultQuestion((s) => s.question);
  const other = question ? folderName(question.path) : "";

  return (
    <Dialog
      open={question !== null}
      onOpenChange={(open) => !open && question?.answer(null)}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {question?.containsFolder
              ? `This folder is inside ${other}`
              : `${other} is inside this folder`}
          </DialogTitle>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => question?.answer(question.folder)}
          >
            {question?.action === "create" ? "Create anyway" : "Open anyway"}
          </Button>
          <Button onClick={() => question?.answer(question.path)}>
            Open {other}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
