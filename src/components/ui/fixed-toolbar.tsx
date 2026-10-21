"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

import { Toolbar } from "./toolbar";

export function FixedToolbar(props: React.ComponentProps<typeof Toolbar>) {
  return (
    <div className="sticky top-0 left-0 z-30 h-toolbar rounded-t-lg border-b border-b-border bg-background">
      <Toolbar
        {...props}
        className={cn("h-full w-full justify-between px-1", props.className)}
      />
    </div>
  );
}
