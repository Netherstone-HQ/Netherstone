//! GitHub account connection for sync.
//!
//! The access token lives in the OS credential store, or where a Linux
//! desktop has none, as `token_store` describes. The account's public profile
//! is cached in AppData so the UI can show who is signed in without a network
//! call.

pub mod app;
pub mod device_flow;
pub mod repos;
pub mod token_store;

use device_flow::PollOutcome;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const ACCOUNT_FILE: &str = "github-account.json";
const USER_AGENT: &str = "Netherstone";
const API_USER_URL: &str = "https://api.github.com/user";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GitHubAccount {
    pub login: String,
    pub name: Option<String>,
    // GitHub's API spells it `avatar_url`; the cache and the UI use camelCase.
    #[serde(alias = "avatar_url")]
    pub avatar_url: Option<String>,
    /// The app the stored token was issued to. A token from a different
    /// client id (e.g. an earlier OAuth App) can't reach the GitHub App's
    /// installation, so it is discarded.
    #[serde(default)]
    pub client_id: Option<String>,
}

/// Where the sign-in is, or would be, kept on this device.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenStorageStatus {
    /// Whether this device has a credential store. Without one, the user
    /// chooses between a private file and signing in each time.
    pub keyring_available: bool,
    /// Where the current sign-in is kept, if signed in.
    pub current: Option<token_store::TokenStorage>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SignInCode {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
}

struct PendingSignIn {
    id: u64,
    device_code: String,
    interval: u64,
    deadline: Instant,
}

/// The sign-in waiting for approval. Starting a new one or cancelling replaces
/// it, which stops any poll loop still running for the old one.
static PENDING: Mutex<Option<PendingSignIn>> = Mutex::new(None);
static NEXT_ID: Mutex<u64> = Mutex::new(0);

pub(crate) fn network_error(e: reqwest::Error) -> String {
    if e.is_connect() || e.is_timeout() {
        "Couldn't reach GitHub. Check your internet connection and try again.".to_string()
    } else {
        format!("Couldn't reach GitHub: {}", e)
    }
}

pub(crate) fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("Failed to set up network client: {}", e))
}

fn account_path() -> Result<PathBuf, String> {
    Ok(crate::db::get_db_path()?
        .parent()
        .ok_or_else(|| "Failed to determine AppData directory".to_string())?
        .join(ACCOUNT_FILE))
}

/// The stored access token, if the user is signed in.
pub fn access_token() -> Result<Option<String>, String> {
    Ok(token_store::load()?.map(|(token, _)| token))
}

pub fn token_storage_status() -> Result<TokenStorageStatus, String> {
    Ok(TokenStorageStatus {
        keyring_available: token_store::keyring_available(),
        current: token_store::load()?.map(|(_, storage)| storage),
    })
}

fn read_cached_account() -> Option<GitHubAccount> {
    let json = std::fs::read_to_string(account_path().ok()?).ok()?;
    serde_json::from_str(&json).ok()
}

fn write_cached_account(account: &GitHubAccount) -> Result<(), String> {
    let json = serde_json::to_string_pretty(account)
        .map_err(|e| format!("Failed to save account: {}", e))?;
    std::fs::write(account_path()?, json).map_err(|e| format!("Failed to save account: {}", e))
}

async fn fetch_account(client: &reqwest::Client, token: &str) -> Result<GitHubAccount, String> {
    let response = client
        .get(API_USER_URL)
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(network_error)?;

    if !response.status().is_success() {
        return Err(format!(
            "GitHub didn't accept the sign-in ({}).",
            response.status()
        ));
    }

    response
        .json()
        .await
        .map_err(|_| "GitHub sent an unexpected response.".to_string())
}

/// The signed-in account, from the local cache. Returns `None` when there is
/// no stored token, clearing any stale cached profile.
pub fn current_account() -> Result<Option<GitHubAccount>, String> {
    let account = read_cached_account();
    let issued_here = account
        .as_ref()
        .is_some_and(|a| a.client_id.as_deref() == Some(device_flow::CLIENT_ID));

    if access_token()?.is_none() || !issued_here {
        sign_out()?;
        return Ok(None);
    }
    Ok(account)
}

/// The GitHub App's installation on the signed-in user's own account.
pub async fn current_installation(
    client: &reqwest::Client,
    token: &str,
) -> Result<Option<app::Installation>, String> {
    let login = read_cached_account()
        .map(|account| account.login)
        .ok_or_else(|| "Sign in to GitHub first.".to_string())?;
    app::find_installation(client, token, &login).await
}

