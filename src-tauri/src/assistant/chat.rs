//! One answer from a model: our own messages in, the answer streamed out.
//! genai carries every provider. No genai type leaves this file, and nothing here is kept by the provider: OpenAI's store stays off.
//!
//! Timeouts, retries and stop are ours: a long wait for the first token
//! (longer for a server on this computer, which may be loading a model), a
//! shorter one between tokens, and retries only before anything streamed.

use super::catalog;
use super::models::{self, ProviderError, Target};
use super::providers::Api;
use super::settings::Thinking;
use futures_util::StreamExt;
use genai::adapter::AdapterKind;
use genai::chat::{
    Binary, CacheControl, ChatMessage, ChatOptions, ChatRequest, ChatRole, ChatStreamEvent,
    ContentPart, CustomPart, MessageContent, ReasoningEffort, StopReason, ToolCall, ToolResponse,
};
use genai::resolver::{AuthData, Endpoint};
use genai::{ModelIden, ModelSpec, ServiceTarget};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tokio::sync::Notify;

// ── Messages ─────────────────────────────────────────────────────────────────

/// A message in a chat, as it's saved.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "role", rename_all = "camelCase")]
pub enum Message {
    User {
        text: String,
        /// Shards added with @ or as the open shard, as they read when sent.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        shards: Vec<Added>,
        /// Their images and PDFs.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        files: Vec<File>,
    },
    Assistant {
        text: String,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        calls: Vec<Call>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        reasoning: Option<Reasoning>,
    },
    Tool {
        results: Vec<CallResult>,
        /// Images and PDFs from the shards read, sent after the results.
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        files: Vec<File>,
    },
}

impl Message {
    pub fn user(text: impl Into<String>) -> Self {
        Message::User {
            text: text.into(),
            shards: Vec::new(),
            files: Vec::new(),
        }
    }

    /// The images and PDFs that go with it.
    pub fn files(&self) -> &[File] {
        match self {
            Message::User { files, .. } | Message::Tool { files, .. } => files,
            Message::Assistant { .. } => &[],
        }
    }

    pub fn files_mut(&mut self) -> &mut [File] {
        match self {
            Message::User { files, .. } | Message::Tool { files, .. } => files,
            Message::Assistant { .. } => &mut [],
        }
    }
}

/// A shard added to a user's message.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Added {
    /// Vault-relative.
    pub path: String,
    /// What reading it gave, with any note about its files.
    pub text: String,
}

/// A file from the vault that goes with a message. Only where it is
/// is saved; its data is read again for each request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct File {
    /// Vault-relative.
    pub path: String,
    pub mime: String,
    /// About how many tokens a model reads for it.
    pub tokens: u64,
    /// Base64, once read for a request. None when it isn't sent.
    #[serde(skip)]
    pub data: Option<Arc<str>>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Call {
    pub id: String,
    pub name: String,
    pub arguments: Value,
    /// Signatures some providers tie to a call.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub signatures: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CallResult {
    pub id: String,
    pub name: String,
    pub output: String,
}

/// A model's reasoning data, kept as it came: only the same model family
/// can read it back, so it's sent to that family alone.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reasoning {
    pub family: String,
    pub parts: Vec<ReasoningPart>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum ReasoningPart {
    Text(String),
    Signature(String),
    /// A provider's own block, such as encrypted reasoning.
    Block(Value),
}

/// A tool the model may call.
#[derive(Debug, Clone)]
pub struct ToolSpec {
    pub name: String,
    pub description: String,
    pub schema: Value,
}

pub struct Request<'a> {
    pub system: &'a str,
    pub messages: &'a [Message],
    pub tools: &'a [ToolSpec],
    pub model: &'a str,
    /// How much a model that can think does. None for one that can't.
    pub thinking: Option<Thinking>,
    /// Keeps requests of one chat on the same cache.
    pub cache_key: &'a str,
}

/// Which family of models a reasoning record belongs to.
pub fn family(target: &Target, model: &str) -> String {
    format!("{}|{}|{model}", api_name(target.api), target.base_url)
}

fn api_name(api: Api) -> &'static str {
    match api {
        Api::OpenAi => "openai",
        Api::Anthropic => "anthropic",
        Api::Google => "google",
        Api::OpenRouter => "openrouter",
        Api::Ollama => "ollama",
    }
}

