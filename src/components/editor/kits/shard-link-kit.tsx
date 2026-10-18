import { toPlatePlugin } from "platejs/react";

import { BaseShardLinkPlugin } from "@/lib/markdown-shard-links";

export const ShardLinkKit = [toPlatePlugin(BaseShardLinkPlugin)];
