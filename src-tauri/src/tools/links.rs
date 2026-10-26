//! Links between shards: what links where, what's broken, and fixing it.

use super::edits::{change, edit_shard};
use super::{Caller, Page, ToolError, ToolResult, Vault};
use crate::db::parser::{LinkType, parse_markdown};
use crate::markdown_text::TextPart;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const LINKS: &str = "Links between shards. backlinks lists the shards that link \
to a shard, each with the sentence the link is in. outgoing lists where a \
shard's links go and whether each works. broken lists links to shards that \
don't exist: in one shard, or in the whole vault when path is left out. Fix \
one with fix_link.";

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum LinksKind {
    Backlinks,
    Outgoing,
    Broken,
}

#[derive(Deserialize, JsonSchema)]
pub struct LinksParams {
    kind: LinksKind,
    /// The shard, vault-relative. Needed for backlinks and outgoing.
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    cursor: Option<String>,
    #[serde(default)]
    limit: Option<usize>,
}

#[derive(Serialize)]
pub struct Link {
    /// The shard the link is in.
    #[serde(skip_serializing_if = "Option::is_none")]
    from: Option<String>,
    /// Where it points: a shard's path, a name, or a web address.
    #[serde(skip_serializing_if = "Option::is_none")]
    to: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    works: Option<bool>,
}

#[derive(Serialize)]
pub struct LinkPage {
    links: Vec<Link>,
    #[serde(skip_serializing_if = "Option::is_none")]
    next_cursor: Option<String>,
}

fn sentence(parts: Option<Vec<TextPart>>) -> Option<String> {
    parts.map(|parts| parts.into_iter().map(|part| part.text).collect())
}

/// A link's target as the tools name it: vault-relative when it's a path in
/// the vault.
fn shown_target(vault: &Vault, target: &str) -> String {
    let path = Path::new(target);
    if path.is_absolute() && crate::vault_access::is_within(&vault.root, path) {
        vault.relative(path)
    } else {
        target.to_string()
    }
}

/// Whether a shard is named `name` (without `.md`) anywhere in the vault.
fn shard_named(vault: &Vault, conn: &rusqlite::Connection, name: &str) -> ToolResult<bool> {
    let file = format!("{}.md", name.trim_end_matches(".md"));
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM files WHERE vault_path = ?1 AND name = ?2 COLLATE NOCASE)",
        rusqlite::params![crate::db::attachments::vault_key(&vault.root), file],
        |row| row.get(0),
    )?)
}

pub fn links(vault: &Vault, _: &Caller, params: LinksParams) -> ToolResult<LinkPage> {
    let page = Page::new(params.cursor.as_deref(), params.limit)?;
    let shard = params.path.as_deref().map(|path| vault.shard(path)).transpose()?;
    let conn = vault.index()?;
    let links = match (params.kind, &shard) {
        (LinksKind::Backlinks, Some(shard)) => {
            crate::db::queries::get_backlinks(&conn, &vault.root, &shard.to_string_lossy())?
                .into_iter()
                .map(|backlink| Link {
                    from: Some(vault.relative(Path::new(&backlink.path))),
                    to: None,
                    text: sentence(backlink.excerpt),
                    works: None,
                })
                .collect()
        }
        (LinksKind::Outgoing, Some(shard)) => {
            let markdown = super::edits::read_text(shard)?;
            let mut links = Vec::new();
            for link in parse_markdown(&markdown).links {
                let target = crate::db::indexer::resolve_link_target(link.link_type, &link.target, shard);
                let works = match link.link_type {
                    LinkType::Internal if target.to_lowercase().ends_with(".md") => {
                        Some(Path::new(&target).is_file())
                    }
                    LinkType::Mention => Some(Path::new(&target).is_file() || shard_named(vault, &conn, &target)?),
                    _ => None,
                };
                links.push(Link {
                    from: None,
                    to: Some(shown_target(vault, &target)),
                    text: link.text,
                    works,
                });
            }
            links
        }
        (LinksKind::Broken, _) => crate::db::data::get_broken_links(&conn, &vault.root)?
            .into_iter()
            .filter(|broken| shard.as_ref().is_none_or(|shard| Path::new(&broken.path) == shard.as_path()))
            .map(|broken| Link {
                from: Some(vault.relative(Path::new(&broken.path))),
                to: Some(shown_target(vault, &broken.target)),
                text: Some(broken.text),
                works: Some(false),
            })
            .collect(),
        (_, None) => return Err(ToolError("backlinks and outgoing need the shard's path".to_string())),
    };
    let (links, next_cursor) = page.of(links);
    Ok(LinkPage { links, next_cursor })
}