// ── Answers ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Reply {
    pub text: String,
    pub calls: Vec<Call>,
    pub reasoning: Option<Reasoning>,
    pub usage: Usage,
    pub stop: Stop,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input: u64,
    pub output: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Stop {
    #[default]
    Done,
    Tools,
    /// The answer reached the model's output limit.
    Length,
    /// The provider held the answer back.
    Filtered,
}

pub enum Delta<'a> {
    Text(&'a str),
    Reasoning(&'a str),
    /// The call failed for now and is tried again after a wait.
    Retrying(ChatError),
}

/// Why a chat couldn't go on. The frontend words each one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChatError {
    KeyRefused,
    Unreachable,
    RateLimited,
    /// The provider is overloaded or failing for now.
    Busy,
    /// Nothing came for too long.
    TimedOut,
    /// The chat is longer than the model reads.
    TooLong,
    /// The model's context can't hold the assistant's instructions and
    /// tools with room for an answer.
    ContextTooSmall,
    /// Anything else the provider answered.
    Failed,
    Stopped,
    /// No model is picked, or its provider isn't set up anymore.
    NoModel,
    /// The assistant is off.
    TurnedOff,
    /// The vault is gone, or not open to the assistant.
    VaultClosed,
    /// The chat is already answering.
    Answering,
    NoChat,
    Storage,
}

impl From<ProviderError> for ChatError {
    fn from(error: ProviderError) -> Self {
        match error {
            ProviderError::KeyRefused => ChatError::KeyRefused,
            ProviderError::Unreachable => ChatError::Unreachable,
            ProviderError::RateLimited => ChatError::RateLimited,
            ProviderError::Storage => ChatError::Storage,
            _ => ChatError::Failed,
        }
    }
}

// ── Stop ─────────────────────────────────────────────────────────────────────

/// Stops a chat: from the Stop button, or when its window reloads or closes.
#[derive(Clone, Default)]
pub struct StopToken(Arc<(AtomicBool, Notify)>);

impl StopToken {
    pub fn stop(&self) {
        self.0.0.store(true, Ordering::SeqCst);
        self.0.1.notify_waiters();
    }

    pub fn is_stopped(&self) -> bool {
        self.0.0.load(Ordering::SeqCst)
    }

    pub async fn stopped(&self) {
        loop {
            let notified = self.0.1.notified();
            if self.is_stopped() {
                return;
            }
            notified.await;
        }
    }
}

// ── Timing ───────────────────────────────────────────────────────────────────

pub(super) const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

pub(super) struct Waits {
    /// For the first token, with the request's own setup.
    pub first: Duration,
    /// Between tokens after that.
    pub between: Duration,
}

pub(super) fn waits(target: &Target) -> Waits {
    match is_on_this_computer(target) {
        // It may load the model from disk first.
        true => Waits {
            first: Duration::from_secs(300),
            between: Duration::from_secs(120),
        },
        false => Waits {
            first: Duration::from_secs(120),
            between: Duration::from_secs(60),
        },
    }
}

fn is_on_this_computer(target: &Target) -> bool {
    reqwest::Url::parse(&target.base_url).is_ok_and(|url| super::local::is_loopback(&url))
}

const RETRIES: u32 = 3;
/// A provider asking for a longer wait than this gets a rate limit error.
const LONGEST_RETRY_WAIT: Duration = Duration::from_secs(30);

/// A call that failed, and whether it may be tried again.
pub(super) struct Failure {
    pub error: ChatError,
    pub retry_after: Option<Duration>,
    /// Something streamed already, so it must not be tried again.
    pub started: bool,
}

impl Failure {
    pub fn new(error: ChatError, started: bool) -> Self {
        Self {
            error,
            retry_after: None,
            started,
        }
    }

    fn retryable(&self) -> bool {
        !self.started
            && matches!(
                self.error,
                ChatError::RateLimited | ChatError::Busy | ChatError::Unreachable
            )
    }
}

