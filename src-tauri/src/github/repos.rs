//! Creating and checking the private backup repositories on GitHub.

use serde::{Deserialize, Serialize};
use serde_json::json;

const API: &str = "https://api.github.com";

/// Topic added to every backup repository so they can be found again, e.g.
/// when opening a backup on another device.
pub const BACKUP_TOPIC: &str = "netherstone-vault";

/// How many `-2`, `-3`, ... suffixes to try when the name is taken.
const MAX_NAME_ATTEMPTS: usize = 20;

#[derive(Debug, Clone, Deserialize)]
pub struct BackupRepo {
    pub id: u64,
    /// `owner/name`.
    pub full_name: String,
    pub clone_url: String,
}

/// Turns a vault folder name into a valid GitHub repository name.
pub fn repo_name_for_vault(vault_name: &str) -> String {
    let mut name = String::new();
    for c in vault_name.chars() {
        let c = if c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-' {
            c
        } else {
            '-'
        };
        if !(c == '-' && name.ends_with('-')) {
            name.push(c);
        }
    }
    let name: String = name
        .trim_matches(|c| c == '-' || c == '.')
        .chars()
        .take(90)
        .collect();

    if name.is_empty() {
        "netherstone-vault".to_string()
    } else {
        name
    }
}

fn candidate_name(base: &str, attempt: usize) -> String {
    if attempt == 0 {
        base.to_string()
    } else {
        format!("{}-{}", base, attempt + 1)
    }
}

fn is_name_taken(body: &str) -> bool {
    body.contains("already exists")
}

async fn api_error(response: reqwest::Response, action: &str) -> String {
    let status = response.status();
    match status.as_u16() {
        401 => "Your GitHub connection has expired. Reconnect GitHub in Settings.".to_string(),
        403 | 404 => format!(
            "GitHub didn't allow Netherstone to {} ({}). Make sure the Netherstone app has access to All repositories in your GitHub settings.",
            action, status
        ),
        _ => format!("GitHub couldn't {} ({}).", action, status),
    }
}

/// Creates a private repository for the vault, picking a free name.
pub async fn create_backup_repo(
    client: &reqwest::Client,
    token: &str,
    vault_name: &str,
) -> Result<BackupRepo, String> {
    let base = repo_name_for_vault(vault_name);

    for attempt in 0..MAX_NAME_ATTEMPTS {
        let name = candidate_name(&base, attempt);
        let response = client
            .post(format!("{}/user/repos", API))
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json")
            .json(&json!({
                "name": name,
                "private": true,
                "description": format!("Netherstone backup of the vault \"{}\"", vault_name),
                "auto_init": false,
                "has_issues": false,
                "has_projects": false,
                "has_wiki": false,
            }))
            .send()
            .await
            .map_err(super::network_error)?;

        if response.status().as_u16() == 422 {
            let body = response.text().await.unwrap_or_default();
            if is_name_taken(&body) {
                continue;
            }
            return Err("GitHub couldn't create the backup repository.".to_string());
        }
        if !response.status().is_success() {
            return Err(api_error(response, "create the backup repository").await);
        }

        let repo: BackupRepo = response
            .json()
            .await
            .map_err(|_| "GitHub sent an unexpected response.".to_string())?;

        // Best effort: the topic only helps find backups later.
        let _ = client
            .put(format!("{}/repos/{}/topics", API, repo.full_name))
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json")
            .json(&json!({ "names": [BACKUP_TOPIC] }))
            .send()
            .await;

        return Ok(repo);
    }

    Err(format!(
        "Couldn't find a free repository name for \"{}\" on GitHub.",
        base
    ))
}

/// Whether `full_name` still exists and is reachable with `token`.
pub async fn repo_exists(
    client: &reqwest::Client,
    token: &str,
    full_name: &str,
) -> Result<bool, String> {
    let response = client
        .get(format!("{}/repos/{}", API, full_name))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(super::network_error)?;

    match response.status().as_u16() {
        200 => Ok(true),
        404 => Ok(false),
        _ => Err(api_error(response, "check the backup repository").await),
    }
}

