//! GitHub's OAuth device flow.
//!
//! The app asks GitHub for a short user code, the user approves it on
//! github.com, and the app polls until GitHub hands back an access token. No
//! client secret is shipped and no local redirect server is needed.
//! See <https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow>.

use serde::Deserialize;

/// Public client id of the Netherstone GitHub App (not a secret). What the
/// token can do is set by the App's permissions and installation, not scopes.
pub const CLIENT_ID: &str = "Iv23liwX2TF33nrIBcED";

const DEVICE_CODE_URL: &str = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL: &str = "https://github.com/login/oauth/access_token";
const DEVICE_GRANT_TYPE: &str = "urn:ietf:params:oauth:grant-type:device_code";

/// GitHub adds this many seconds to the interval on each `slow_down`.
const SLOW_DOWN_STEP_SECS: u64 = 5;

#[derive(Debug, Clone, Deserialize)]
pub struct DeviceCode {
    pub device_code: String,
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    pub interval: u64,
}

#[derive(Debug, PartialEq, Eq)]
pub enum PollOutcome {
    Token(String),
    /// The user hasn't approved yet; poll again after the interval.
    Pending,
    /// Polling too fast; poll again after this new interval.
    SlowDown(u64),
    Expired,
    Denied,
    Failed(String),
}

#[derive(Debug, Deserialize)]
struct AccessTokenResponse {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
    interval: Option<u64>,
}

fn parse_access_token_response(body: &str, current_interval: u64) -> PollOutcome {
    let response: AccessTokenResponse = match serde_json::from_str(body) {
        Ok(response) => response,
        Err(_) => return PollOutcome::Failed("GitHub sent an unexpected response.".into()),
    };

    if let Some(token) = response.access_token.filter(|t| !t.is_empty()) {
        return PollOutcome::Token(token);
    }

    match response.error.as_deref() {
        Some("authorization_pending") => PollOutcome::Pending,
        Some("slow_down") => PollOutcome::SlowDown(
            response
                .interval
                .unwrap_or(current_interval + SLOW_DOWN_STEP_SECS),
        ),
        Some("expired_token") => PollOutcome::Expired,
        Some("access_denied") => PollOutcome::Denied,
        Some(code) => PollOutcome::Failed(
            response
                .error_description
                .unwrap_or_else(|| format!("GitHub sign-in failed ({}).", code)),
        ),
        None => PollOutcome::Failed("GitHub sent an unexpected response.".into()),
    }
}

pub async fn request_device_code(client: &reqwest::Client) -> Result<DeviceCode, String> {
    let response = client
        .post(DEVICE_CODE_URL)
        .header("Accept", "application/json")
        .form(&[("client_id", CLIENT_ID)])
        .send()
        .await
        .map_err(super::network_error)?;

    let status = response.status();
    let body = response.text().await.map_err(super::network_error)?;
    if !status.is_success() {
        return Err(format!("GitHub couldn't start sign-in ({}).", status));
    }

    serde_json::from_str(&body).map_err(|_| {
        // GitHub answers 200 with an error body when device flow is off.
        match parse_access_token_response(&body, 0) {
            PollOutcome::Failed(message) => message,
            _ => "GitHub sent an unexpected response.".to_string(),
        }
    })
}

pub async fn poll_access_token(
    client: &reqwest::Client,
    device_code: &str,
    current_interval: u64,
) -> Result<PollOutcome, String> {
    let response = client
        .post(ACCESS_TOKEN_URL)
        .header("Accept", "application/json")
        .form(&[
            ("client_id", CLIENT_ID),
            ("device_code", device_code),
            ("grant_type", DEVICE_GRANT_TYPE),
        ])
        .send()
        .await
        .map_err(super::network_error)?;

    let body = response.text().await.map_err(super::network_error)?;
    Ok(parse_access_token_response(&body, current_interval))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_every_poll_outcome() {
        assert_eq!(
            parse_access_token_response(
                r#"{"access_token":"gho_abc","token_type":"bearer","scope":"repo"}"#,
                5
            ),
            PollOutcome::Token("gho_abc".into())
        );
        assert_eq!(
            parse_access_token_response(r#"{"error":"authorization_pending"}"#, 5),
            PollOutcome::Pending
        );
        assert_eq!(
            parse_access_token_response(r#"{"error":"slow_down","interval":10}"#, 5),
            PollOutcome::SlowDown(10)
        );
        assert_eq!(
            parse_access_token_response(r#"{"error":"slow_down"}"#, 5),
            PollOutcome::SlowDown(10)
        );
        assert_eq!(
            parse_access_token_response(r#"{"error":"expired_token"}"#, 5),
            PollOutcome::Expired
        );
        assert_eq!(
            parse_access_token_response(r#"{"error":"access_denied"}"#, 5),
            PollOutcome::Denied
        );
        assert_eq!(
            parse_access_token_response(
                r#"{"error":"device_flow_disabled","error_description":"Device Flow must be explicitly enabled for this App"}"#,
                5
            ),
            PollOutcome::Failed("Device Flow must be explicitly enabled for this App".into())
        );
        assert!(matches!(
            parse_access_token_response("<html>", 5),
            PollOutcome::Failed(_)
        ));
    }

    #[test]
    fn parses_a_device_code() {
        let code: DeviceCode = serde_json::from_str(
            r#"{"device_code":"3584d83","user_code":"WDJB-MJHT","verification_uri":"https://github.com/login/device","expires_in":900,"interval":5}"#,
        )
        .unwrap();
        assert_eq!(code.user_code, "WDJB-MJHT");
        assert_eq!(code.interval, 5);
    }
}
