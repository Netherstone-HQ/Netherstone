//! Reading a link's address: a template on netherstone.app or a folder on
//! github.com, and nothing else.

use super::{Source, github, netherstone_app};

/// What a link starts with; the address follows.
pub const LINK_PREFIX: &str = "netherstone://open/";

/// Where a link points.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Address {
    /// `netherstone.app/templates/<id>`.
    Template { id: String },
    /// `github.com/<owner>/<repo>`, with what follows `/tree/` when given:
    /// the branch and then the folder, which only GitHub can tell apart, as
    /// a branch name can hold `/`.
    GitHub {
        owner: String,
        repo: String,
        tree: Vec<String>,
    },
}

impl Address {
    /// Reads a link, or just its address. Anything but the two known kinds
    /// is refused.
    pub fn parse(text: &str) -> Option<Self> {
        let text = text.trim();
        let text = strip_prefix_ignoring_case(text, LINK_PREFIX).unwrap_or(text);
        let text = strip_prefix_ignoring_case(text, "https://").unwrap_or(text);
        if text.contains(['?', '#', '\\']) {
            return None;
        }
        let segments = text
            .trim_end_matches('/')
            .split('/')
            .map(|segment| {
                let decoded = urlencoding::decode(segment).ok()?;
                let fine = !decoded.is_empty()
                    && decoded != "."
                    && decoded != ".."
                    && !decoded.contains(['/', '\\'])
                    && !decoded.chars().any(char::is_control);
                fine.then(|| decoded.into_owned())
            })
            .collect::<Option<Vec<String>>>()?;
        let (host, rest) = segments.split_first()?;
        let rest: Vec<&str> = rest.iter().map(String::as_str).collect();
        match (host.to_ascii_lowercase().as_str(), rest.as_slice()) {
            ("netherstone.app", ["templates", id]) if is_template_id(id) => {
                Some(Self::Template { id: id.to_string() })
            }
            ("github.com", [owner, repo, more @ ..])
                if is_github_name(owner) && is_github_name(repo) =>
            {
                let tree = match more {
                    [] => Vec::new(),
                    ["tree", tree @ ..] if !tree.is_empty() => {
                        tree.iter().map(|s| s.to_string()).collect()
                    }
                    _ => return None,
                };
                Some(Self::GitHub {
                    owner: owner.to_string(),
                    repo: repo.to_string(),
                    tree,
                })
            }
            _ => None,
        }
    }

    /// The address as people see it, `github.com/lena-k/field-guide`.
    pub fn text(&self) -> String {
        match self {
            Self::Template { id } => format!("netherstone.app/templates/{id}"),
            Self::GitHub { owner, repo, tree } if tree.is_empty() => {
                format!("github.com/{owner}/{repo}")
            }
            Self::GitHub { owner, repo, tree } => {
                format!("github.com/{owner}/{repo}/tree/{}", tree.join("/"))
            }
        }
    }

    pub(super) fn reader(&self) -> Box<dyn Source> {
        match self {
            Self::Template { id } => Box::new(netherstone_app::Template { id: id.clone() }),
            Self::GitHub { owner, repo, tree } => Box::new(github::Folder {
                owner: owner.clone(),
                repo: repo.clone(),
                tree: tree.clone(),
            }),
        }
    }
}

fn strip_prefix_ignoring_case<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let head = text.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix)
        .then(|| &text[prefix.len()..])
}

/// A template's id is its folder's name in the templates collection.
fn is_template_id(id: &str) -> bool {
    id.chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// The characters GitHub allows in account and repository names.
fn is_github_name(name: &str) -> bool {
    name.chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}
#[cfg(test)]
mod tests {
    use super::*;

    fn github(owner: &str, repo: &str, tree: &[&str]) -> Address {
        Address::GitHub {
            owner: owner.into(),
            repo: repo.into(),
            tree: tree.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn reads_addresses() {
        let template = Some(Address::Template {
            id: "worldbuilding".into(),
        });
        assert_eq!(
            Address::parse("netherstone://open/netherstone.app/templates/worldbuilding"),
            template
        );
        assert_eq!(
            Address::parse("NETHERSTONE://open/netherstone.app/templates/worldbuilding/"),
            template
        );
        assert_eq!(
            Address::parse("netherstone.app/templates/worldbuilding"),
            template
        );
        assert_eq!(
            Address::parse("netherstone://open/github.com/lena-k/field-guide"),
            Some(github("lena-k", "field-guide", &[]))
        );
        assert_eq!(
            Address::parse(
                "netherstone://open/https://github.com/lena-k/field-guide/tree/main/Field%20notes"
            ),
            Some(github("lena-k", "field-guide", &["main", "Field notes"]))
        );
        assert_eq!(
            github("lena-k", "field-guide", &["main", "docs"]).text(),
            "github.com/lena-k/field-guide/tree/main/docs"
        );
    }

    #[test]
    fn refuses_other_addresses() {
        for text in [
            "netherstone://open/example.com/templates/worldbuilding",
            "netherstone://open/netherstone.app/templates/../etc",
            "netherstone://open/netherstone.app/templates/a%2Fb",
            "netherstone://open/netherstone.app/templates",
            "netherstone://open/netherstone.app/other/worldbuilding",
            "netherstone://open/github.com/lena-k",
            "netherstone://open/github.com/lena-k/field-guide/blob/main/README.md",
            "netherstone://open/github.com/lena-k/field-guide/tree",
            "netherstone://open/github.com/lena-k/field-guide/tree/main/..",
            "netherstone://open/github.com/lena-k/field-guide/tree/main/%2E%2E",
            "netherstone://open/github.com/lena-k/field-guide?x=1",
            "netherstone://open/github.com/lena k/field-guide",
            "netherstone://open/github.com//field-guide",
            "netherstone://open/raw.githubusercontent.com/lena-k/field-guide/main/a.md",
        ] {
            assert_eq!(Address::parse(text), None, "{text}");
        }
    }
}
