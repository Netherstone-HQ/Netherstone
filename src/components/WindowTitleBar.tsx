import { useEffect, useMemo, useState } from "react";
import {
  MinusIcon,
  SquareIcon,
  XIcon,
} from "@phosphor-icons/react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { cn } from "@/lib/utils";
import { NetherstoneMark } from "@/components/brand/NetherstoneMark";

/**
 * The custom title bar. `bare` drops the name and background for full-window
 * screens like onboarding, keeping only the drag area and window buttons.
 */
export function WindowTitleBar({ bare = false }: { bare?: boolean }) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [isTauriWindow, setIsTauriWindow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) {
      return;
    }

    setIsTauriWindow(true);

    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    void appWindow
      .isMaximized()
      .then(setIsMaximized)
      .catch(() => {});

    appWindow
      .onResized(async () => {
        try {
          setIsMaximized(await appWindow.isMaximized());
        } catch {
          // no-op
        }
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, []);

  const controls = useMemo(
    () => [
      {
        label: "Minimize",
        onClick: () => {
          if (!isTauriWindow) return;
          void getCurrentWindow().minimize();
        },
        icon: <MinusIcon className="size-4" weight="bold" />,
      },
      {
        label: isMaximized ? "Restore" : "Maximize",
        onClick: () => {
          if (!isTauriWindow) return;
          void getCurrentWindow().toggleMaximize();
        },
        icon: <SquareIcon className="size-3.5" weight="bold" />,
      },
      {
        label: "Close",
        onClick: () => {
          if (!isTauriWindow) return;
          void getCurrentWindow().close();
        },
        icon: <XIcon className="size-4" weight="bold" />,
        destructive: true,
      },
    ],
    [isMaximized, isTauriWindow],
  );

  if (!isTauriWindow) {
    return null;
  }

  return (
    <div
      data-tauri-drag-region
      onPointerDown={(event) => {
        if (
          !isTauriWindow ||
          event.button !== 0 ||
          (event.target as HTMLElement).closest(".tauri-no-drag")
        ) {
          return;
        }

        void getCurrentWindow()
          .startDragging()
          .catch(() => {});
      }}
      className={cn(
        "flex h-9 shrink-0 items-center justify-between pl-3",
        !bare &&
          "border-b bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/80",
      )}
    >
      <div
        data-tauri-drag-region
        className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground"
      >
        {bare ? null : (
          <>
            <NetherstoneMark className="size-4.5 shrink-0" />
            <span className="truncate font-medium text-foreground">
              Netherstone
            </span>
          </>
        )}
      </div>

      <div className="flex h-full items-stretch">
        {controls.map(({ label, onClick, icon, destructive }) => (
          <button
            key={label}
            type="button"
            onClick={onClick}
            aria-label={label}
            title={label}
            data-tauri-drag-region={false}
            className={cn(
              "tauri-no-drag flex w-11 items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground",
              destructive &&
                "hover:bg-destructive hover:text-white dark:hover:text-white",
            )}
          >
            {icon}
          </button>
        ))}
      </div>
    </div>
  );
}