// ── fix_link ─────────────────────────────────────────────────────────────────

pub const FIX_LINK: &str = "Point a link in a shard at another shard, usually a \
broken one at the shard it meant. link is where it points now, as links shows \
it (its to), and to is the shard it should point at. Every link in the shard \
to the same place is fixed.";

#[derive(Deserialize, JsonSchema)]
pub struct FixLinkParams {
    /// The shard the link is in, vault-relative.
    path: String,
    /// Where the link points now, as the links tool shows it.
    link: String,
    /// The shard it should point at, vault-relative.
    to: String,
    /// A short line on what you changed, shown in History.
    #[serde(default)]
    summary: Option<String>,
}

#[derive(Serialize)]
pub struct Fixed {
    path: String,
    now_points_to: String,
}

pub fn fix_link(vault: &Vault, caller: &Caller, params: FixLinkParams) -> ToolResult<Fixed> {
    let shard = vault.shard(&params.path)?;
    let target = vault.shard(&params.to)?;
    // A path is resolved in the vault, as the links tool shows it; a bare
    // name is a mention by name.
    let link = params.link.trim();
    let old = if link.contains('/') || link.to_lowercase().ends_with(".md") {
        let old: PathBuf = if Path::new(link).is_absolute() { PathBuf::from(link) } else { vault.root.join(link) };
        old.to_string_lossy().into_owned()
    } else {
        link.to_string()
    };
    let moved = [crate::shard_links::MovedShard {
        old,
        new: target.to_string_lossy().into_owned(),
    }];
    let file = shard.to_string_lossy().into_owned();

    change(vault, caller, params.summary.as_deref(), &[shard.clone()], || {
        edit_shard(vault, &shard, |markdown| {
            crate::shard_links::rewrite_moved_links(&markdown, &file, &file, &moved).ok_or_else(|| {
                ToolError(format!("{} has no link to '{}'. Check it with links outgoing.", params.path, link))
            })
        })?;
        Ok((
            Fixed {
                path: vault.relative(&shard),
                now_points_to: vault.relative(&target),
            },
            Vec::new(),
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_broken_link_is_pointed_at_the_right_shard() {
        let vault = super::super::tests::vault("tools-fix-link");
        std::fs::create_dir_all(vault.root.join("Projects")).unwrap();
        std::fs::write(vault.root.join("Projects/Plan.md"), "The plan").unwrap();
        let today = vault.root.join("Today.md");
        std::fs::write(&today, "See [Plan](Plan.md) and [Plan](Plan.md#steps).\n").unwrap();
        let caller = Caller { app: "Goose".into() };

        let fixed = fix_link(
            &vault,
            &caller,
            FixLinkParams {
                path: "Today.md".into(),
                link: "Plan.md".into(),
                to: "Projects/Plan.md".into(),
                summary: None,
            },
        )
        .unwrap();
        assert_eq!(fixed.now_points_to, "Projects/Plan.md");
        assert_eq!(
            std::fs::read_to_string(&today).unwrap(),
            "See [Plan](Projects/Plan.md) and [Plan](Projects/Plan.md#steps).\n"
        );
    }
}
