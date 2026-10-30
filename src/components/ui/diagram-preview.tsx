"use client";

import * as React from "react";

import { useThemeMode } from "@/components/theme/theme-provider";
import { useDebounce } from "@/hooks/use-debounce";
import { renderDiagram } from "@/lib/mermaid-diagram";
import { useSettingsStore } from "@/store/settings";

type Drawn = { svg: string; error?: undefined } | { svg?: undefined; error: string };

/**
 * The diagram a Mermaid code block's code draws, shown under the code and
 * redrawn as it is typed and when the theme changes.
 */
export function DiagramPreview({ code }: { code: string }) {
  const debouncedCode = useDebounce(code);
  const mode = useThemeMode();
  const theme = useSettingsStore((s) => s.theme);
  const [drawn, setDrawn] = React.useState<Drawn | null>(null);

  React.useEffect(() => {
    if (!debouncedCode.trim()) {
      setDrawn(null);
      return;
    }

    let current = true;
    renderDiagram(debouncedCode, mode === "dark").then(
      (svg) => current && setDrawn({ svg }),
      (error: unknown) =>
        current &&
        setDrawn({ error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      current = false;
    };
  }, [debouncedCode, mode, theme]);

  if (!code.trim() || !drawn) return null;

  return (
    <div
      className="border-t border-border/60 p-4 select-none"
      contentEditable={false}
    >
      {drawn.svg !== undefined ? (
        <div
          role="img"
          aria-label="Diagram"
          className="flex justify-center [&_svg]:h-auto [&_svg]:max-w-full"
          // Mermaid's own output, sanitized by its strict security level.
          dangerouslySetInnerHTML={{ __html: drawn.svg }}
        />
      ) : (
        <div className="text-muted-foreground text-sm">
          <p>This diagram can't be drawn.</p>
          <pre className="mt-2 overflow-x-auto font-mono text-xs whitespace-pre-wrap">
            {drawn.error}
          </pre>
        </div>
      )}
    </div>
  );
}