pub(super) fn from_status(api: Api, status: u16) -> ChatError {
    match status {
        413 => ChatError::TooLong,
        // Overloaded (529), or failing for now.
        500 | 502 | 503 | 504 | 529 => ChatError::Busy,
        // Anthropic and OpenAI answer a chat that's too long with a 400,
        // as does Google an unknown key: the body says which, and it isn't
        // read, so it's a plain failure here unless it's Google.
        status => match models::from_status(api, Some(status), false) {
            ProviderError::NoModels => ChatError::Failed,
            error => error.into(),
        },
    }
}

/// The wait a provider asked for, from `retry-after-ms` or `retry-after`
/// in seconds.
pub(super) fn retry_after(headers: &reqwest::header::HeaderMap) -> Option<Duration> {
    let number =
        |name: &str| -> Option<f64> { headers.get(name)?.to_str().ok()?.trim().parse().ok() };
    number("retry-after-ms")
        .map(|ms| Duration::from_millis(ms.max(0.0) as u64))
        .or_else(|| number("retry-after").and_then(|s| Duration::try_from_secs_f64(s).ok()))
}

/// Streams one answer, trying again on a rate limit, an overloaded
/// provider or no answer, as long as nothing has streamed yet.
pub async fn stream(
    target: &Target,
    request: &Request<'_>,
    on_delta: &mut (dyn FnMut(Delta) + Send),
    stop: &StopToken,
) -> Result<Reply, ChatError> {
    let mut attempt = 0;
    loop {
        let failure = match stream_genai(target, request, on_delta, stop).await {
            Ok(reply) => return Ok(reply),
            Err(failure) => failure,
        };
        if !failure.retryable() || attempt >= RETRIES {
            return Err(failure.error);
        }
        let wait = failure
            .retry_after
            .unwrap_or(Duration::from_secs(1 << attempt));
        if wait > LONGEST_RETRY_WAIT {
            return Err(failure.error);
        }
        attempt += 1;
        on_delta(Delta::Retrying(failure.error));
        tokio::select! {
            _ = tokio::time::sleep(wait) => {}
            _ = stop.stopped() => return Err(ChatError::Stopped),
        }
    }
}

/// The genai route for `target`. OpenAI's newest models only answer on
/// its Responses API.
fn adapter_for(target: &Target, model: &str) -> AdapterKind {
    let responses = target.api == Api::OpenAi && catalog::facts(target.api, model).responses_only;
    match responses {
        true => AdapterKind::OpenAIResp,
        false => models::adapter(target.api),
    }
}

/// How a request to `target` is signed. genai's OpenAI-style adapter won't
/// send without a key, so a server that takes none (LM Studio, llama.cpp, a
/// Custom server without one) gets the request at its own address with no
/// key header.
fn auth_for(target: &Target, iden: &ModelIden) -> AuthData {
    match &target.key {
        Some(key) => AuthData::from_single(key.clone()),
        None if iden.adapter_kind == AdapterKind::OpenAI => AuthData::RequestOverride {
            url: format!("{}chat/completions", target.base_url),
            headers: genai::Headers::default(),
        },
        None => AuthData::None,
    }
}

