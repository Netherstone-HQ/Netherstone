import { openUrl } from "@tauri-apps/plugin-opener";
import {
  FileTextIcon,
  GlobeIcon,
  HashIcon,
  LinkIcon,
  type LucideIcon,
  MailIcon,
  PhoneIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { DrawingIcon } from "@/components/icons";
import { Hint } from "@/components/ui/tooltip";
import { isDrawingPath } from "@/lib/drawing-files";
import { openVaultFile } from "@/lib/open-vault-file";
import { CollapsibleSection, SECTION_NOTE_CLASS } from "./CollapsibleSection";
import { getLinkName } from "./link-utils";
import type { DocumentLink, DocumentLinkKind } from "./types";

const LINK_ROW_CLASS =
  "flex h-row w-full min-w-0 items-center gap-2 rounded-sm px-1.5 text-left text-sidebar-foreground/85 text-ui-sm";

const ICONS: Record<DocumentLinkKind, LucideIcon> = {
  "shard-mention": FileTextIcon,
  internal: FileTextIcon,
  external: GlobeIcon,
  email: MailIcon,
  phone: PhoneIcon,
  anchor: HashIcon,
  other: LinkIcon,
};

function open(link: DocumentLink) {
  const opening = link.resolvedPath
    ? openVaultFile(link.resolvedPath)
    : openUrl(link.target);
  opening.catch((error) => {
    console.error("[Netherstone] Failed to open link:", link.target, error);
  });
}

function LinkRow({ link }: { link: DocumentLink }) {
  const name = getLinkName(link);

  if (!link.isValid) {
    return (
      <li className={LINK_ROW_CLASS}>
        <TriangleAlertIcon className="size-4 shrink-0 text-amber-500" />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">
          {name}
        </span>
        <span className="shrink-0 text-amber-500">Missing</span>
      </li>
    );
  }

  const Icon =
    link.resolvedPath && isDrawingPath(link.resolvedPath)
      ? DrawingIcon
      : ICONS[link.kind];
  const content = (
    <>
      <Icon className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1 truncate">{name}</span>
    </>
  );

  // Links within the shard have nowhere else to go.
  if (link.kind === "anchor") {
    return <li className={LINK_ROW_CLASS}>{content}</li>;
  }

  const button = (
    <button
      type="button"
      onClick={() => open(link)}
      className={`${LINK_ROW_CLASS} outline-none transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:bg-accent/40`}
    >
      {content}
    </button>
  );

  return (
    <li>
      {link.resolvedPath ? (
        button
      ) : (
        <Hint
          label={<span className="line-clamp-3 break-all">{link.target}</span>}
          side="left"
        >
          {button}
        </Hint>
      )}
    </li>
  );
}

/** Where the open shard links to: shards, websites and addresses, once each. */
export function LinksSection({ links }: { links: DocumentLink[] }) {
  return (
    <CollapsibleSection section="links" label="Links" count={links.length}>
      {links.length === 0 ? (
        <p className={SECTION_NOTE_CLASS}>
          Links and @mentions in this shard show up here.
        </p>
      ) : (
        <ul className="flex flex-col gap-px">
          {links.map((link) => (
            <LinkRow key={`${link.kind}:${link.target}`} link={link} />
          ))}
        </ul>
      )}
    </CollapsibleSection>
  );
}
