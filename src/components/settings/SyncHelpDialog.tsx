import { QuestionIcon } from "@phosphor-icons/react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/** A "?" that explains GitHub sync to people who have never used GitHub. */
export function SyncHelpDialog() {
  return (
    <Dialog>
      <DialogTrigger
        aria-label="How sync works"
        className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <QuestionIcon className="size-4" />
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>How sync works</DialogTitle>
          <DialogDescription>
            Netherstone keeps your vault in sync through GitHub, a service
            millions of people use to store files.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm leading-6">
          <p>
            Your vault is saved there as a private repository: a folder that
            also keeps every earlier version of your shards.
          </p>
          <p>
            Private means only you can see it. Nobody else can open it unless
            you invite them on GitHub yourself.
          </p>
          <p>A free GitHub account is all you need.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
