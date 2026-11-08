import { invoke } from "@tauri-apps/api/core";
import { assertTauri } from "./tauri";

/** A way the system can open things in Netherstone, set up from Settings. */
export type Integration = "openWith" | "folderMenu" | "terminal";

/** Whether each one is on, or null where this system doesn't offer it. */
export type Integrations = Record<Integration, boolean | null>;

export async function getIntegrations(): Promise<Integrations> {
  assertTauri();
  return invoke<Integrations>("integrations_get");
}

export async function setIntegration(integration: Integration, on: boolean): Promise<void> {
  assertTauri();
  return invoke<void>("integrations_set", { integration, on });
}
