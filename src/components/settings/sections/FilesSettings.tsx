import { FolderInput, Link2 } from "lucide-react";

import { AttachmentsSection } from "@/components/settings/AttachmentsSection";
import { SettingsGroup } from "@/components/settings/settings-ui";
import { cn } from "@/lib/utils";
import {
  type MediaInsertionPreference,
  useSettingsStore,
} from "@/store/settings";

const INSERT_OPTIONS: {
  value: MediaInsertionPreference;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    value: "vault-import",
    title: "Copy it into the vault",
    description:
      "The file travels with your shards and syncs with them. Best for most files.",
    icon: FolderInput,
  },
  {
    value: "local-reference",
    title: "Link to where it is on your computer",
    description:
      "Suits large files. The link breaks if the file moves, and other devices won't see it.",
    icon: Link2,
  },
];

export function FilesSettings() {
  const value = useSettingsStore((s) => s.mediaInsertionPreference);
  const setPreference = useSettingsStore((s) => s.setPreference);

  return (
    <>
      <SettingsGroup
        title="Adding files"
        description="What happens when you add an image, video or other file from your computer to a shard."
      >
        <fieldset className="space-y-2 p-2">
          <legend className="sr-only">Adding files</legend>
          {INSERT_OPTIONS.map((option) => {
            const Icon = option.icon;
            const checked = value === option.value;
            return (
              <label
                key={option.value}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border border-transparent p-3 transition-colors hover:bg-accent/40",
                  checked && "border-primary/40 bg-accent/50",
                )}
              >
                <input
                  type="radio"
                  name="media-insertion-preference"
                  value={option.value}
                  checked={checked}
                  onChange={() =>
                    setPreference("mediaInsertionPreference", option.value)
                  }
                  className="sr-only"
                />
                <span
                  className={cn(
                    "mt-0.5 rounded-md border p-1.5 text-muted-foreground",
                    checked && "border-primary/30 bg-primary/10 text-primary",
                  )}
                >
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="block font-medium text-sm">
                    {option.title}
                  </span>
                  <span className="block text-muted-foreground text-xs leading-5">
                    {option.description}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={cn(
                    "mt-1 size-4 shrink-0 rounded-full border",
                    checked && "border-[5px] border-primary",
                  )}
                />
              </label>
            );
          })}
        </fieldset>
      </SettingsGroup>

      <AttachmentsSection />
    </>
  );
}
