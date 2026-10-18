"use client";

import { toPlatePlugin } from "platejs/react";

import { FrontMatterElement } from "@/components/ui/front-matter-node";
import { BaseFrontMatterPlugin } from "@/lib/markdown-front-matter";

export const FrontMatterKit = [
  toPlatePlugin(BaseFrontMatterPlugin).withComponent(FrontMatterElement),
];
