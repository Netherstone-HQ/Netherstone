//! How shards are written, for AI apps: the whole guide is a resource, and
//! the tools that write shards carry the short form in their descriptions,
//! so what an AI writes reads in Netherstone as it would from the editor.

/// Where the whole guide is read from.
pub const URI: &str = "netherstone://guide/shard-format";

/// The rules every write follows, for the tool descriptions.
const ESSENTIALS: &str = "\
Shards are plain Markdown (GitHub flavored). Link another shard with a normal \
Markdown link to its path relative to this shard's folder, spaces as %20: \
[Plan](../Projects/Plan.md). Tags are #words in the text. Keep the hidden \
<!-- netherstone: ... --> and <!-- netherstone chart: ... --> comments and any \
HTML as they are. The full guide is the resource netherstone://guide/shard-format.";

/// `description` with the rules for writing shards after it.
pub fn with_format(description: &str) -> String {
    format!("{}\n\n{}", description, ESSENTIALS)
}

/// The whole guide.
pub const GUIDE: &str = "\
# Writing shards for Netherstone

A Netherstone vault is a folder. Shards are Markdown files (.md), drawings \
are Excalidraw files (.excalidraw), and pictures and files that shards show \
live in the _attachments folder at the top of the vault. Everything is a \
plain file, so other apps can read it too.

## Markdown

Shards are GitHub-flavored Markdown: headings, paragraphs, **bold**, \
*italic*, ~~strikethrough~~, `code`, lists, task lists (- [ ] and - [x]), \
quotes, code blocks with a language, tables and horizontal rules. Math is \
written $inline$ or as a $$ block $$.

## Links to other shards

A link to another shard shows in Netherstone as an @ link. Write it as an \
ordinary Markdown link to the shard's path relative to the folder of the \
shard it's in, with spaces and other special characters percent-encoded:

    [Plan](Plan.md)
    [Weekly review](../Reviews/Weekly%20review.md)

Netherstone keeps these working when shards move. Use the links tool to \
find broken ones and fix_link to repair them.

## Tags

A tag is a word starting with # in the text, like #reading. It needs at \
least one letter (#3 is a number). Tags have no list of their own: adding \
one is writing it, removing one is taking it out of the text.

## Tables and charts

Tables are pipe tables. A hidden comment right above a table keeps its \
column widths, merged cells and colors:

    <!-- netherstone: widths: 120px, 40%; ... -->

Leave it as it is. A chart is a comment right under the table it's drawn \
from, naming its kind (bar or line), the column along the bottom (x), the \
columns with the numbers (y, up to three) and a title:

    | Week | km | Runs |
    | ---- | -- | ---- |
    | 1    | 12 | 3    |

    <!-- netherstone chart: bar; x Week; y km, Runs; title km by week -->

The tables tool adds charts for you.

## Toggles

A toggle (a block that opens and closes) is written as details, with the \
blank lines kept:

    <details>
    <summary>Title</summary>

    Body as normal Markdown.

    </details>

## Layout

Alignment, line height and indent are a <div align=\"...\" style=\"...\"> \
around the blocks they apply to, and extra empty lines are <br>. Keep such \
HTML as it is when editing around it.

## Pictures and drawings

A picture is a Markdown image of a file in _attachments, by its path from \
the shard: ![Trip](../_attachments/Trip.jpg). Tools can't add new files \
there.

A drawing shows in a shard as an image tag with a data-excalidraw attribute \
naming the drawing. Don't write one by hand: create the drawing with \
edit_drawing, then use its embed action, and Netherstone makes the picture \
the next time the shard is opened.

## Front matter

A YAML block between --- lines at the very top of a shard is kept as it is.

## Changes and History

Every change a tool makes saves the shard as it was first, and notes the \
app that changed it, so anything can be undone from the shard's History in \
Netherstone (or with the history tool). Tools never delete shards, drawings \
or folders. Give each change a short summary of what it did, like \
\"Fixed 3 broken links\": it's shown in History.
";
