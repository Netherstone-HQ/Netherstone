//! Writing shards and folders: creating, editing, moving and renaming.
//! Nothing here deletes, and each change is saved in History first.

use super::edits::{change, edit_shard as edit_under_lock};
use super::read::find_section;
use super::{Caller, ToolError, ToolResult, Vault};
use crate::markdown_text::{has_letter, markdown_options, tags_in};
use pulldown_cmark::{Event, Parser};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize)]
pub struct Written {
    path: String,
}

/// `name` as a file name in a folder: one part, no slashes.
fn file_name(name: &str) -> ToolResult<&str> {
    let name = name.trim();
    let mut parts = Path::new(name).components();
    match (parts.next(), parts.next()) {
        (Some(std::path::Component::Normal(_)), None) if !name.starts_with('.') => Ok(name),
        _ => Err(ToolError(format!("'{}' can't be used as a name", name))),
    }
}

fn folder_or_root(vault: &Vault, folder: Option<&str>) -> ToolResult<PathBuf> {
    match folder.filter(|folder| !folder.trim().is_empty()) {
        Some(folder) => vault.resolve(folder),
        None => Ok(vault.root.clone()),
    }
}

// ── create_shard ─────────────────────────────────────────────────────────────

pub const CREATE_SHARD: &str = "Create a new shard with the Markdown given. Its \
folder is made if needed. When the name is taken, the shard gets the next free \
one (Plan_1.md), and the path it got is returned.";

#[derive(Deserialize, JsonSchema)]
pub struct CreateShardParams {
    /// The folder to put it in, vault-relative. Leave out for the top of the vault.
    #[serde(default)]
    folder: Option<String>,
    /// The shard's name, with or without .md.
    name: String,
    /// Its Markdown.
    content: String,
    /// A short line on what you made, shown in History.
    #[serde(default)]
    summary: Option<String>,
}

pub fn create_shard(vault: &Vault, caller: &Caller, params: CreateShardParams) -> ToolResult<Written> {
    let name = file_name(&params.name)?;
    let name = name.strip_suffix(".md").unwrap_or(name).trim();
    let folder = folder_or_root(vault, params.folder.as_deref())?;
    let wanted = folder.join(format!("{}.md", file_name(name)?));

    change(vault, caller, params.summary.as_deref(), &[], || {
        let writes = crate::locks::vault_writes()?;
        let path = crate::import::prepare_new_shard(&vault.root, &wanted)?;
        crate::write_shard(&writes, &vault.root, &path.to_string_lossy(), &params.content)?;
        Ok((Written { path: vault.relative(&path) }, vec![path]))
    })
}

// ── edit_shard ───────────────────────────────────────────────────────────────

pub const EDIT_SHARD: &str = "Change part of a shard; the rest stays exactly as it \
is. append adds text at the end. insert_under_heading adds text at the end of a \
heading's section. replace swaps text for other text, and the text must be in \
the shard exactly once (read the shard first and copy it). add_tag and \
remove_tag add or take out a #tag. To rewrite a whole section, replace it.";

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum EditAction {
    Append,
    InsertUnderHeading,
    Replace,
    AddTag,
    RemoveTag,
}

#[derive(Deserialize, JsonSchema)]
pub struct EditShardParams {
    /// The shard, vault-relative.
    path: String,
    action: EditAction,
    /// For append and insert_under_heading: the Markdown to add.
    #[serde(default)]
    text: Option<String>,
    /// For insert_under_heading: the heading's text.
    #[serde(default)]
    heading: Option<String>,
    /// For replace: the exact text to find.
    #[serde(default)]
    find: Option<String>,
    /// For replace: what it becomes. Empty takes it out.
    #[serde(default)]
    replace_with: Option<String>,
    /// For add_tag and remove_tag, with or without the #.
    #[serde(default)]
    tag: Option<String>,
    /// A short line on what you changed, shown in History.
    #[serde(default)]
    summary: Option<String>,
}

