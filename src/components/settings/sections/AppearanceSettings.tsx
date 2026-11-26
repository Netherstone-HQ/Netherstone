import {
  SettingRow,
  Stepper,
  SettingsGroup,
} from "@/components/settings/settings-ui";
import { ThemePicker } from "@/components/theme/ThemePicker";
import { IS_MOBILE } from "@/lib/platform";
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
        <ThemePicker
          className="p-4"
          columns="grid-cols-[repeat(auto-fill,minmax(11rem,1fr))]"
        />
      </SettingsGroup>

      {/* Tauri zooms the webview only on desktop. */}
      {!IS_MOBILE && (
        <SettingsGroup>
          <ZoomRow />
        </SettingsGroup>
      )}
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
