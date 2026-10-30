//! Templates from netherstone.app. The site lists them in `templates.json`
//! and serves each as `templates/<id>.zip`, its vault files at the zip's root.

use serde::Deserialize;

use super::{Download, Listing, PathCheck, Pending, Refusal, Source, Stage, Web, check_path, needs_update};

const SITE: &str = "https://netherstone.app";

/// The `v` of `templates.json` this app reads.
const LIST_VERSION: u32 = 1;

pub struct Template {
    pub id: String,
}

#[derive(Deserialize)]
struct List {
    v: u32,
    #[serde(default)]
    templates: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: String,
    name: String,
    first_shard: Option<String>,
    min_app_version: String,
    files: usize,
    /// The files' bytes once unzipped.
    size: u64,
    zip_size: u64,
    sha256: String,
}

impl Source for Template {
    fn list<'a>(&'a self, web: &'a Web) -> Pending<'a, Listing> {
        Box::pin(async move {
            let response = web
                .client
                .get(format!("{SITE}/templates.json"))
                .send()
                .await
                .map_err(|_| Refusal::DownloadFailed)?;
            if !response.status().is_success() {
                return Err(Refusal::DownloadFailed);
            }
            let list: List = response.json().await.map_err(|_| Refusal::DownloadFailed)?;
            let entry = find(list, &self.id)?;
            entry_listing(entry, env!("CARGO_PKG_VERSION"))
        })
    }

    fn gone(&self) -> Refusal {
        Refusal::TemplateNotFound
    }
}

/// The template `id` in the site's list. Entries this app can't read are
/// passed over, so a new field elsewhere breaks nothing.
fn find(list: List, id: &str) -> Result<Entry, Refusal> {
    if list.v != LIST_VERSION {
        return Err(Refusal::UpdateFirst { name: None, version: None });
    }
    list.templates
        .into_iter()
        .filter_map(|entry| serde_json::from_value::<Entry>(entry).ok())
        .find(|entry| entry.id == id)
        .ok_or(Refusal::TemplateNotFound)
}

fn entry_listing(entry: Entry, app_version: &str) -> Result<Listing, Refusal> {
    if needs_update(&entry.min_app_version, app_version) {
        return Err(Refusal::UpdateFirst { name: Some(entry.name), version: Some(entry.min_app_version) });
    }
    if entry.sha256.len() != 64 || !entry.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(Refusal::DownloadFailed);
    }
    let first_shard = entry
        .first_shard
        .filter(|shard| check_path(shard) == PathCheck::Keep(super::FileKind::Shard));
    Ok(Listing {
        template: true,
        address: super::Address::Template { id: entry.id.clone() }.text(),
        name: entry.name,
        files: entry.files,
        shards: 0,
        pictures: 0,
        left_out: 0,
        size: entry.size,
        downloads: vec![Download {
            path: "template.zip".into(),
            url: format!("{SITE}/templates/{}.zip", urlencoding::encode(&entry.id)),
            size: entry.zip_size,
            stage: Stage::Template,
            sha256: Some(entry.sha256),
        }],
        first_shard,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list(json: serde_json::Value) -> List {
        serde_json::from_value(json).unwrap()
    }

    fn worldbuilding(min_app_version: &str) -> serde_json::Value {
        serde_json::json!({
            "id": "worldbuilding",
            "name": "Worldbuilding",
            "line": "A world for a story or a game",
            "firstShard": "Start here.md",
            "minAppVersion": min_app_version,
            "order": 1,
            "files": 16,
            "size": 48213,
            "zipSize": 21877,
            "sha256": "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
            "later": true
        })
    }

    #[test]
    fn reads_the_sites_list() {
        let entry = find(list(serde_json::json!({ "v": 1, "templates": [{ "id": "broken" }, worldbuilding("0.7")] })), "worldbuilding").unwrap();
        let listing = entry_listing(entry, "0.7.0-beta.1").unwrap();
        assert_eq!(listing.name, "Worldbuilding");
        assert_eq!(listing.address, "netherstone.app/templates/worldbuilding");
        assert_eq!(listing.size, 48213);
        assert_eq!(listing.first_shard.as_deref(), Some("Start here.md"));
        assert_eq!(listing.downloads[0].url, "https://netherstone.app/templates/worldbuilding.zip");
        assert_eq!(listing.downloads[0].size, 21877);
    }

    #[test]
    fn refuses_what_it_cant_open() {
        let templates = || list(serde_json::json!({ "v": 1, "templates": [worldbuilding("0.8.0")] }));
        assert_eq!(find(templates(), "studying").err(), Some(Refusal::TemplateNotFound));
        let entry = find(templates(), "worldbuilding").unwrap();
        assert_eq!(
            entry_listing(entry, "0.7.0").err(),
            Some(Refusal::UpdateFirst { name: Some("Worldbuilding".into()), version: Some("0.8.0".into()) })
        );
        assert_eq!(
            find(list(serde_json::json!({ "v": 2 })), "worldbuilding").err(),
            Some(Refusal::UpdateFirst { name: None, version: None })
        );
    }
}
