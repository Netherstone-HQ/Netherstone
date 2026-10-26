import {
  type Option,
  PreferenceSegments,
  PreferenceSelect,
  PreferenceSwitch,
  SettingsGroup,
} from "@/components/settings/settings-ui";
import type { ContentWidth, ReadingFont, TextSize } from "@/store/settings";

const FONTS: Option<ReadingFont>[] = [
  {
    value: "newsreader",
    label: "Newsreader",
    className: "[font-family:'Newsreader_Variable',serif]",
  },
  { value: "geist", label: "Geist", className: "font-sans" },
  {
    value: "system",
    label: "System font",
    className: "[font-family:system-ui]",
  },
];

const SIZES: Option<TextSize>[] = [
  { value: "small", label: "Small" },
  { value: "default", label: "Default" },
  { value: "large", label: "Large" },
];

const WIDTHS: Option<ContentWidth>[] = [
  { value: "narrow", label: "Narrow" },
  { value: "default", label: "Default" },
  { value: "wide", label: "Wide" },
  { value: "full", label: "Full" },
];

export function EditorSettings() {
  return (
    <>
      <SettingsGroup title="Writing">
        <PreferenceSwitch
          name="spellcheck"
          label="Check spelling"
          description="Underline misspelled words as you type"
        />
        <PreferenceSwitch
          name="showWordCount"
          label="Show word count"
          description="Shown at the top of the window while a shard is open"
        />
      </SettingsGroup>

      <SettingsGroup title="Reading">
        <ReadingPreview />
        <PreferenceSelect
          name="readingFont"
          label="Shard font"
          options={FONTS}
        />
        <PreferenceSegments name="textSize" label="Text size" options={SIZES} />
        <PreferenceSegments
          name="contentWidth"
          label="Line width"
          description="How wide the text column gets in a large window"
          options={WIDTHS}
        />
      </SettingsGroup>
    </>
  );
}

/** Sample text in the chosen reading font and size. */
function ReadingPreview() {
  return (
    <div className="px-4 py-5">
      <p className="font-reading text-(length:--reading-size) leading-relaxed">
        <span className="font-semibold">Your knowledge, set in stone.</span>{" "}
        A shard is a Markdown document on your computer, and your vault is
        the folder that holds them. A drawing is a sketch or diagram you can
        place in any shard. Sync keeps your vault the same on every device.
      </p>
    </div>
  );
}