fn needed<'a>(value: &'a Option<String>, name: &str, action: &str) -> ToolResult<&'a str> {
    value
        .as_deref()
        .ok_or_else(|| ToolError(format!("{} needs {}", action, name)))
}

/// `markdown` with `text` added as its own block at `at`.
fn insert_block(markdown: &str, at: usize, text: &str) -> String {
    let (before, after) = markdown.split_at(at);
    let before = before.trim_end_matches(['\n', '\r', ' ']);
    let text = text.trim_matches('\n');
    let mut out = String::with_capacity(markdown.len() + text.len() + 4);
    if !before.is_empty() {
        out.push_str(before);
        out.push_str("\n\n");
    }
    out.push_str(text);
    out.push('\n');
    if !after.trim().is_empty() {
        out.push('\n');
        out.push_str(after.trim_start_matches(['\n', '\r']));
    }
    out
}

/// A tag as written after its `#`, checked.
fn tag_name(tag: &str) -> ToolResult<String> {
    let tag = tag.trim().trim_start_matches('#');
    if tag.is_empty() || tag.chars().any(char::is_whitespace) || !has_letter(tag) {
        return Err(ToolError(format!("'{}' can't be a tag: one word, with a letter", tag)));
    }
    Ok(tag.to_string())
}

/// Where `#tag` is in the text of `markdown`, not in code or links, as byte
/// ranges of the `#` and the tag.
fn tag_ranges(markdown: &str, tag: &str) -> Vec<std::ops::Range<usize>> {
    let mut found = Vec::new();
    for (event, range) in Parser::new_ext(markdown, markdown_options()).into_offset_iter() {
        if let Event::Text(_) = event {
            let source = &markdown[range.clone()];
            for (at, name) in tags_in(source) {
                if name.eq_ignore_ascii_case(tag) {
                    let start = range.start + at;
                    found.push(start..start + 1 + name.len());
                }
            }
        }
    }
    found.dedup();
    found
}

fn add_tag(markdown: String, tag: &str) -> String {
    if !tag_ranges(&markdown, tag).is_empty() {
        return markdown;
    }
    // Next to the tags on the last line, when it holds only tags.
    let trimmed = markdown.trim_end();
    let last_line = trimmed.rsplit('\n').next().unwrap_or("");
    let only_tags = !last_line.trim().is_empty()
        && last_line.split_whitespace().count() == tags_in(last_line).count();
    if only_tags {
        format!("{} #{}\n", trimmed, tag)
    } else {
        insert_block(&markdown, markdown.len(), &format!("#{}", tag))
    }
}

fn remove_tag(markdown: String, tag: &str) -> ToolResult<String> {
    let ranges = tag_ranges(&markdown, tag);
    if ranges.is_empty() {
        return Err(ToolError(format!("The shard has no #{}", tag)));
    }
    let mut out = markdown.clone();
    for range in ranges.into_iter().rev() {
        // With the space before it, so no gap is left behind.
        let start = if out[..range.start].ends_with(' ') { range.start - 1 } else { range.start };
        out.replace_range(start..range.end, "");
    }
    Ok(out)
}

fn edit(markdown: String, params: &EditShardParams) -> ToolResult<String> {
    match params.action {
        EditAction::Append => {
            let text = needed(&params.text, "text", "append")?;
            Ok(insert_block(&markdown, markdown.len(), text))
        }
        EditAction::InsertUnderHeading => {
            let text = needed(&params.text, "text", "insert_under_heading")?;
            let heading = needed(&params.heading, "heading", "insert_under_heading")?;
            let section = find_section(&markdown, heading)?;
            Ok(insert_block(&markdown, section.range.end, text))
        }
        EditAction::Replace => {
            let find = needed(&params.find, "find", "replace")?;
            if find.is_empty() {
                return Err(ToolError("replace needs the text to find".to_string()));
            }
            match markdown.matches(find).count() {
                1 => Ok(markdown.replacen(find, params.replace_with.as_deref().unwrap_or(""), 1)),
                0 => Err(ToolError("That text isn't in the shard. Read it again and copy the text exactly.".to_string())),
                n => Err(ToolError(format!("That text is in the shard {} times. Give more of it, so it's there once.", n))),
            }
        }
        EditAction::AddTag => Ok(add_tag(markdown, &tag_name(needed(&params.tag, "tag", "add_tag")?)?)),
        EditAction::RemoveTag => remove_tag(markdown, &tag_name(needed(&params.tag, "tag", "remove_tag")?)?),
    }
}

