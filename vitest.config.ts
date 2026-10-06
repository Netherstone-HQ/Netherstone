import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "node",
      include: ["src/**/*.test.{ts,tsx}"],
      setupFiles: ["src/test/setup-dom.ts"],
      // HTML exports embed KaTeX's stylesheet as text (`?raw`); Vitest would
      // otherwise hand tests an empty string for it.
      css: { include: [/katex\.min\.css/] },
      server: {
        deps: {
          // Some editor plugins import CSS at module scope (e.g. KaTeX in
          // @platejs/math); inlining lets Vite handle those imports.
          inline: [/@platejs\//, /katex/],
        },
      },
    },
  }),
);
