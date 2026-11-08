import { toast } from "sonner";

import { openCitation } from "@/lib/open-citation";
import { openWebLink } from "@/lib/open-web-link";

import type { Citation } from "../AnswerText";

export function openShard(citation: Citation) {
  void openCitation(citation);
}

/** Opens web links only: an answer could hold any kind of link. */
export function openLink(href: string) {
  if (!/^(https?:|mailto:)/i.test(href)) return;
  void openWebLink(href).catch(() => toast.error("Couldn't open the link"));
}
