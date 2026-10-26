import { HelpDialog } from "@/components/settings/HelpDialog";

/**
 * Explains GitHub sync to people who have never used GitHub, from a "?" or,
 * with `asLink`, from the words "How sync works".
 */
export function SyncHelpDialog({ asLink = false }: { asLink?: boolean }) {
  return (
    <HelpDialog
      title="How sync works"
      description="Netherstone syncs your vault through GitHub, where millions of people store their files"
      asLink={asLink}
    >
      <p>
        It's saved there as a private repository, a folder that keeps every
        earlier version of your files
      </p>
      <p>Only you can see it, unless you invite someone on GitHub</p>
      <p>A free GitHub account is all you need</p>
    </HelpDialog>
  );
}
