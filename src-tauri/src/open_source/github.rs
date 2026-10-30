//! Public Markdown folders on github.com. One request lists the whole folder
//! with every file's size; its shards and pictures then download from
//! raw.githubusercontent.com. Nothing else in it is downloaded.

use serde::Deserialize;

use super::{Download, FileKind, Listing, PathCheck, Pending, Refusal, Source, Stage, Web, check_path};

const API: &str = "https://api.github.com";
const RAW: &str = "https://raw.githubusercontent.com";

/// How git lists a link, which is never followed.
const LINK_MODE: &str = "120000";

pub struct Folder {
    pub owner: String,
    pub repo: String,
    /// What follows `/tree/` in the address: the branch, then the folder.
    pub tree: Vec<String>,
}

#[derive(Deserialize)]
struct Tree {
    #[serde(default)]
    truncated: bool,
    tree: Vec<Entry>,
}

#[derive(Deserialize)]
struct Entry {
    path: String,
    mode: String,
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    size: u64,
}

impl Folder {
    /// The ways to split `tree` into a branch and a folder, the shortest
    /// branch first; no `tree` is the default branch.
    fn splits(&self) -> Vec<(String, Vec<String>)> {
        if self.tree.is_empty() {
            return vec![("HEAD".into(), Vec::new())];
        }
        (1..=self.tree.len())
            .map(|at| (self.tree[..at].join("/"), self.tree[at..].to_vec()))
            .collect()
    }

    /// Lists `branch` whole, or None when there's no such branch.
    async fn list_branch(&self, web: &Web, branch: &str) -> Result<Option<Tree>, Refusal> {
        let url = format!(
            "{API}/repos/{}/{}/git/trees/{}?recursive=1",
            self.owner,
            self.repo,
            urlencoding::encode(branch)
        );
        let send = |token: Option<&String>| {
            let mut request = web
                .client
                .get(&url)
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28");
            if let Some(token) = token {
                request = request.bearer_auth(token);
            }
            request.send()
        };
        let mut response = send(web.github_token.as_ref()).await.map_err(|_| Refusal::DownloadFailed)?;
        if response.status() == reqwest::StatusCode::UNAUTHORIZED && web.github_token.is_some() {
            // A sign-in that ran out; public folders open without one.
            response = send(None).await.map_err(|_| Refusal::DownloadFailed)?;
        }
        match response.status() {
            status if status.is_success() => response.json().await.map(Some).map_err(|_| Refusal::DownloadFailed),
            reqwest::StatusCode::NOT_FOUND | reqwest::StatusCode::UNPROCESSABLE_ENTITY => Ok(None),
            _ => Err(Refusal::DownloadFailed),
        }
    }

    fn name(&self, folder: &[String]) -> String {
        folder.last().unwrap_or(&self.repo).clone()
    }

    fn listing(&self, branch: &str, folder: &[String], tree: Tree) -> Result<Listing, Refusal> {
        if tree.truncated {
            return Err(Refusal::TooManyFiles);
        }
        let prefix = folder.iter().map(|segment| format!("{segment}/")).collect::<String>();
        let mut listing = Listing {
            template: false,
            name: self.name(folder),
            address: super::Address::GitHub {
                owner: self.owner.clone(),
                repo: self.repo.clone(),
                tree: self.tree.clone(),
            }
            .text(),
            files: 0,
            shards: 0,
            pictures: 0,
            left_out: 0,
            size: 0,
            downloads: Vec::new(),
            first_shard: None,
        };
        for entry in tree.tree.iter().filter(|entry| entry.kind == "blob") {
            let Some(path) = entry.path.strip_prefix(&prefix) else {
                continue;
            };
            if path.split('/').any(|segment| segment.starts_with('.')) {
                continue;
            }
            let stage = match (entry.mode.as_str(), check_path(path)) {
                (LINK_MODE, _) => None,
                (_, PathCheck::Keep(FileKind::Shard)) => Some(Stage::Shards),
                (_, PathCheck::Keep(FileKind::Picture)) => Some(Stage::Pictures),
                _ => None,
            };
            let Some(stage) = stage else {
                listing.left_out += 1;
                continue;
            };
            match stage {
                Stage::Shards => listing.shards += 1,
                _ => listing.pictures += 1,
            }
            listing.files += 1;
            listing.size += entry.size;
            listing.downloads.push(Download {
                path: path.to_string(),
                url: format!(
                    "{RAW}/{}/{}/{}/{}",
                    self.owner,
                    self.repo,
                    encode_path(branch),
                    encode_path(&entry.path)
                ),
                size: entry.size,
                stage,
                sha256: None,
            });
        }
        if listing.shards == 0 {
            return Err(Refusal::NothingToOpen);
        }
        Ok(listing)
    }
}