async fn stream_genai(
    target: &Target,
    request: &Request<'_>,
    on_delta: &mut (dyn FnMut(Delta) + Send),
    stop: &StopToken,
) -> Result<Reply, Failure> {
    let failed = |error| Failure::new(error, false);
    let http = models::http_client(CONNECT_TIMEOUT).map_err(|e| failed(e.into()))?;
    let client = genai::Client::builder()
        .with_reqwest(http)
        .build()
        .map_err(|_| failed(ChatError::Failed))?;
    let iden = ModelIden::new(adapter_for(target, request.model), request.model);
    // Address and key are always given, so genai never looks for its own,
    // such as in environment variables.
    let service = ServiceTarget {
        endpoint: Endpoint::from_owned(target.base_url.clone()),
        auth: auth_for(target, &iden),
        model: iden.clone(),
    };
    let family = family(target, request.model);
    let chat = to_genai(request, &family, &iden);
    let options = options(target, request);
    let waits = waits(target);

    let started = tokio::select! {
        started = tokio::time::timeout(
            waits.first,
            client.exec_chat_stream(ModelSpec::Target(service), chat, Some(&options)),
        ) => started,
        _ = stop.stopped() => return Err(failed(ChatError::Stopped)),
    };
    let mut events = match started {
        Err(_) => return Err(failed(ChatError::TimedOut)),
        Ok(Err(error)) => return Err(genai_failure(target, &error, false)),
        Ok(Ok(response)) => response.stream,
    };

    let mut streamed = false;
    let mut think = ThinkSplit::default();
    loop {
        let wait = if streamed { waits.between } else { waits.first };
        let next = tokio::select! {
            next = tokio::time::timeout(wait, events.next()) => next,
            _ = stop.stopped() => return Err(Failure::new(ChatError::Stopped, streamed)),
        };
        let event = match next {
            Err(_) => return Err(Failure::new(ChatError::TimedOut, streamed)),
            // Cut off before its end.
            Ok(None) => return Err(Failure::new(ChatError::Failed, streamed)),
            Ok(Some(Err(error))) => return Err(genai_failure(target, &error, streamed)),
            Ok(Some(Ok(event))) => event,
        };
        match event {
            ChatStreamEvent::Chunk(chunk) => {
                streamed = true;
                think.feed(&chunk.content, on_delta);
            }
            ChatStreamEvent::ReasoningChunk(chunk) => {
                streamed = true;
                on_delta(Delta::Reasoning(&chunk.content));
            }
            ChatStreamEvent::ThoughtSignatureChunk(_) | ChatStreamEvent::ToolCallChunk(_) => {
                streamed = true;
            }
            ChatStreamEvent::End(end) => {
                think.finish(on_delta);
                let content = end.captured_content.unwrap_or_default();
                let usage = end.captured_usage.map_or(Usage::default(), |usage| Usage {
                    input: usage.prompt_tokens.unwrap_or(0).max(0) as u64,
                    output: usage.completion_tokens.unwrap_or(0).max(0) as u64,
                });
                let mut reply = from_genai(content, &family);
                reply.usage = usage;
                reply.stop = match end.captured_stop_reason {
                    _ if !reply.calls.is_empty() => Stop::Tools,
                    Some(StopReason::MaxTokens(_)) => Stop::Length,
                    Some(StopReason::ContentFilter(_)) => Stop::Filtered,
                    _ => Stop::Done,
                };
                return Ok(reply);
            }
            ChatStreamEvent::Start | ChatStreamEvent::Heartbeat => {}
        }
    }
}

const THINK_OPEN: &str = "<think>";
const THINK_CLOSE: &str = "</think>";

/// Splits a `<think>` block at the start of an answer into reasoning, as
/// local models give it in the text when the server doesn't split it.
#[derive(Default)]
struct ThinkSplit {
    state: ThinkState,
    held: String,
}

#[derive(Default, PartialEq)]
enum ThinkState {
    /// Not yet known whether the answer opens with a block.
    #[default]
    Start,
    Inside,
    After,
}

impl ThinkSplit {
    fn feed(&mut self, chunk: &str, out: &mut (dyn FnMut(Delta) + Send)) {
        match self.state {
            ThinkState::After => out(Delta::Text(chunk)),
            ThinkState::Start => {
                self.held.push_str(chunk);
                let start = self.held.trim_start();
                if let Some(rest) = start.strip_prefix(THINK_OPEN) {
                    let rest = rest.to_string();
                    self.held.clear();
                    self.state = ThinkState::Inside;
                    self.feed(&rest, out);
                } else if !THINK_OPEN.starts_with(start) {
                    self.state = ThinkState::After;
                    let held = std::mem::take(&mut self.held);
                    out(Delta::Text(&held));
                }
            }
            ThinkState::Inside => {
                self.held.push_str(chunk);
                if let Some(end) = self.held.find(THINK_CLOSE) {
                    let held = std::mem::take(&mut self.held);
                    out(Delta::Reasoning(&held[..end]));
                    self.state = ThinkState::After;
                    let rest = held[end + THINK_CLOSE.len()..].trim_start();
                    if !rest.is_empty() {
                        out(Delta::Text(rest));
                    }
                    return;
                }
                // Kept back: what could be the start of the closing tag.
                let mut cut = self.held.len().saturating_sub(THINK_CLOSE.len() - 1);
                while !self.held.is_char_boundary(cut) {
                    cut -= 1;
                }
                if cut > 0 {
                    let sure: String = self.held.drain(..cut).collect();
                    out(Delta::Reasoning(&sure));
                }
            }
        }
    }

