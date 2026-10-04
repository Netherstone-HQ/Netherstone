import { AlignKit } from "./kits/align-kit";
import { BasicBlocksKit } from "./kits/basic-blocks-kit";
import { BasicMarksKit } from "./kits/basic-marks-kit";
import { BlockMenuKit } from "./kits/block-menu-kit";
import { BlockPlaceholderKit } from "./kits/block-placeholder-kit";
import { CalloutKit } from "./kits/callout-kit";
import { CodeBlockKit } from "./kits/code-block-kit";
import { ColumnKit } from "./kits/column-kit";
import { CommentKit } from "./kits/comment-kit";
import { DateKit } from "./kits/date-kit";
import { DiscussionKit } from "./kits/discussion-kit";
import { DndKit } from "./kits/dnd-kit";
import { EmojiKit } from "./kits/emoji-kit";
import { ExitBreakKit } from "./kits/exit-break-kit";
import { FixedToolbarKit } from "./kits/fixed-toolbar-kit";
import { FloatingToolbarKit } from "./kits/floating-toolbar-kit";
import { FontKit } from "./kits/font-kit";
import { LineHeightKit } from "./kits/line-height-kit";
import { LinkKit } from "./kits/link-kit";
import { ListKit } from "./kits/list-kit";
import { MarkdownKit } from "./kits/markdown-kit";
import { MathKit } from "./kits/math-kit";
import { MediaKit } from "./kits/media-kit";
import { MentionKit } from "./kits/mention-kit";
import { SlashKit } from "./kits/slash-kit";
import { SuggestionKit } from "./kits/suggestion-kit";
import { TableKit } from "./kits/table-kit";
import { TocKit } from "./kits/toc-kit";
import { ToggleKit } from "./kits/toggle-kit";

import { AutoformatKit } from "./kits/autoformat-kit";

export const EditorKit = [
  // TrailingBlockPlugin, // handles trailing but is redundant
  ...AlignKit,
  ...AutoformatKit, // enables markdown formatting
  ...BasicBlocksKit, // for headings, blockquote and diviers
  ...BasicMarksKit, // for bold, italic, underline, strikethrough, code, subscript, superscript, kbd and highlight
  ...BlockMenuKit, // right clicking on a block brings up a menu
  ...BlockPlaceholderKit, // shows "type something..."
  ...CalloutKit, // marked for customization or fixing emojis
  ...CodeBlockKit,
  ...ColumnKit,
  ...CommentKit,
  ...DateKit,
  ...DiscussionKit,
  ...DndKit,
  ...EmojiKit, // need to fix for callouts or remove
  ...ExitBreakKit, // marked for testing - tested, is good, need to check why selecting from the toolbar unfocuses editor
  ...FixedToolbarKit,
  ...FloatingToolbarKit,
  ...FontKit, // marked for testing - using features besides font family (?) - okay this says it supports applying font styling and other things, not just family
  ...LineHeightKit,
  ...LinkKit,
  ...ListKit,
  ...MarkdownKit,
  ...MathKit,
  ...MediaKit, // marked for debug
  ...MentionKit, // marked for customization
  ...SlashKit,
  ...SuggestionKit,
  ...TableKit,
  ...TocKit,
  ...ToggleKit, // tested and it works
];
