//! Talking to providers, through genai, behind our own types: no genai type
//! leaves this file, so any provider can move to its own adapter later.
//! Keys go in headers only, to the address they were saved for, and never
//! along a redirect. Errors come back as our own kinds, never as provider
//! text, which can hold addresses and account details.

use super::catalog::{self, Facts};
use super::providers::Api;
use genai::adapter::AdapterKind;
use genai::resolver::{AuthData, Endpoint, ProviderConfig};
use serde::Serialize;
use std::time::Duration;

/// Where to send a request, and with what key.
#[derive(Debug, Clone)]
pub struct Target {
    pub api: Api,
    /// Ends in `/`; paths are added after it.
    pub base_url: String,
    pub key: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Model {
    pub id: String,
    #[serde(flatten)]
    pub facts: Facts,
}

/// Why a provider couldn't be used. The frontend words each one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ProviderError {
    /// The provider turned the key down.
    KeyRefused,
    /// No answer: offline, a wrong address or a server that isn't running.
    Unreachable,
    /// It answered, but with no models: not an API we speak.
    NoModels,
    RateLimited,
    /// A key would go to another computer over plain http.
    Insecure,
    /// A local server's address isn't on this computer.
    NotLocal,
    BadAddress,
    /// Anything else the provider answered.
    Failed,
    /// The key couldn't be saved or read on this computer.
    Storage,
}

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const TIMEOUT: Duration = Duration::from_secs(30);

fn http_client(connect: Duration, total: Duration) -> Result<reqwest::Client, ProviderError> {
    reqwest::Client::builder()
        .user_agent(concat!("Netherstone/", env!("CARGO_PKG_VERSION")))
        // A redirect could carry the key's header to another host.
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(connect)
        .timeout(total)
        .build()
        .map_err(|_| ProviderError::Failed)
}

fn adapter(api: Api) -> AdapterKind {
    match api {
        Api::OpenAi => AdapterKind::OpenAI,
        Api::Anthropic => AdapterKind::Anthropic,
        Api::Google => AdapterKind::Gemini,
        Api::OpenRouter => AdapterKind::OpenRouter,
        Api::Ollama => AdapterKind::Ollama,
    }
}

/// The models `target` offers a chat, by name. Asking for them is also how
/// a key is checked before it's saved.
pub async fn list(target: &Target) -> Result<Vec<Model>, ProviderError> {
    list_within(target, CONNECT_TIMEOUT, TIMEOUT).await
}

pub async fn list_within(
    target: &Target,
    connect: Duration,
    total: Duration,
) -> Result<Vec<Model>, ProviderError> {
    let http = http_client(connect, total)?;
    // OpenRouter lists its models to anyone, so its key is checked apart.
    if target.api == Api::OpenRouter
        && let Some(key) = &target.key
    {
        check_openrouter_key(&http, target, key).await?;
    }

    let client = genai::Client::builder()
        .with_reqwest(http)
        .build()
        .map_err(|_| ProviderError::Failed)?;
    // Both are always given, so genai never looks for keys or addresses of
    // its own, such as in environment variables.
    let config = ProviderConfig {
        endpoint: Some(Endpoint::from_owned(target.base_url.clone())),
        auth: Some(
            target
                .key
                .clone()
                .map_or(AuthData::None, AuthData::from_single),
        ),
    };
    let names = client
        .all_model_names(adapter(target.api), config)
        .await
        .map_err(|error| {
            log(target, &error.to_string());
            from_status(
                target.api,
                error.status().map(|s| s.as_u16()),
                is_unreachable(&error),
            )
        })?;

    let mut models: Vec<Model> = names
        .into_iter()
        .map(|id| Model {
            facts: catalog::facts(target.api, &id),
            id,
        })
        .filter(|model| catalog::is_chat_model(&model.facts))
        .collect();
    if models.is_empty() {
        return Err(ProviderError::NoModels);
    }
    models.sort_by(|a, b| display_name(a).cmp(display_name(b)));
    Ok(models)
}

fn display_name(model: &Model) -> &str {
    model.facts.name.as_deref().unwrap_or(&model.id)
}

