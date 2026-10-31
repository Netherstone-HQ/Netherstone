"use client";

import * as React from "react";

import { useThemeMode } from "@/components/theme/theme-provider";
import { useDebounce } from "@/hooks/use-debounce";
import { useNearScreen } from "@/hooks/useNearScreen";
import { renderDiagram } from "@/lib/mermaid-diagram";
import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings";

type Drawn = { svg: string; error?: undefined } | { svg?: undefined; error: string };

/**
 * The diagram a Mermaid code block's code draws, redrawn as it is typed and
 * when the theme changes. It's drawn only once it's near the screen, and a
 * change while it's away is drawn when it comes back, so a shard with many
 * diagrams doesn't draw them all on open.
 */
export function DiagramPreview({
  code,
  belowCode,
}: {
  code: string;
  /** Whether the code shows above it. */
  belowCode: boolean;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const isNear = useNearScreen(ref);
  const debouncedCode = useDebounce(code);
  const mode = useThemeMode();
  const theme = useSettingsStore((s) => s.theme);
  const [drawn, setDrawn] = React.useState<Drawn | null>(null);
  /** What the drawing on show was drawn from. */
  const drawnFrom = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!debouncedCode.trim()) {
      drawnFrom.current = null;
      setDrawn(null);
      return;
    }
    const from = `${mode}\n${theme}\n${debouncedCode}`;
    if (!isNear || drawnFrom.current === from) return;

    let current = true;
    renderDiagram(debouncedCode, mode === "dark").then(
      (svg) => {
        if (!current) return;
        drawnFrom.current = from;
        setDrawn({ svg });
      },
      (error: unknown) => {
        if (!current) return;
        drawnFrom.current = from;
        setDrawn({ error: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      current = false;
    };
  }, [debouncedCode, isNear, mode, theme]);

  return (
    <div
      ref={ref}
      className={cn(
        "select-none",
        code.trim() && drawn && ["p-4", belowCode ? "border-t border-border/60" : "pt-9"],
      )}
      contentEditable={false}
    >
      {!code.trim() || !drawn ? null : drawn.svg !== undefined ? (
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
