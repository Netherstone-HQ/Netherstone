import { SettingsGroup } from "@/components/settings/settings-ui";

const IS_MAC = navigator.userAgent.includes("Mac");

/** Keys as written in Plate's shortcut config ("mod+shift+x"). */
type Shortcut = { keys: string; action: string };

const GROUPS: { title: string; shortcuts: Shortcut[] }[] = [
  {
    title: "App",
    shortcuts: [{ keys: "mod+k", action: "Search your vault" }],
  },
  {
    title: "Text",
    shortcuts: [
      { keys: "mod+b", action: "Bold" },
      { keys: "mod+i", action: "Italic" },
      { keys: "mod+u", action: "Underline" },
      { keys: "mod+shift+x", action: "Strikethrough" },
      { keys: "mod+e", action: "Inline code" },
      { keys: "mod+shift+h", action: "Highlight" },
      { keys: "mod+period", action: "Superscript" },
      { keys: "mod+comma", action: "Subscript" },
      { keys: "mod+z", action: "Undo" },
      { keys: IS_MAC ? "mod+shift+z" : "mod+y", action: "Redo" },
    ],
  },
  {
    title: "Blocks",
    shortcuts: [
      { keys: "mod+alt+1", action: "Heading 1" },
      { keys: "mod+alt+2", action: "Heading 2" },
      { keys: "mod+alt+3", action: "Heading 3" },
      { keys: "mod+shift+period", action: "Quote" },
      { keys: "mod+alt+8", action: "Code block" },
      { keys: "mod+enter", action: "New line after this block" },
      { keys: "mod+shift+enter", action: "New line before this block" },
    ],
  },
];

const KEY_NAMES: Record<string, string> = IS_MAC
  ? { mod: "⌘", alt: "⌥", shift: "⇧", enter: "↩", period: ".", comma: "," }
  : {
      mod: "Ctrl",
      alt: "Alt",
      shift: "Shift",
      enter: "Enter",
      period: ".",
      comma: ",",
    };

export function formatKeys(keys: string): string[] {
  return keys.split("+").map((key) => KEY_NAMES[key] ?? key.toUpperCase());
}

export function ShortcutsSettings() {
  return (
    <>
      {GROUPS.map((group) => (
        <SettingsGroup key={group.title} title={group.title}>
          {group.shortcuts.map((shortcut) => (
            <div
              key={shortcut.keys}
              className="flex items-center justify-between gap-6 px-4 py-2.5"
            >
              <span className="text-sm">{shortcut.action}</span>
              <span className="flex gap-1">
                {formatKeys(shortcut.keys).map((key) => (
                  <kbd
                    key={key}
                    className="min-w-6 rounded-md border bg-muted px-1.5 py-0.5 text-center font-sans text-muted-foreground text-xs"
                  >
                    {key}
                  </kbd>
                ))}
              </span>
            </div>
          ))}
        </SettingsGroup>
      ))}
      <p className="px-1 text-muted-foreground text-xs leading-5">
        Markdown works as you type too: start a line with # for a heading, - for
        a list or &gt; for a quote.
      </p>
    </>
  );
}