async fn check_openrouter_key(
    http: &reqwest::Client,
    target: &Target,
    key: &str,
) -> Result<(), ProviderError> {
    let response = http
        .get(format!("{}key", target.base_url))
        .bearer_auth(key)
        .send()
        .await
        .map_err(|error| {
            log(target, &error.to_string());
            from_status(target.api, None, error.is_connect() || error.is_timeout())
        })?;
    match response.status().as_u16() {
        200..=299 => Ok(()),
        status => Err(from_status(target.api, Some(status), false)),
    }
}

/// Whether nothing answered at all.
fn is_unreachable(error: &genai::Error) -> bool {
    matches!(
        error,
        genai::Error::WebAdapterCall {
            webc_error: genai::webc::Error::Reqwest(reqwest),
            ..
        } if reqwest.is_connect() || reqwest.is_timeout()
    )
}

fn from_status(api: Api, status: Option<u16>, unreachable: bool) -> ProviderError {
    match status {
        // Google answers a key it doesn't know with a 400.
        Some(401 | 403) => ProviderError::KeyRefused,
        Some(400) if api == Api::Google => ProviderError::KeyRefused,
        Some(429) => ProviderError::RateLimited,
        Some(404) => ProviderError::NoModels,
        Some(_) => ProviderError::Failed,
        None if unreachable => ProviderError::Unreachable,
        // It answered, but not with JSON we read.
        None => ProviderError::NoModels,
    }
}

fn log(target: &Target, detail: &str) {
    eprintln!(
        "[Netherstone] A model list request failed: {}",
        scrub(
            detail.lines().next().unwrap_or_default(),
            target.key.as_deref()
        )
    );
}

/// `text` without anything that could identify the user or their key:
/// the key itself, addresses, query strings, header values and anything
/// shaped like a key or an account id.
pub fn scrub(text: &str, key: Option<&str>) -> String {
    let text = match key.filter(|key| !key.is_empty()) {
        Some(key) => text.replace(key, "[key]"),
        None => text.to_string(),
    };
    let lines: Vec<String> = text.lines().map(scrub_line).collect();
    lines.join("\n")
}

const SECRET_HEADERS: [&str; 4] = ["authorization", "x-api-key", "x-goog-api-key", "api-key"];

fn scrub_line(line: &str) -> String {
    let lower = line.to_ascii_lowercase();
    for header in SECRET_HEADERS {
        if let Some(at) = lower.find(&format!("{header}:")) {
            return format!("{}{header}: [hidden]", scrub_words(&line[..at]));
        }
    }
    scrub_words(line)
}

fn is_word_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || "-_.:/?=&%+~".contains(c)
}

fn scrub_words(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut word = String::new();
    for c in line.chars().chain(std::iter::once('\n')) {
        if is_word_char(c) {
            word.push(c);
            continue;
        }
        out.push_str(&scrub_word(&word));
        word.clear();
        if c != '\n' {
            out.push(c);
        }
    }
    out
}

/// Long enough, and mixed enough, to be a key or an id rather than a word.
const SECRET_LENGTH: usize = 20;

