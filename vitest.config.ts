import { defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: "node",
      include: ["src/**/*.test.{ts,tsx}"],
      setupFiles: ["src/test/setup-dom.ts"],
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
