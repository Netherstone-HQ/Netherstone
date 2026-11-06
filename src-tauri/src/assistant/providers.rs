//! The providers the assistant can use, one row each in [`PROVIDERS`]:
//! where each one is, how it takes a key and where its key is kept, so
//! adding a provider is data.

use crate::credentials::{self, Credential};
use crate::links;
use serde::{Deserialize, Serialize};

/// How a provider's API is spoken. Each has its own route through genai.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Api {
    OpenAi,
    Anthropic,
    Google,
    OpenRouter,
    Ollama,
}

/// What file sizes a provider takes with a message, from its own docs.
/// `None` where the docs give no number.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Limits {
    /// The whole request, text and files together.
    pub request_bytes: Option<u64>,
    pub image_bytes: Option<u64>,
    pub pdf_bytes: Option<u64>,
    pub pdf_pages: Option<u32>,
}

const MB: u64 = 1_000_000;

impl Limits {
    pub const UNKNOWN: Limits = Limits {
        request_bytes: None,
        image_bytes: None,
        pdf_bytes: None,
        pdf_pages: None,
    };

    /// The known limits for a provider spoken as `api`.
    pub fn of(api: Api) -> Limits {
        match api {
            // Images are capped at 10 MB once base64-encoded, so 7.5 MB as
            // files. Pages drop to 100 for models under a 1M context.
            Api::Anthropic => Limits {
                request_bytes: Some(128 * MB),
                image_bytes: Some(10 * MB / 4 * 3),
                pdf_bytes: None,
                pdf_pages: Some(100),
            },
            Api::OpenAi => Limits {
                request_bytes: Some(512 * MB),
                image_bytes: None,
                pdf_bytes: Some(50 * MB),
                pdf_pages: None,
            },
            // Files sent inline share the 20 MB request cap.
            Api::Google => Limits {
                request_bytes: Some(20 * MB),
                image_bytes: None,
                pdf_bytes: Some(20 * MB),
                pdf_pages: Some(1000),
            },
            Api::OpenRouter | Api::Ollama => Limits::UNKNOWN,
        }
    }
}

/// How a provider is set up in Settings.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Setup {
    /// A key pasted from the provider's site.
    Key,
    /// Servers running on this computer, found on their usual ports.
    Local,
    /// Any address that speaks one of the APIs, with an optional key.
    Custom,
}

pub struct Provider {
    pub id: &'static str,
    pub name: &'static str,
    pub setup: Setup,
    /// The provider's API and address, for providers in one place.
    pub api: Option<Api>,
    pub base_url: Option<&'static str>,
    /// Where the provider's key is kept.
    pub credential: Option<&'static Credential>,
    /// The page where users get a key.
    pub key_page: Option<&'static str>,
}

pub const PROVIDERS: &[Provider] = &[
    Provider {
        id: "openai",
        name: "OpenAI",
        setup: Setup::Key,
        api: Some(Api::OpenAi),
        base_url: Some(links::OPENAI_API),
        credential: Some(&credentials::OPENAI_KEY),
        key_page: Some(links::OPENAI_KEYS),
    },
    Provider {
        id: "anthropic",
        name: "Anthropic",
        setup: Setup::Key,
        api: Some(Api::Anthropic),
        base_url: Some(links::ANTHROPIC_API),
        credential: Some(&credentials::ANTHROPIC_KEY),
        key_page: Some(links::ANTHROPIC_KEYS),
    },
    Provider {
        id: "google",
        name: "Google",
        setup: Setup::Key,
        api: Some(Api::Google),
        base_url: Some(links::GOOGLE_API),
        credential: Some(&credentials::GOOGLE_KEY),
        key_page: Some(links::GOOGLE_KEYS),
    },
    Provider {
        id: "openrouter",
        name: "OpenRouter",
        setup: Setup::Key,
        api: Some(Api::OpenRouter),
        base_url: Some(links::OPENROUTER_API),
        credential: Some(&credentials::OPENROUTER_KEY),
        key_page: Some(links::OPENROUTER_KEYS),
    },
    Provider {
        id: "local",
        name: "Local server",
        setup: Setup::Local,
        api: None,
        base_url: None,
        credential: None,
        key_page: None,
    },
    Provider {
        id: "custom",
        name: "Custom",
        setup: Setup::Custom,
        api: None,
        base_url: None,
        credential: Some(&credentials::CUSTOM_KEY),
        key_page: None,
    },
];

pub fn find(id: &str) -> Result<&'static Provider, String> {
    PROVIDERS
        .iter()
        .find(|provider| provider.id == id)
        .ok_or_else(|| format!("No provider called {id}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_provider_is_complete_for_its_setup() {
        for provider in PROVIDERS {
            match provider.setup {
                Setup::Key => {
                    assert!(provider.api.is_some(), "{}", provider.id);
                    assert!(provider.credential.is_some(), "{}", provider.id);
                    assert!(provider.key_page.is_some(), "{}", provider.id);
                    let url = provider.base_url.unwrap();
                    // Keys only go to the provider's own https address.
                    assert!(url.starts_with("https://") && url.ends_with('/'), "{url}");
                }
                Setup::Local => assert!(provider.credential.is_none()),
                Setup::Custom => assert!(provider.base_url.is_none()),
            }
        }
    }

    #[test]
    fn ids_are_unique() {
        for (i, a) in PROVIDERS.iter().enumerate() {
            assert!(PROVIDERS[i + 1..].iter().all(|b| b.id != a.id));
        }
    }
}
