import path from "path";
import { readFileSync } from "fs";
import { defineConfig, type Plugin } from "vite";

import { FORMAT_LABELS } from "./src/lib/export/options";
import { IMPORT_FORMATS } from "./src/lib/import/formats/list";

const { version } = JSON.parse(readFileSync(path.resolve(__dirname, "package.json"), "utf8"));

/**
 * `convert.json` beside `convert.js`: what the converter reads and writes,
 * for the website to build its pages from without running the converter.
 */
function manifest(): Plugin {
  return {
    name: "netherstone-convert-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "convert.json",
        source: `${JSON.stringify({ importFormats: IMPORT_FORMATS, exportFormats: FORMAT_LABELS }, null, 2)}\n`,
      });
    },
  };
}

/**
 * The website's converter (src/lib/convert/web.ts) as a standalone module:
 * `convert.js` plus its workers, fonts and chunks, all found next to it at
 * run time. Each release attaches it as netherstone-convert.tgz.
 *
 * Not a library build: that would inline every font and worker as base64.
 */
export default defineConfig({
  // Files find each other relative to convert.js, wherever the site serves it.
  base: "./",
  plugins: [manifest()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  worker: { format: "es" },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // As in vite.config.ts: the "browser" build crashes in workers.
      "decode-named-character-reference": path.resolve(
        __dirname,
        "node_modules/decode-named-character-reference/index.js",
      ),
    },
  },
  build: {
    outDir: "dist-convert",
    emptyOutDir: true,
    copyPublicDir: false,
    target: "es2022",
    rollupOptions: {
      input: { convert: path.resolve(__dirname, "src/lib/convert/web.ts") },
      preserveEntrySignatures: "strict",
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
});
