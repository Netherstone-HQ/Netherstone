import { AlignKit } from "./kits/align-kit";
import { BasicBlocksKit } from "./kits/basic-blocks-kit";
import { BasicMarksKit } from "./kits/basic-marks-kit";
import { BlockMenuKit } from "./kits/block-menu-kit";
import { BlockPlaceholderKit } from "./kits/block-placeholder-kit";
import { CalloutKit } from "./kits/callout-kit";
import { CodeBlockKit } from "./kits/code-block-kit";
import { ColumnKit } from "./kits/column-kit";
import { DateKit } from "./kits/date-kit";
import { DndKit } from "./kits/dnd-kit";
import { EmojiKit } from "./kits/emoji-kit";
import { ExitBreakKit } from "./kits/exit-break-kit";
import { FixedToolbarKit } from "./kits/fixed-toolbar-kit";
import { FloatingToolbarKit } from "./kits/floating-toolbar-kit";
import { FontKit } from "./kits/font-kit";
import { FrontMatterKit } from "./kits/front-matter-kit";
import { LineHeightKit } from "./kits/line-height-kit";
import { LinkKit } from "./kits/link-kit";
import { ListKit } from "./kits/list-kit";
import { MarkdownKit } from "./kits/markdown-kit";
import { MathKit } from "./kits/math-kit";
import { MediaKit } from "./kits/media-kit";
import { MentionKit } from "./kits/mention-kit";
import { RawBlockKit } from "./kits/raw-block-kit";
import { ShardLinkKit } from "./kits/shard-link-kit";
import { ShortcutsKit } from "./kits/shortcuts-kit";
import { SlashKit } from "./kits/slash-kit";
import { TableKit } from "./kits/table-kit";
import { TocKit } from "./kits/toc-kit";
import { ToggleKit } from "./kits/toggle-kit";
import { TrailingLineKit } from "./kits/trailing-line-kit";

import { AutoformatKit } from "./kits/autoformat-kit";

export const EditorKit = [
  ...ShortcutsKit, // first, so its keys run before other key handling
  ...AlignKit,
  ...AutoformatKit, // Markdown shortcuts as you type
  ...BasicBlocksKit, // headings, quotes and dividers
  ...BasicMarksKit, // bold, italic, code, highlight and the other marks
  ...BlockMenuKit, // a block's right-click menu
  ...BlockPlaceholderKit,
  ...CalloutKit,
  ...CodeBlockKit,
  ...ColumnKit,
  ...DateKit,
  ...DndKit,
  ...EmojiKit,
  ...ExitBreakKit,
  ...FixedToolbarKit,
  ...FloatingToolbarKit,
  ...FontKit, // text color, background, size and font
  ...FrontMatterKit, // YAML front matter, kept as it is in the file
  ...LineHeightKit,
  ...LinkKit,
  ...ListKit,
  ...MarkdownKit,
  ...MathKit,
  ...MediaKit,
  ...MentionKit, // @ links between shards
  ...RawBlockKit, // HTML the editor has no block for, kept as written
  ...ShardLinkKit, // the shard path that @ links are saved relative to
  ...SlashKit,
  ...TableKit,
  ...TocKit,
  ...ToggleKit,
  ...TrailingLineKit, // an empty line always ends the shard
];
