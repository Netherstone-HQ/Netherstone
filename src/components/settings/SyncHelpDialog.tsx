import { CircleQuestionMarkIcon } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * Explains GitHub sync to people who have never used GitHub, from a "?" or,
 * with `asLink`, from the words "How sync works".
 */
export function SyncHelpDialog({ asLink = false }: { asLink?: boolean }) {
  return (
    <Dialog>
      {asLink ? (
        <DialogTrigger className="text-foreground underline underline-offset-4 hover:text-foreground/80">
          How sync works
        </DialogTrigger>
      ) : (
        <DialogTrigger
          aria-label="How sync works"
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <CircleQuestionMarkIcon className="size-4" />
        </DialogTrigger>
      )}
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>How sync works</DialogTitle>
          <DialogDescription>
            Netherstone syncs your vault through GitHub, where millions of
            people store their files.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-ui leading-6">
          <p>
            It's saved there as a private repository, a folder that keeps
            every earlier version of your files.
          </p>
          <p>
            Only you can see it, unless you invite someone on GitHub.
          </p>
          <p>A free GitHub account is all you need.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