pub fn edit_shard(vault: &Vault, caller: &Caller, params: EditShardParams) -> ToolResult<Written> {
    let path = vault.shard(&params.path)?;
    change(vault, caller, params.summary.as_deref(), &[path.clone()], || {
        edit_under_lock(vault, &path, |markdown| edit(markdown, &params))?;
        Ok((Written { path: vault.relative(&path) }, Vec::new()))
    })
}

// ── move ─────────────────────────────────────────────────────────────────────

pub const MOVE: &str = "Move a shard, drawing or folder to another folder, rename \
it, or both. Links to the shards it holds are rewritten everywhere, so they \
keep working. Nothing is ever replaced: a name that's taken is refused.";

#[derive(Deserialize, JsonSchema)]
pub struct MoveParams {
    /// What to move, vault-relative.
    path: String,
    /// The folder to move it into. Use "" for the top of the vault.
    #[serde(default)]
    to_folder: Option<String>,
    /// Its new name. A shard or drawing keeps its extension when you leave it out.
    #[serde(default)]
    new_name: Option<String>,
    /// A short line on what you changed, shown in History.
    #[serde(default)]
    summary: Option<String>,
}

/// The shards and drawings at `path` or inside it.
fn documents_at(path: &Path) -> Vec<PathBuf> {
    if !path.is_dir() {
        return vec![path.to_path_buf()];
    }
    fn walk(nodes: &[crate::vault::FileNode], out: &mut Vec<PathBuf>) {
        for node in nodes {
            match &node.children {
                Some(children) => walk(children, out),
                None => out.push(PathBuf::from(&node.path)),
            }
        }
    }
    let mut found = Vec::new();
    walk(&crate::vault::scan_dir(path), &mut found);
    found
}

/// Whether another vault is somewhere inside `folder`.
fn holds_another_vault(folder: &Path) -> bool {
    std::fs::read_dir(folder).into_iter().flatten().flatten().any(|entry| {
        let path = entry.path();
        entry.file_type().is_ok_and(|kind| kind.is_dir())
            && crate::vault::is_scanned_name(&entry.file_name().to_string_lossy())
            && (crate::sync::state::has_vault_marker(&path) || holds_another_vault(&path))
    })
}

pub fn move_path(vault: &Vault, caller: &Caller, params: MoveParams) -> ToolResult<Written> {
    let source = vault.resolve(&params.path)?;
    if source == vault.root || !source.exists() {
        return Err(ToolError(format!("There's nothing to move at '{}'", params.path)));
    }
    if holds_another_vault(&source) {
        return Err(ToolError(format!("'{}' has another vault inside it, so it stays where it is", params.path)));
    }
    let destination = params.to_folder.as_deref().map(|folder| folder_or_root(vault, Some(folder))).transpose()?;
    let new_name = params.new_name.as_deref().map(file_name).transpose()?.map(str::to_string);
    if destination.is_none() && new_name.is_none() {
        return Err(ToolError("Give to_folder, new_name, or both".to_string()));
    }

    // What changes: the files moved, and the shards linking to them.
    let moved = documents_at(&source);
    let conn = vault.index()?;
    let shards: Vec<_> = moved
        .iter()
        .filter(|path| crate::vault::is_markdown_path(path))
        .map(|path| crate::db::queries::LinkedShard::new(&path.to_string_lossy()))
        .collect();
    let mut touched = moved.clone();
    touched.extend(
        crate::db::queries::files_linking_to_any(&conn, &vault.root, &shards)?
            .into_iter()
            .map(PathBuf::from),
    );

    change(vault, caller, params.summary.as_deref(), &touched, || {
        let mut at = source.to_string_lossy().into_owned();
        if let Some(destination) = &destination {
            at = crate::move_path(&vault.root, &at, &destination.to_string_lossy())?;
        }
        if let Some(name) = new_name {
            at = crate::rename_path(&vault.root, &at, name)?;
        }
        let at = PathBuf::from(at);
        Ok((Written { path: vault.relative(&at) }, documents_at(&at)))
    })
}

