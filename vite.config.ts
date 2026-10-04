import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { readFileSync } from "fs";

const host = process.env.TAURI_DEV_HOST;
const { version } = JSON.parse(
  readFileSync(path.resolve(__dirname, "package.json"), "utf8"),
);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  define: {
    __APP_VERSION__: JSON.stringify(version),
  },

  worker: {
    format: "es",
  },

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The markdown parser (micromark) pulls this in. Its "browser" build
      // calls `document.createElement` at import time, which crashes the
      // markdown worker; the default build works everywhere.
      "decode-named-character-reference": path.resolve(
        __dirname,
        "node_modules/decode-named-character-reference/index.js",
      ),
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
});
