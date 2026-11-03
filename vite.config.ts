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
    // Builds for package managers set NETHERSTONE_UPDATER=off, together with
    // cargo's --no-default-features, which leaves the updater out of the app.
    __SELF_UPDATE__: JSON.stringify(process.env.NETHERSTONE_UPDATER !== "off"),
  },

  worker: {
    format: "es",
  },

  resolve: {
    alias: [
      { find: "@", replacement: path.resolve(__dirname, "./src") },
      // The markdown parser (micromark) pulls this in. Its "browser" build
      // calls `document.createElement` at import time, which crashes the
      // markdown worker; the default build works everywhere.
      {
        find: "decode-named-character-reference",
        replacement: path.resolve(
          __dirname,
          "node_modules/decode-named-character-reference/index.js",
        ),
      },
      // @platejs/math imports KaTeX's stylesheet, which lists every font in
      // three formats. Ours lists woff2 only. Exact match, so the export's
      // `katex.min.css?raw` still gets the original.
      {
        find: /^katex\/dist\/katex\.min\.css$/,
        replacement: path.resolve(__dirname, "src/styles/katex.scss"),
      },
    ],
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