    fn finish(&mut self, out: &mut (dyn FnMut(Delta) + Send)) {
        let held = std::mem::take(&mut self.held);
        if held.is_empty() {
            return;
        }
        match self.state {
            ThinkState::Inside => out(Delta::Reasoning(&held)),
            _ => out(Delta::Text(&held)),
        }
    }
}

/// `text` with a `<think>` block it opens with taken out, and that block.
fn split_think(text: &str) -> Option<(String, String)> {
    let rest = text.trim_start().strip_prefix(THINK_OPEN)?;
    let (thought, answer) = rest.split_once(THINK_CLOSE).unwrap_or((rest, ""));
    Some((answer.trim_start().to_string(), thought.trim().to_string()))
}

fn options(target: &Target, request: &Request<'_>) -> ChatOptions {
    let mut options = ChatOptions::default()
        .with_capture_content(true)
        .with_capture_tool_calls(true)
        .with_capture_reasoning_content(true)
        .with_capture_usage(true);
    if let Some(thinking) = request.thinking {
        options = options.with_reasoning_effort(match thinking {
            Thinking::Low => ReasoningEffort::Low,
            Thinking::Medium => ReasoningEffort::Medium,
            Thinking::High => ReasoningEffort::High,
        });
    }
    match target.api {
        // Anthropic caches only what's marked.
        Api::Anthropic => options.with_cache_control(CacheControl::Ephemeral),
        Api::OpenAi | Api::OpenRouter => options.with_prompt_cache_key(request.cache_key),
        Api::Google | Api::Ollama => options,
    }
}

/// What a failed genai call says, as our own kind. Its text is never shown
/// and is logged scrubbed.
fn genai_failure(target: &Target, error: &genai::Error, started: bool) -> Failure {
    eprintln!(
        "[Netherstone] A chat request failed: {}",
        models::scrub(
            error.to_string().lines().next().unwrap_or_default(),
            target.key.as_deref()
        )
    );
    // A stream wraps the failed response, or the connection's error.
    let inner = match error {
        genai::Error::WebStream { error, .. } => Some(error),
        _ => None,
    };
    let inner_genai = inner.and_then(|inner| inner.downcast_ref::<genai::Error>());
    let status = error
        .status()
        .or_else(|| inner_genai.and_then(genai::Error::status));
    let headers = error
        .headers()
        .or_else(|| inner_genai.and_then(genai::Error::headers));
    let unreachable = match error {
        genai::Error::WebModelCall {
            webc_error: genai::webc::Error::Reqwest(reqwest),
            ..
        } => reqwest.is_connect() || reqwest.is_timeout(),
        _ => inner
            .and_then(|inner| inner.downcast_ref::<reqwest::Error>())
            .is_some_and(|reqwest| reqwest.is_connect() || reqwest.is_timeout()),
    };
    let error = match status {
        Some(status) => from_status(target.api, status.as_u16()),
        None if unreachable => ChatError::Unreachable,
        None => ChatError::Failed,
    };
    Failure {
        error,
        retry_after: headers.and_then(retry_after),
        started,
    }
}

/// The files whose data was read, as parts to send.
fn binaries(files: &[File]) -> Vec<ContentPart> {
    files
        .iter()
        .filter_map(|file| {
            let data = file.data.clone()?;
            Some(ContentPart::Binary(Binary::from_base64(
                file.mime.clone(),
                data,
                Some(file.path.clone()),
            )))
        })
        .collect()
}

