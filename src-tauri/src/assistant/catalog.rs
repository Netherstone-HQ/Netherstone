//! What the app knows about models: their limits, whether they think, and
//! whether they take images and PDFs. Built from models.dev and LiteLLM's
//! data by `scripts/ai-catalog.mjs` and shipped with the app; it updates
//! with the app, never online. A model it doesn't know still works, as text
//! only.

use super::providers::Api;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Facts {
    /// The name people know the model by.
    pub name: Option<String>,
    /// Tokens it reads and writes at most.
    pub context: Option<u64>,
    pub output: Option<u64>,
    pub reasoning: bool,
    pub tools: bool,
    pub images: bool,
    pub pdfs: bool,
    pub caching: bool,
    /// False for models a chat can't use (embeddings, images, speech).
    #[serde(skip_serializing)]
    pub chat: Option<bool>,
    /// Only on OpenAI's Responses API.
    pub responses_only: bool,
}

type Catalog = HashMap<String, HashMap<String, Facts>>;

fn catalog() -> &'static Catalog {
    static CATALOG: OnceLock<Catalog> = OnceLock::new();
    CATALOG.get_or_init(|| {
        serde_json::from_str(include_str!("catalog.json")).unwrap_or_else(|error| {
            eprintln!("[Netherstone] The model catalog didn't load: {error}");
            Catalog::new()
        })
    })
}

/// The catalog's list for models spoken as `api`.
fn section(api: Api) -> Option<&'static str> {
    match api {
        Api::OpenAi => Some("openai"),
        Api::Anthropic => Some("anthropic"),
        Api::Google => Some("google"),
        Api::OpenRouter => Some("openrouter"),
        Api::Ollama => None,
    }
}

/// What's known about `model`: the catalog's facts, else nothing.
pub fn facts(api: Api, model: &str) -> Facts {
    section(api)
        .and_then(|section| catalog().get(section)?.get(model))
        .cloned()
        .unwrap_or_default()
}

/// Whether a chat can use `model`. Unknown models can.
pub fn is_chat_model(facts: &Facts) -> bool {
    facts.chat != Some(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_bundled_catalog_loads_with_every_provider() {
        for section in ["openai", "anthropic", "google", "openrouter"] {
            let models = catalog().get(section).map(HashMap::len).unwrap_or(0);
            assert!(models > 0, "{section} has no models");
        }
    }

    #[test]
    fn an_unknown_model_counts_as_text_only_and_usable() {
        let facts = facts(Api::Anthropic, "a-model-nobody-has-heard-of");
        assert_eq!(facts, Facts::default());
        assert!(!facts.images && !facts.pdfs);
        assert!(is_chat_model(&facts));
        assert_eq!(super::facts(Api::Ollama, "llama3.2:3b"), Facts::default());
    }

    #[test]
    fn embedding_models_are_not_chat_models() {
        let facts = facts(Api::OpenAi, "text-embedding-3-small");
        assert!(!is_chat_model(&facts));
    }
}
