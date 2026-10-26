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
 * Explains a setting to people new to it, from a "?" or, with `asLink`, from
 * the words of its title.
 */
export function HelpDialog({
  title,
  description,
  children,
  asLink = false,
}: {
  title: string;
  description: React.ReactNode;
  children: React.ReactNode;
  asLink?: boolean;
}) {
  return (
    <Dialog>
      {asLink ? (
        <DialogTrigger className="text-foreground underline underline-offset-4 hover:text-foreground/80">
          {title}
        </DialogTrigger>
      ) : (
        <DialogTrigger
          aria-label={title}
          className="inline-flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <CircleQuestionMarkIcon className="size-4" />
        </DialogTrigger>
      )}
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-ui leading-6">{children}</div>
      </DialogContent>
    </Dialog>
  );
}
