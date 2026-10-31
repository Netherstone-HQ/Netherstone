//! Public Markdown folders on github.com. The branch is pinned to its latest
//! commit, then one request lists just the folder at that commit with every
//! file's size; its shards, drawings and pictures then download from
//! raw.githubusercontent.com at the same commit, so a push meanwhile changes
//! nothing. Nothing else in it is downloaded.

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

    /// Sends a GET to the API, with the sync's sign-in when there is one.
    async fn get(&self, web: &Web, url: &str, accept: &str) -> Result<reqwest::Response, Refusal> {
        let send = |token: Option<&String>| {
            let mut request = web
                .client
                .get(url)
                .header("Accept", accept)
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
        Ok(response)
    }

    /// The commit `branch` points at, or None when there's no such branch.
    async fn commit_of(&self, web: &Web, branch: &str) -> Result<Option<String>, Refusal> {
        let url = format!("{API}/repos/{}/{}/commits/{}", self.owner, self.repo, urlencoding::encode(branch));
        let response = self.get(web, &url, "application/vnd.github.sha").await?;
        match response.status() {
            status if status.is_success() => {
                let sha = response.text().await.map_err(|_| Refusal::DownloadFailed)?;
                let sha = sha.trim();
                if sha.is_empty() || !sha.chars().all(|c| c.is_ascii_hexdigit()) {
                    return Err(Refusal::DownloadFailed);
                }
                Ok(Some(sha.to_string()))
            }
            reqwest::StatusCode::NOT_FOUND | reqwest::StatusCode::UNPROCESSABLE_ENTITY => Ok(None),
            _ => Err(Refusal::DownloadFailed),
        }
    }

    /// Lists `folder` at `commit`, everything under it, or None when the
    /// commit has no such folder.
    async fn list_folder(&self, web: &Web, commit: &str, folder: &[String]) -> Result<Option<Tree>, Refusal> {
        let url = format!(
            "{API}/repos/{}/{}/git/trees/{commit}:{}?recursive=1",
            self.owner,
            self.repo,
            encode_path(&folder.join("/"))
        );
        let response = self.get(web, &url, "application/vnd.github+json").await?;
        match response.status() {
            status if status.is_success() => response.json().await.map(Some).map_err(|_| Refusal::DownloadFailed),
            reqwest::StatusCode::NOT_FOUND | reqwest::StatusCode::UNPROCESSABLE_ENTITY => Ok(None),
            _ => Err(Refusal::DownloadFailed),
        }
    }

    fn name(&self, folder: &[String]) -> String {
        folder.last().unwrap_or(&self.repo).clone()
    }

    /// What `tree`, the listing of `folder` at `commit`, opens.
    fn listing(&self, commit: &str, folder: &[String], tree: Tree) -> Result<Listing, Refusal> {
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
            drawings: 0,
            pictures: 0,
            left_out: 0,
            size: 0,
            downloads: Vec::new(),
            first_shard: None,
        };
        for entry in tree.tree.iter().filter(|entry| entry.kind == "blob") {
            let path = entry.path.as_str();
            if path.split('/').any(|segment| segment.starts_with('.')) {
                continue;
            }
            let stage = match (entry.mode.as_str(), check_path(path)) {
                (LINK_MODE, _) => None,
                (_, PathCheck::Keep(FileKind::Shard)) => Some(Stage::Shards),
                (_, PathCheck::Keep(FileKind::Drawing)) => Some(Stage::Drawings),
                (_, PathCheck::Keep(FileKind::Picture)) => Some(Stage::Pictures),
                _ => None,
            };
            let Some(stage) = stage else {
                listing.left_out += 1;
                continue;
            };
            match stage {
                Stage::Shards => listing.shards += 1,
                Stage::Drawings => listing.drawings += 1,
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
                    commit,
                    encode_path(&format!("{prefix}{path}"))
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

impl Source for Folder {
    fn list<'a>(&'a self, web: &'a Web) -> Pending<'a, Listing> {
        Box::pin(async move {
            for (branch, folder) in self.splits() {
                let Some(commit) = self.commit_of(web, &branch).await? else {
                    continue;
                };
                if let Some(tree) = self.list_folder(web, &commit, &folder).await? {
                    return self.listing(&commit, &folder, tree);
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

    /// The folder `docs` at a commit, as GitHub lists it.
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
                entry("Birds.md", "100644", "blob", 100),
                entry("Field notes", "040000", "tree", 0),
                entry("Field notes/Owls.md", "100644", "blob", 50),
                entry("Field notes/Wings.excalidraw", "100644", "blob", 400),
                entry("img/owl.png", "100644", "blob", 2000),
                entry("build.py", "100644", "blob", 30),
                entry("link.md", LINK_MODE, "blob", 9),
                entry(".github/notes.md", "100644", "blob", 9),
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
    fn lists_shards_drawings_and_pictures_at_the_commit() {
        let source = folder(&["main", "docs"]);
        let docs = vec!["docs".to_string()];
        let listing = source.listing("b3725f1", &docs, tree(false)).unwrap();
        assert_eq!(listing.name, "docs");
        assert_eq!(listing.address, "github.com/lena-k/field-guide/tree/main/docs");
        assert_eq!(
            (listing.shards, listing.drawings, listing.pictures, listing.left_out, listing.size),
            (2, 1, 1, 2, 2550)
        );
        let paths: Vec<&str> = listing.downloads.iter().map(|download| download.path.as_str()).collect();
        assert_eq!(paths, vec!["Birds.md", "Field notes/Owls.md", "Field notes/Wings.excalidraw", "img/owl.png"]);
        assert_eq!(
            listing.downloads[1].url,
            "https://raw.githubusercontent.com/lena-k/field-guide/b3725f1/docs/Field%20notes/Owls.md"
        );
    }

    #[test]
    fn refuses_what_it_cant_open() {
        let source = folder(&[]);
        assert_eq!(source.listing("b3725f1", &[], tree(true)).err(), Some(Refusal::TooManyFiles));
        let empty = Tree { truncated: false, tree: vec![] };
        assert_eq!(source.listing("b3725f1", &[], empty).err(), Some(Refusal::NothingToOpen));
    }
}