fn to_genai(request: &Request<'_>, family: &str, iden: &ModelIden) -> ChatRequest {
    let messages = request
        .messages
        .iter()
        .flat_map(|message| -> Vec<ChatMessage> {
            match message {
                Message::User {
                    text,
                    shards,
                    files,
                } => {
                    let mut full = text.clone();
                    for shard in shards {
                        full.push_str(&format!(
                            "\n\n<shard path=\"{}\">\n{}\n</shard>",
                            shard.path, shard.text
                        ));
                    }
                    let sent = binaries(files);
                    if sent.is_empty() {
                        return vec![ChatMessage::user(full)];
                    }
                    let mut parts = vec![ContentPart::Text(full)];
                    parts.extend(sent);
                    vec![ChatMessage::user(MessageContent::from_parts(parts))]
                }
                Message::Assistant {
                    text,
                    calls,
                    reasoning,
                } => {
                    // Reasoning goes back only to the family it came from.
                    let same = reasoning.as_ref().filter(|r| r.family == family);
                    let mut parts: Vec<ContentPart> = same
                        .map(|reasoning| {
                            reasoning
                                .parts
                                .iter()
                                .map(|part| match part {
                                    ReasoningPart::Text(text) => {
                                        ContentPart::ReasoningContent(text.clone())
                                    }
                                    ReasoningPart::Signature(sig) => {
                                        ContentPart::ThoughtSignature(sig.clone())
                                    }
                                    ReasoningPart::Block(data) => ContentPart::Custom(CustomPart {
                                        model_iden: Some(iden.clone()),
                                        data: data.clone(),
                                    }),
                                })
                                .collect()
                        })
                        .unwrap_or_default();
                    if !text.is_empty() {
                        parts.push(ContentPart::Text(text.clone()));
                    }
                    parts.extend(calls.iter().map(|call| {
                        ContentPart::ToolCall(ToolCall {
                            call_id: call.id.clone(),
                            fn_name: call.name.clone(),
                            fn_arguments: call.arguments.clone(),
                            thought_signatures: (same.is_some() && !call.signatures.is_empty())
                                .then(|| call.signatures.clone()),
                        })
                    }));
                    let message = ChatMessage::assistant(MessageContent::from_parts(parts));
                    if message.content.is_empty() {
                        Vec::new()
                    } else {
                        vec![message]
                    }
                }
                Message::Tool { results, files } => {
                    let mut messages = vec![ChatMessage::new(
                        ChatRole::Tool,
                        MessageContent::from_tool_responses(
                            results
                                .iter()
                                .map(|result| {
                                    ToolResponse::new(result.id.clone(), result.output.clone())
                                        .with_fn_name(result.name.clone())
                                })
                                .collect(),
                        ),
                    )];
                    // Not every provider takes files in a tool result, so they
                    // follow it as the user's.
                    let sent = binaries(files);
                    if !sent.is_empty() {
                        let mut parts = vec![ContentPart::Text(
                            "The images and PDFs of the shards just read:".to_string(),
                        )];
                        parts.extend(sent);
                        messages.push(ChatMessage::user(MessageContent::from_parts(parts)));
                    }
                    messages
                }
            }
        })
        .collect();
    let mut chat = ChatRequest::new(messages).with_system(request.system);
    if !request.tools.is_empty() {
        chat = chat.with_tools(
            request
                .tools
                .iter()
                .map(|tool| {
                    genai::chat::Tool::new(tool.name.clone())
                        .with_description(tool.description.clone())
                        .with_schema(tool.schema.clone())
                })
                .collect::<Vec<_>>(),
        );
    }
    chat.store = Some(false);
    chat
}

fn from_genai(content: MessageContent, family: &str) -> Reply {
    let mut reply = Reply::default();
    let mut reasoning = Vec::new();
    for part in content.into_parts() {
        match part {
            ContentPart::Text(text) => reply.text.push_str(&text),
            ContentPart::ReasoningContent(text) => reasoning.push(ReasoningPart::Text(text)),
            ContentPart::ThoughtSignature(sig) => reasoning.push(ReasoningPart::Signature(sig)),
            ContentPart::Custom(custom) => reasoning.push(ReasoningPart::Block(custom.data)),
            ContentPart::ToolCall(call) => reply.calls.push(Call {
                id: call.call_id,
                name: call.fn_name,
                arguments: call.fn_arguments,
                signatures: call.thought_signatures.unwrap_or_default(),
            }),
            ContentPart::Binary(_) | ContentPart::ToolResponse(_) => {}
        }
    }
    if reasoning.is_empty()
        && let Some((answer, thought)) = split_think(&reply.text)
    {
        reply.text = answer;
        if !thought.is_empty() {
            reasoning.push(ReasoningPart::Text(thought));
        }
    }
    let has_signed_calls = reply.calls.iter().any(|call| !call.signatures.is_empty());
    if !reasoning.is_empty() || has_signed_calls {
        reply.reasoning = Some(Reasoning {
            family: family.to_string(),
            parts: reasoning,
        });
    }
    reply
}

#[cfg(test)]
pub(super) mod tests;
