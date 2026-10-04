import {
  PreferenceSegments,
  PreferenceSwitch,
  SettingsGroup,
} from "@/components/settings/settings-ui";

export function EditorSettings() {
  return (
    <>
      <SettingsGroup title="Writing">
        <PreferenceSwitch
          name="spellcheck"
          label="Check spelling"
          description="Underline misspelled words as you type."
        />
        <PreferenceSwitch
          name="showWordCount"
          label="Show word count"
          description="Shown at the top of the window while a shard is open."
        />
      </SettingsGroup>

      <SettingsGroup title="New shards">
        <PreferenceSegments
          name="newShardLocation"
          label="Create new shards in"
          description="Where a shard goes when you create it from the sidebar or header."
          options={[
            { value: "vault-root", label: "Top of the vault" },
            { value: "current-folder", label: "Current folder" },
          ]}
        />
      </SettingsGroup>
    </>
  );
}