fn scrub_word(word: &str) -> String {
    if word.contains("://") {
        return "[address]".to_string();
    }
    let word = word.split_once('?').map_or(word, |(before, _)| before);
    let has_letter = word.chars().any(|c| c.is_ascii_alphabetic());
    let has_digit = word.chars().any(|c| c.is_ascii_digit());
    if word.len() >= SECRET_LENGTH && has_letter && has_digit && !word.contains('/') {
        return "[hidden]".to_string();
    }
    word.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    /// A provider on this computer: answers every request with `status` and
    /// `body`, and keeps what each request sent.
    struct FakeServer {
        url: String,
        requests: Arc<Mutex<Vec<String>>>,
    }

    fn serve(status: u16, body: &'static str) -> FakeServer {
        serve_with(move |_| (status, body.to_string(), String::new()))
    }

    fn serve_with(answer: impl Fn(&str) -> (u16, String, String) + Send + 'static) -> FakeServer {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        let requests = Arc::new(Mutex::new(Vec::new()));
        let kept = requests.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { return };
                let mut reader = BufReader::new(stream.try_clone().unwrap());
                let mut request = String::new();
                let mut length = 0;
                loop {
                    let mut line = String::new();
                    if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                        break;
                    }
                    if let Some(value) = line.to_ascii_lowercase().strip_prefix("content-length:") {
                        length = value.trim().parse().unwrap_or(0);
                    }
                    request.push_str(&line);
                }
                let mut body = vec![0; length];
                let _ = reader.read_exact(&mut body);
                kept.lock().unwrap().push(request.clone());
                let (status, body, headers) = answer(&request);
                let _ = write!(
                    stream,
                    "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n{headers}\r\n{body}",
                    body.len()
                );
            }
        });
        FakeServer { url, requests }
    }

    impl FakeServer {
        fn target(&self, api: Api, key: Option<&str>) -> Target {
            Target {
                api,
                base_url: self.url.clone(),
                key: key.map(str::to_string),
            }
        }

        fn requests(&self) -> Vec<String> {
            self.requests.lock().unwrap().clone()
        }
    }

    const KEY: &str = "sk-test-0123456789abcdefSECRET";

    /// The model list each API answers with, and the header its key goes in.
    fn cases() -> [(Api, &'static str, &'static str); 5] {
        [
            (
                Api::OpenAi,
                r#"{"data":[{"id":"gpt-5.5"},{"id":"text-embedding-3-small"}]}"#,
                "authorization: bearer ",
            ),
            (
                Api::Anthropic,
                r#"{"data":[{"id":"claude-sonnet-5-5"}]}"#,
                "x-api-key: ",
            ),
            (
                Api::Google,
                r#"{"models":[{"name":"models/gemini-3.5-flash"}]}"#,
                "x-goog-api-key: ",
            ),
            (
                Api::OpenRouter,
                r#"{"data":[{"id":"google/gemma-4-31b-it:free"}]}"#,
                "authorization: bearer ",
            ),
            (
                Api::Ollama,
                r#"{"models":[{"name":"llama3.2:3b","model":"llama3.2:3b"}]}"#,
                "",
            ),
        ]
    }

    #[tokio::test]
    async fn lists_models_through_genai_for_every_provider_with_the_key_in_a_header() {
        for (api, body, header) in cases() {
            let key = (api != Api::Ollama).then_some(KEY);
            let server = serve_with(move |request| {
                // OpenRouter's key check.
                if request.starts_with("GET /key") {
                    return (200, "{}".to_string(), String::new());
                }
                (200, body.to_string(), String::new())
            });
            let models = list(&server.target(api, key)).await.unwrap();
            assert!(!models.is_empty(), "{api:?}");
            // Embedding models aren't offered for chat.
            assert!(models.iter().all(|m| m.id != "text-embedding-3-small"));

            for request in server.requests() {
                let first_line = request.lines().next().unwrap();
                assert!(
                    !first_line.contains(KEY),
                    "{api:?} sent the key in the address"
                );
                if !header.is_empty() {
                    assert!(
                        request
                            .to_ascii_lowercase()
                            .contains(&format!("{header}{}", KEY.to_ascii_lowercase())),
                        "{api:?}: {request}"
                    );
                }
            }
        }
    }

    #[tokio::test]
    async fn known_models_carry_the_catalog_facts() {
        let server = serve(
            200,
            r#"{"data":[{"id":"claude-sonnet-5-5"},{"id":"claude-next"}]}"#,
        );
        let models = list(&server.target(Api::Anthropic, Some(KEY)))
            .await
            .unwrap();
        let known = models.iter().find(|m| m.id == "claude-sonnet-5-5").unwrap();
        assert!(known.facts.images && known.facts.pdfs && known.facts.name.is_some());
        let unknown = models.iter().find(|m| m.id == "claude-next").unwrap();
        assert_eq!(unknown.facts, Facts::default());
    }

    #[tokio::test]
    async fn a_refused_key_is_reported_without_the_key_or_the_answer() {
        for (api, _, _) in cases() {
            let server = serve(
                401,
                r#"{"error":{"message":"bad key sk-test-0123456789abcdefSECRET","user_id":"user_3CUzU0CH9SZRfTCa73"}}"#,
            );
            let error = list(&server.target(api, Some(KEY))).await.unwrap_err();
            assert_eq!(error, ProviderError::KeyRefused, "{api:?}");
            let shown = serde_json::to_string(&error).unwrap();
            assert!(!shown.contains(KEY) && !shown.contains("user_"));
        }
    }

    #[tokio::test]
    async fn google_reports_an_unknown_key_with_a_400() {
        let server = serve(400, r#"{"error":{"status":"INVALID_ARGUMENT"}}"#);
        let error = list(&server.target(Api::Google, Some(KEY)))
            .await
            .unwrap_err();
        assert_eq!(error, ProviderError::KeyRefused);
    }

    #[tokio::test]
    async fn the_openrouter_key_is_checked_since_its_list_is_open() {
        let server = serve_with(|request| {
            if request.starts_with("GET /key") {
                (401, "{}".to_string(), String::new())
            } else {
                (
                    200,
                    r#"{"data":[{"id":"openai/gpt-5"}]}"#.to_string(),
                    String::new(),
                )
            }
        });
        let error = list(&server.target(Api::OpenRouter, Some(KEY)))
            .await
            .unwrap_err();
        assert_eq!(error, ProviderError::KeyRefused);
    }

    #[tokio::test]
    async fn an_address_with_nothing_running_is_unreachable() {
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let target = Target {
            api: Api::OpenAi,
            base_url: format!("http://127.0.0.1:{port}/v1/"),
            key: Some(KEY.to_string()),
        };
        assert_eq!(list(&target).await.unwrap_err(), ProviderError::Unreachable);
    }

    #[tokio::test]
    async fn an_address_that_isnt_an_api_has_no_models() {
        let server = serve(200, r#"{"hello":"world"}"#);
        let error = list(&server.target(Api::OpenAi, None)).await.unwrap_err();
        assert_eq!(error, ProviderError::NoModels);
    }

    #[tokio::test]
    async fn a_redirect_is_not_followed_so_the_key_stays_put() {
        let elsewhere = serve(200, r#"{"data":[{"id":"gpt-5.5"}]}"#);
        let location = format!("location: {}models\r\n", elsewhere.url);
        let server = serve_with(move |_| (302, "{}".to_string(), location.clone()));
        for api in [Api::OpenAi, Api::Anthropic, Api::Google] {
            assert!(list(&server.target(api, Some(KEY))).await.is_err());
        }
        assert!(elsewhere.requests().is_empty());
    }

    /// Lists models from the real providers with the keys in these
    /// environment variables, skipping any not set:
    /// `cargo test live_model_lists -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn live_model_lists() {
        for (id, variable) in [
            ("openai", "OPENAI_TEST_KEY"),
            ("anthropic", "ANTHROPIC_TEST_KEY"),
            ("google", "GEMINI_TEST_KEY"),
            ("openrouter", "OPENROUTER_TEST_KEY"),
        ] {
            let Ok(key) = std::env::var(variable) else {
                continue;
            };
            let provider = super::super::providers::find(id).unwrap();
            let target = Target {
                api: provider.api.unwrap(),
                base_url: provider.base_url.unwrap().to_string(),
                key: Some(key.clone()),
            };
            let models = list(&target).await.unwrap();
            println!(
                "{id}: {} models, first {:?}",
                models.len(),
                models.first().map(|m| &m.id)
            );
            let refused = Target {
                key: Some(format!("{key}x")),
                ..target
            };
            assert_eq!(
                list(&refused).await.unwrap_err(),
                ProviderError::KeyRefused,
                "{id}"
            );
        }
    }

    #[test]
    fn scrub_hides_keys_addresses_headers_and_ids() {
        let text = "Request to https://api.example.com/v1/models?key=abc failed\n\
                    x-api-key: sk-ant-whatever\n\
                    {\"error\":\"bad\",\"user_id\":\"user_3CUzU0CH9SZRfTCa73VLREhQVpK\"} with sk-test-0123456789abcdefSECRET\n\
                    Status 401 Unauthorized for model claude-sonnet-5-5";
        let scrubbed = scrub(text, Some(KEY));
        assert!(!scrubbed.contains("example.com"), "{scrubbed}");
        assert!(!scrubbed.contains("key=abc"));
        assert!(!scrubbed.contains("sk-ant-whatever"));
        assert!(!scrubbed.contains("3CUzU0CH9SZRfTCa73VLREhQVpK"));
        assert!(!scrubbed.contains(KEY));
        // Plain words and model names stay readable.
        assert!(scrubbed.contains("Status 401 Unauthorized for model claude-sonnet-5-5"));
    }
}
