"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { useSettingsStore } from "@/store/settings";

import { Toolbar } from "./toolbar";

export function FixedToolbar(props: React.ComponentProps<typeof Toolbar>) {
  const pinned = useSettingsStore((s) => s.pinToolbar);
  return (
    <div
      className={cn(
        "relative z-30 h-toolbar rounded-t-lg border-b border-b-border bg-background",
        pinned && "sticky top-0 left-0",
      )}
    >
      <Toolbar
        {...props}
        className={cn("h-full w-full justify-between px-1", props.className)}
      />
    </div>
  );
}
