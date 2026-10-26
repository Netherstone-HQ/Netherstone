import {
  SettingRow,
  Stepper,
  SettingsGroup,
} from "@/components/settings/settings-ui";
import { ThemePicker } from "@/components/theme/ThemePicker";
import {
  stepZoom,
  useSettingsStore,
  type Zoom,
  ZOOM_LEVELS,
} from "@/store/settings";

export function AppearanceSettings() {
  return (
    <>
      <SettingsGroup title="Theme">
        {/* As many themes to a row as fit, so wide windows don't blow them up. */}
        <ThemePicker className="grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] p-4" />
      </SettingsGroup>

      <SettingsGroup>
        <ZoomRow />
      </SettingsGroup>
    </>
  );
}

function ZoomRow() {
  const zoom = useSettingsStore((s) => s.zoom);
  const setPreference = useSettingsStore((s) => s.setPreference);

  return (
    <SettingRow
      label="Zoom"
      description="Makes everything in Netherstone bigger or smaller"
    >
      <Stepper
        label="Zoom"
        value={zoom}
        min={ZOOM_LEVELS[0]}
        max={ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
        step={(value, direction) => stepZoom(value as Zoom, direction)}
        format={(value) => `${value}%`}
        decreaseLabel="Zoom out"
        increaseLabel="Zoom in"
        onChange={(next) => setPreference("zoom", next as Zoom)}
      />
    </SettingRow>
  );
}
