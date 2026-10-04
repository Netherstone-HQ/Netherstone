//! The Netherstone GitHub App's installation on the user's account.
//!
//! Signing in only proves who the user is. The App must also be installed on
//! their account before its token can create and push to backup repositories.

use serde::{Deserialize, Serialize};

/// The App's URL name (`github.com/apps/<slug>`).
pub const APP_SLUG: &str = "netherstone-app";

const API: &str = "https://api.github.com";

#[derive(Debug, Clone, Deserialize)]
pub struct Installation {
    pub id: u64,
    pub account: InstallationAccount,
    /// `all` or `selected` repositories.
    pub repository_selection: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct InstallationAccount {
    pub login: String,
}

#[derive(Debug, Deserialize)]
struct InstallationList {
    installations: Vec<Installation>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallationStatus {
    /// Installed on the signed-in user's own account.
    pub installed: bool,
    /// Every account the user can see the App installed on, which tells an
    /// install on the wrong account (e.g. an organization) apart from none.
    pub installed_on: Vec<String>,
    /// Where to install the App (or change which repositories it can reach).
    pub install_url: String,
}

pub fn install_url() -> String {
    format!("https://github.com/apps/{}/installations/new", APP_SLUG)
}

pub fn installation_for<'a>(list: &'a [Installation], login: &str) -> Option<&'a Installation> {
    list.iter()
        .find(|installation| installation.account.login.eq_ignore_ascii_case(login))
}

/// The App's installation on `login`'s own account, if any.
pub async fn find_installation(
    client: &reqwest::Client,
    token: &str,
    login: &str,
) -> Result<Option<Installation>, String> {
    let list = list_installations(client, token).await?;
    Ok(installation_for(&list, login).cloned())
}

/// The App's installations the signed-in user can access.
pub async fn list_installations(
    client: &reqwest::Client,
    token: &str,
) -> Result<Vec<Installation>, String> {
    let response = client
        .get(format!("{}/user/installations?per_page=100", API))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(super::network_error)?;

    if response.status().as_u16() == 401 {
        return Err("Your GitHub connection has expired. Reconnect GitHub in Settings.".to_string());
    }
    if response.status().as_u16() == 403 {
        return Err(
            "This connection can't see the Netherstone app. Disconnect and connect GitHub again."
                .to_string(),
        );
    }
    if !response.status().is_success() {
        return Err(format!(
            "GitHub couldn't check the Netherstone installation ({}).",
            response.status()
        ));
    }

    let list: InstallationList = response
        .json()
        .await
        .map_err(|_| "GitHub sent an unexpected response.".to_string())?;
    Ok(list.installations)
}

/// Gives the installation access to a repository the user just created, when
/// it is limited to selected repositories.
pub async fn add_repository(
    client: &reqwest::Client,
    token: &str,
    installation: &Installation,
    repository_id: u64,
) -> Result<(), String> {
    if installation.repository_selection != "selected" {
        return Ok(());
    }

    let response = client
        .put(format!(
            "{}/user/installations/{}/repositories/{}",
            API, installation.id, repository_id
        ))
        .bearer_auth(token)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(super::network_error)?;

    if response.status().is_success() {
        Ok(())
    } else {
        Err(format!(
            "GitHub couldn't give Netherstone access to the new backup repository ({}).",
            response.status()
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_installation_on_the_users_own_account() {
        let list: InstallationList = serde_json::from_str(
            r#"{"total_count":2,"installations":[
                {"id":1,"account":{"login":"Netherstone-HQ"},"repository_selection":"all"},
                {"id":2,"account":{"login":"wSoltani"},"repository_selection":"selected"}
            ]}"#,
        )
        .unwrap();

        let installation = installation_for(&list.installations, "wsoltani").unwrap();
        assert_eq!(installation.id, 2);
        assert_eq!(installation.repository_selection, "selected");
        assert!(installation_for(&list.installations, "octocat").is_none());
    }
}