/// Each part of a `/`-separated path, made safe for a URL.
fn encode_path(path: &str) -> String {
    path.split('/').map(|segment| urlencoding::encode(segment).into_owned()).collect::<Vec<_>>().join("/")
}

/// Whether `tree` holds `folder`; the whole branch always counts.
fn has_folder(tree: &Tree, folder: &[String]) -> bool {
    let path = folder.join("/");
    folder.is_empty() || tree.tree.iter().any(|entry| entry.kind == "tree" && entry.path == path)
}

impl Source for Folder {
    fn list<'a>(&'a self, web: &'a Web) -> Pending<'a, Listing> {
        Box::pin(async move {
            for (branch, folder) in self.splits() {
                if let Some(tree) = self.list_branch(web, &branch).await?
                    && (tree.truncated || has_folder(&tree, &folder))
                {
                    return self.listing(&branch, &folder, tree);
                }
            }
            Err(Refusal::CantOpen)
        })
    }

    fn gone(&self) -> Refusal {
        Refusal::CantOpen
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(tree: &[&str]) -> Folder {
        Folder {
            owner: "lena-k".into(),
            repo: "field-guide".into(),
            tree: tree.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn tree(truncated: bool) -> Tree {
        let entry = |path: &str, mode: &str, kind: &str, size: u64| Entry {
            path: path.into(),
            mode: mode.into(),
            kind: kind.into(),
            size,
        };
        Tree {
            truncated,
            tree: vec![
                entry("README.md", "100644", "blob", 10),
                entry("docs", "040000", "tree", 0),
                entry("docs/Birds.md", "100644", "blob", 100),
                entry("docs/Field notes/Owls.md", "100644", "blob", 50),
                entry("docs/img/owl.png", "100644", "blob", 2000),
                entry("docs/build.py", "100644", "blob", 30),
                entry("docs/link.md", LINK_MODE, "blob", 9),
                entry("docs/.github/notes.md", "100644", "blob", 9),
            ],
        }
    }

    #[test]
    fn splits_branch_and_folder() {
        assert_eq!(folder(&[]).splits(), vec![("HEAD".to_string(), vec![])]);
        assert_eq!(
            folder(&["feature", "x", "docs"]).splits(),
            vec![
                ("feature".to_string(), vec!["x".to_string(), "docs".to_string()]),
                ("feature/x".to_string(), vec!["docs".to_string()]),
                ("feature/x/docs".to_string(), vec![]),
            ]
        );
    }

    #[test]
    fn lists_shards_and_pictures_only() {
        let source = folder(&["main", "docs"]);
        let docs = vec!["docs".to_string()];
        assert!(has_folder(&tree(false), &docs));
        assert!(!has_folder(&tree(false), &["img".to_string()]));

        let listing = source.listing("main", &docs, tree(false)).unwrap();
        assert_eq!(listing.name, "docs");
        assert_eq!(listing.address, "github.com/lena-k/field-guide/tree/main/docs");
        assert_eq!((listing.shards, listing.pictures, listing.left_out, listing.size), (2, 1, 2, 2150));
        let paths: Vec<&str> = listing.downloads.iter().map(|download| download.path.as_str()).collect();
        assert_eq!(paths, vec!["Birds.md", "Field notes/Owls.md", "img/owl.png"]);
        assert_eq!(
            listing.downloads[1].url,
            "https://raw.githubusercontent.com/lena-k/field-guide/main/docs/Field%20notes/Owls.md"
        );
    }

    #[test]
    fn refuses_what_it_cant_open() {
        let source = folder(&[]);
        assert_eq!(source.listing("HEAD", &[], tree(true)).err(), Some(Refusal::TooManyFiles));
        let empty = Tree { truncated: false, tree: vec![] };
        assert_eq!(source.listing("HEAD", &[], empty).err(), Some(Refusal::NothingToOpen));
    }
}
