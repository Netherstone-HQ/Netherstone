"use client";

import { toPlatePlugin } from "platejs/react";

import { RawBlockElement } from "@/components/ui/raw-block-node";
import { BaseRawBlockPlugin } from "@/lib/markdown-raw-blocks";

export const RawBlockKit = [
  toPlatePlugin(BaseRawBlockPlugin).withComponent(RawBlockElement),
];