// ── create_folder ────────────────────────────────────────────────────────────

pub const CREATE_FOLDER: &str = "Create a folder in the vault.";

#[derive(Deserialize, JsonSchema)]
pub struct CreateFolderParams {
    /// The folder to make it in, vault-relative. Leave out for the top of the vault.
    #[serde(default)]
    parent: Option<String>,
    name: String,
}

pub fn create_folder(vault: &Vault, _: &Caller, params: CreateFolderParams) -> ToolResult<Written> {
    let parent = folder_or_root(vault, params.parent.as_deref())?;
    let _writes = crate::locks::vault_writes()?;
    let folder = crate::vault::create_folder(&parent, file_name(&params.name)?)?;
    Ok(Written { path: vault.relative(&folder) })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(action: EditAction) -> EditShardParams {
        EditShardParams {
            path: String::new(),
            action,
            text: None,
            heading: None,
            find: None,
            replace_with: None,
            tag: None,
            summary: None,
        }
    }

    #[test]
    fn text_goes_at_the_end_of_its_section() {
        let markdown = "# Plan\n\nFirst\n\n## Steps\n\nOne\n\n# Notes\n\nEnd\n".to_string();
        let mut insert = params(EditAction::InsertUnderHeading);
        insert.heading = Some("plan".into());
        insert.text = Some("Second".into());
        assert_eq!(
            edit(markdown, &insert).unwrap(),
            "# Plan\n\nFirst\n\n## Steps\n\nOne\n\nSecond\n\n# Notes\n\nEnd\n"
        );
    }

    #[test]
    fn replace_needs_the_text_exactly_once() {
        let mut replace = params(EditAction::Replace);
        replace.find = Some("cat".into());
        replace.replace_with = Some("dog".into());
        assert_eq!(edit("A cat.".into(), &replace).unwrap(), "A dog.");
        assert!(edit("A cat and a cat.".into(), &replace).is_err());
        assert!(edit("A bird.".into(), &replace).is_err());
    }

    #[test]
    fn tags_are_added_once_and_removed_from_text_only() {
        assert_eq!(add_tag("Notes\n\n#work\n".into(), "idea"), "Notes\n\n#work #idea\n");
        assert_eq!(add_tag("Notes\n".into(), "idea"), "Notes\n\n#idea\n");
        assert_eq!(add_tag("Has #idea.\n".into(), "idea"), "Has #idea.\n");
        assert_eq!(
            remove_tag("Read #book today #book\n\n`#book`\n".into(), "book").unwrap(),
            "Read today\n\n`#book`\n"
        );
        assert!(remove_tag("Nothing".into(), "book").is_err());
        assert!(tag_name("two words").is_err());
        assert!(tag_name("#3").is_err());
    }

    #[test]
    fn a_folder_with_another_vault_inside_stays_put() {
        let vault = super::super::tests::vault("tools-move-nested");
        let inner = vault.root.join("Projects/Inner");
        std::fs::create_dir_all(&inner).unwrap();
        crate::sync::state::load_or_create_record(&vault.sync_root, &inner).unwrap();
        let caller = Caller { app: "Goose".into() };

        let moved = move_path(
            &vault,
            &caller,
            MoveParams {
                path: "Projects".into(),
                to_folder: None,
                new_name: Some("Work".into()),
                summary: None,
            },
        );
        assert!(moved.is_err());
        assert!(inner.is_dir());
    }
}