/// A backup repository on GitHub, for "Open a backup".
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq)]
#[serde(rename_all(serialize = "camelCase"))]
pub struct BackupSummary {
    pub full_name: String,
    pub name: String,
    pub clone_url: String,
    pub pushed_at: Option<String>,
    #[serde(default, skip_serializing)]
    topics: Vec<String>,
    #[serde(default, skip_serializing)]
    description: Option<String>,
}

const DESCRIPTION_PREFIX: &str = "Netherstone backup of the vault";

impl BackupSummary {
    /// Tagged with the backup topic, or (if tagging failed when it was
    /// created) described as a Netherstone backup.
    fn is_backup(&self) -> bool {
        self.topics.iter().any(|topic| topic == BACKUP_TOPIC)
            || self
                .description
                .as_deref()
                .is_some_and(|d| d.starts_with(DESCRIPTION_PREFIX))
    }
}

fn backups_from(repos: Vec<BackupSummary>) -> Vec<BackupSummary> {
    let mut backups: Vec<_> = repos.into_iter().filter(BackupSummary::is_backup).collect();
    backups.sort_by(|a, b| b.pushed_at.cmp(&a.pushed_at));
    backups
}

/// The signed-in user's Netherstone backups, most recently updated first.
pub async fn list_backups(
    client: &reqwest::Client,
    token: &str,
) -> Result<Vec<BackupSummary>, String> {
    let mut repos = Vec::new();
    for page in 1..=10 {
        let response = client
            .get(format!(
                "{}/user/repos?affiliation=owner&per_page=100&page={}",
                API, page
            ))
            .bearer_auth(token)
            .header("Accept", "application/vnd.github+json")
            .send()
            .await
            .map_err(super::network_error)?;
        if !response.status().is_success() {
            return Err(api_error(response, "list your backups").await);
        }
        let batch: Vec<BackupSummary> = response
            .json()
            .await
            .map_err(|_| "GitHub sent an unexpected response.".to_string())?;
        let done = batch.len() < 100;
        repos.extend(batch);
        if done {
            break;
        }
    }
    Ok(backups_from(repos))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derives_repo_names_from_vault_names() {
        assert_eq!(repo_name_for_vault("Notes"), "Notes");
        assert_eq!(repo_name_for_vault("My Vault (2024)"), "My-Vault-2024");
        assert_eq!(repo_name_for_vault("  work/notes  "), "work-notes");
        assert_eq!(repo_name_for_vault(".hidden"), "hidden");
        assert_eq!(repo_name_for_vault("Café ☕"), "Caf");
        assert_eq!(repo_name_for_vault("日本語"), "netherstone-vault");
        assert_eq!(repo_name_for_vault(&"a".repeat(200)).len(), 90);
    }

    #[test]
    fn lists_only_backups_newest_first() {
        let repos: Vec<BackupSummary> = serde_json::from_str(
            r#"[
                {"full_name":"me/Old","name":"Old","clone_url":"u1","pushed_at":"2026-01-01T00:00:00Z","topics":["netherstone-vault"]},
                {"full_name":"me/code","name":"code","clone_url":"u2","pushed_at":"2026-09-01T00:00:00Z","topics":[],"description":"My code"},
                {"full_name":"me/New","name":"New","clone_url":"u3","pushed_at":"2026-10-01T00:00:00Z","topics":[],"description":"Netherstone backup of the vault \"New\""}
            ]"#,
        )
        .unwrap();
        let names: Vec<_> = backups_from(repos).into_iter().map(|r| r.name).collect();
        assert_eq!(names, vec!["New", "Old"]);
    }

    #[test]
    fn numbers_later_name_attempts() {
        assert_eq!(candidate_name("Notes", 0), "Notes");
        assert_eq!(candidate_name("Notes", 1), "Notes-2");
        assert!(is_name_taken(
            r#"{"message":"Repository creation failed.","errors":[{"resource":"Repository","code":"custom","field":"name","message":"name already exists on this account"}]}"#
        ));
    }
}