/// Whether the GitHub App is installed on the signed-in user's account.
pub async fn installation_status() -> Result<app::InstallationStatus, String> {
    let token = access_token()?.ok_or_else(|| "Sign in to GitHub first.".to_string())?;
    let login = read_cached_account()
        .map(|account| account.login)
        .ok_or_else(|| "Sign in to GitHub first.".to_string())?;
    let installations = app::list_installations(&http_client()?, &token).await?;
    Ok(app::InstallationStatus {
        installed: app::installation_for(&installations, &login).is_some(),
        installed_on: installations.into_iter().map(|i| i.account.login).collect(),
        install_url: app::install_url(),
    })
}

/// Asks GitHub for a code for the user to enter on github.com.
pub async fn start_sign_in() -> Result<SignInCode, String> {
    let code = device_flow::request_device_code(&http_client()?).await?;

    let id = {
        let mut next = NEXT_ID.lock().map_err(|e| e.to_string())?;
        *next += 1;
        *next
    };
    *PENDING.lock().map_err(|e| e.to_string())? = Some(PendingSignIn {
        id,
        device_code: code.device_code,
        interval: code.interval.max(1),
        deadline: Instant::now() + Duration::from_secs(code.expires_in),
    });

    Ok(SignInCode {
        user_code: code.user_code,
        verification_uri: code.verification_uri,
        expires_in: code.expires_in,
    })
}

pub fn cancel_sign_in() {
    if let Ok(mut pending) = PENDING.lock() {
        *pending = None;
    }
}

/// Clears the pending sign-in only if it is still the one with `id`, so a
/// finishing poll loop never cancels a newer sign-in.
fn clear_sign_in(id: u64) {
    if let Ok(mut pending) = PENDING.lock() {
        if pending.as_ref().is_some_and(|p| p.id == id) {
            *pending = None;
        }
    }
}

/// Waits for the user to approve the pending sign-in, then stores the token.
/// `remember` only matters on a device without a credential store: false
/// keeps the sign-in for this run of the app instead of in a file.
///
/// Returns `Ok(None)` if the sign-in was cancelled or replaced meanwhile.
pub async fn finish_sign_in(remember: bool) -> Result<Option<GitHubAccount>, String> {
    let client = http_client()?;
    let (id, device_code, mut interval, deadline) = {
        let pending = PENDING.lock().map_err(|e| e.to_string())?;
        let Some(pending) = pending.as_ref() else {
            return Ok(None);
        };
        (
            pending.id,
            pending.device_code.clone(),
            pending.interval,
            pending.deadline,
        )
    };

    let still_pending = || {
        PENDING
            .lock()
            .map(|p| p.as_ref().is_some_and(|p| p.id == id))
            .unwrap_or(false)
    };

    let token = loop {
        tokio::time::sleep(Duration::from_secs(interval)).await;
        if !still_pending() {
            return Ok(None);
        }
        if Instant::now() >= deadline {
            clear_sign_in(id);
            return Err("The sign-in code expired. Start again to get a new one.".into());
        }

        match device_flow::poll_access_token(&client, &device_code, interval).await? {
            PollOutcome::Token(token) => break token,
            PollOutcome::Pending => {}
            PollOutcome::SlowDown(next) => interval = next,
            PollOutcome::Expired => {
                clear_sign_in(id);
                return Err("The sign-in code expired. Start again to get a new one.".into());
            }
            PollOutcome::Denied => {
                clear_sign_in(id);
                return Err("Sign-in was cancelled on GitHub.".into());
            }
            PollOutcome::Failed(message) => {
                clear_sign_in(id);
                return Err(message);
            }
        }
    };

    if !still_pending() {
        return Ok(None);
    }
    clear_sign_in(id);

    let mut account = fetch_account(&client, &token).await?;
    account.client_id = Some(device_flow::CLIENT_ID.to_string());
    tauri::async_runtime::spawn_blocking(move || {
        token_store::save(&token, remember)?;
        write_cached_account(&account)?;
        Ok(Some(account))
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Forgets the token and cached profile on this device.
///
/// The authorization itself stays listed on GitHub until the user revokes it
/// there; revoking from the app would need the OAuth App's client secret.
pub fn sign_out() -> Result<(), String> {
    token_store::clear()?;
    match std::fs::remove_file(account_path()?) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("Failed to remove account: {}", e)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_github_user_response() {
        let account: GitHubAccount = serde_json::from_str(
            r#"{"login":"octocat","id":1,"name":"The Octocat","avatar_url":"https://avatars.githubusercontent.com/u/583231"}"#,
        )
        .unwrap();
        assert_eq!(account.login, "octocat");
        assert_eq!(account.name.as_deref(), Some("The Octocat"));

        let minimal: GitHubAccount =
            serde_json::from_str(r#"{"login":"octocat","name":null}"#).unwrap();
        assert_eq!(minimal.avatar_url, None);
    }
}
