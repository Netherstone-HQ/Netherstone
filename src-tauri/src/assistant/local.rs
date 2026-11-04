//! Model servers running on this computer, and the addresses users type for
//! servers and Custom. Local servers are only looked for when asked, only
//! on this computer, and with a short wait.

use super::models::{self, Model, ProviderError, Target};
use super::providers::Api;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ServerKind {
    Ollama,
    LmStudio,
    LlamaCpp,
    /// Any other server speaking the OpenAI-style API.
    Other,
}

/// Each server's usual port. Ollama has its own API; the others speak the
/// OpenAI-style one.
const USUAL_PORTS: [(ServerKind, u16); 3] = [
    (ServerKind::Ollama, 11434),
    (ServerKind::LmStudio, 1234),
    (ServerKind::LlamaCpp, 8080),
];

/// Nothing to wait for on this computer: a server either answers at once or
/// isn't running.
const PROBE_CONNECT: Duration = Duration::from_millis(500);
const PROBE_TOTAL: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub kind: ServerKind,
    /// Scheme, host and port, like `http://localhost:11434`.
    pub address: String,
}

impl Server {
    pub fn target(&self) -> Target {
        let (api, path) = match self.kind {
            ServerKind::Ollama => (Api::Ollama, "/"),
            _ => (Api::OpenAi, "/v1/"),
        };
        Target {
            api,
            base_url: format!("{}{path}", self.address),
            key: None,
        }
    }
}

/// Reads a typed address, adding `http://` when it has no scheme. Only
/// http and https, and never a user name or password in it.
pub fn parse_address(text: &str) -> Result<Url, ProviderError> {
    let text = text.trim();
    let text = if text.contains("://") {
        text.to_string()
    } else {
        format!("http://{text}")
    };
    let url = Url::parse(&text).map_err(|_| ProviderError::BadAddress)?;
    let usable = matches!(url.scheme(), "http" | "https")
        && url.host().is_some()
        && url.username().is_empty()
        && url.password().is_none();
    usable.then_some(url).ok_or(ProviderError::BadAddress)
}

pub fn is_loopback(url: &Url) -> bool {
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|ip| ip.is_loopback())
}

/// `url` as an API base: its path, or `default_path` when it has none,
/// ending in `/`, without a query or fragment.
pub fn base_url(url: &Url, default_path: &str) -> String {
    let path = match url.path() {
        "" | "/" => default_path,
        path => path,
    };
    let path = path.trim_end_matches('/');
    format!("{}{path}/", origin(url))
}

fn origin(url: &Url) -> String {
    url.origin().ascii_serialization()
}

async fn answers(server: &Server) -> Option<Vec<Model>> {
    models::list_within(&server.target(), PROBE_CONNECT, PROBE_TOTAL)
        .await
        .ok()
}

/// The servers answering on their usual ports, with their models.
pub async fn find() -> Vec<(Server, Vec<Model>)> {
    let probes = USUAL_PORTS.map(|(kind, port)| async move {
        let server = Server {
            kind,
            address: format!("http://localhost:{port}"),
        };
        answers(&server).await.map(|models| (server, models))
    });
    futures_util::future::join_all(probes)
        .await
        .into_iter()
        .flatten()
        .collect()
}

/// The server at a typed address on this computer, if one answers there.
pub async fn at(address: &str) -> Result<(Server, Vec<Model>), ProviderError> {
    let url = parse_address(address)?;
    if !is_loopback(&url) {
        return Err(ProviderError::NotLocal);
    }
    let address = origin(&url);
    let ollama = Server {
        kind: ServerKind::Ollama,
        address: address.clone(),
    };
    if let Some(models) = answers(&ollama).await {
        return Ok((ollama, models));
    }
    let kind = USUAL_PORTS
        .iter()
        .find(|(kind, port)| {
            *kind != ServerKind::Ollama && url.port_or_known_default() == Some(*port)
        })
        .map_or(ServerKind::Other, |(kind, _)| *kind);
    let server = Server { kind, address };
    let models = models::list_within(&server.target(), PROBE_CONNECT, PROBE_TOTAL).await?;
    Ok((server, models))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_typed_addresses() {
        assert_eq!(
            parse_address(" localhost:8080 ").unwrap().as_str(),
            "http://localhost:8080/"
        );
        assert!(parse_address("ftp://localhost").is_err());
        assert!(parse_address("https://me:secret@api.example.com").is_err());
        assert!(parse_address("not an address").is_err());
    }

    #[test]
    fn only_this_computer_is_loopback() {
        for local in [
            "http://localhost:1234",
            "http://127.0.0.1:1",
            "http://[::1]:8080",
        ] {
            assert!(is_loopback(&parse_address(local).unwrap()), "{local}");
        }
        for remote in [
            "http://192.168.1.20:8000",
            "https://api.example.com",
            "http://localhost.example.com",
        ] {
            assert!(!is_loopback(&parse_address(remote).unwrap()), "{remote}");
        }
    }

    #[test]
    fn api_bases_end_in_a_slash_and_keep_their_path() {
        let base = |text| base_url(&parse_address(text).unwrap(), "/v1/");
        assert_eq!(
            base("https://api.example.com"),
            "https://api.example.com/v1/"
        );
        assert_eq!(
            base("https://api.example.com/inference/v1"),
            "https://api.example.com/inference/v1/"
        );
        assert_eq!(
            base("https://api.example.com/v1/?x=1#y"),
            "https://api.example.com/v1/"
        );
    }

    #[tokio::test]
    async fn a_typed_address_elsewhere_is_not_a_local_server() {
        assert_eq!(
            at("http://192.168.1.20:11434").await.unwrap_err(),
            ProviderError::NotLocal
        );
    }

    #[test]
    fn ollama_uses_its_own_api_and_the_others_the_openai_style_one() {
        let server = |kind| Server {
            kind,
            address: "http://localhost:1".to_string(),
        };
        assert_eq!(server(ServerKind::Ollama).target().api, Api::Ollama);
        assert_eq!(
            server(ServerKind::Ollama).target().base_url,
            "http://localhost:1/"
        );
        assert_eq!(
            server(ServerKind::LmStudio).target().base_url,
            "http://localhost:1/v1/"
        );
    }
}
