import { invoke } from "@tauri-apps/api/core";

/** An AI app Settings can set up to use the vault. */
export interface AiApp {
  id: string;
  name: string;
  /** On this computer. */
  installed: boolean;
  /** Set up to start this copy of Netherstone. */
  connected: boolean;
  downloadUrl: string;
}

/** Whether AI apps may use the vault through the MCP server. */
export async function getMcpEnabled(): Promise<boolean> {
  return invoke("mcp_get_enabled");
}

export async function setMcpEnabled(enabled: boolean): Promise<void> {
  await invoke("mcp_set_enabled", { enabled });
}

/** A vault the app has opened, and whether AI apps may use it. */
export interface McpVault {
  path: string;
  name: string;
  allowed: boolean;
}

export async function listMcpVaults(): Promise<McpVault[]> {
  return invoke("mcp_vaults");
}

export async function setMcpVaultAllowed(
  path: string,
  allowed: boolean,
): Promise<void> {
  await invoke("mcp_set_vault_allowed", { path, allowed });
}

export async function listAiApps(): Promise<AiApp[]> {
  return invoke("ai_apps");
}

export async function connectAiApp(id: string): Promise<void> {
  await invoke("ai_app_connect", { id });
}

/** The server setup to paste into an AI app that isn't listed. */
export async function getMcpSetup(): Promise<string> {
  return invoke("mcp_setup");
}
