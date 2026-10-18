import { defineConfig } from "@playwright/test";

/**
 * Real-browser editor tests against the built app (`pnpm exec vite build`
 * first). They mock the Tauri bridge, so no desktop build is needed.
 *
 * Set E2E_CHROMIUM to a Chromium binary to run without downloading one.
 */
const executablePath = process.env.E2E_CHROMIUM;

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  timeout: 90_000,
  use: {
    baseURL: "http://localhost:4173",
    viewport: { width: 1440, height: 900 },
    permissions: ["clipboard-read", "clipboard-write"],
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : undefined,
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: "pnpm exec vite preview --port 4173 --strictPort",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
