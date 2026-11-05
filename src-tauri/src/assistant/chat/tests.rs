use super::*;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::Mutex;

/// What the fake provider answers one request with.
#[derive(Clone)]
pub struct Answer {
    pub status: u16,
    pub content_type: &'static str,
    pub body: Vec<u8>,
    pub headers: String,
    /// Sends the first `hold.0` bytes, then waits `hold.1` before the rest.
    pub hold: Option<(usize, Duration)>,
}

impl Answer {
    pub fn ok(content_type: &'static str, body: impl Into<Vec<u8>>) -> Self {
        Self {
            status: 200,
            content_type,
            body: body.into(),
            headers: String::new(),
            hold: None,
        }
    }

    pub fn status(status: u16, body: &str) -> Self {
        Self {
            status,
            ..Self::ok("application/json", body)
        }
    }

    /// A recorded response in `fixtures/`, by file name.
    pub fn recorded(name: &str) -> Self {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/assistant/chat/fixtures")
            .join(name);
        let body = std::fs::read(&path).unwrap_or_else(|_| panic!("no fixture {name}"));
        let content_type = match name.ends_with(".ndjson") {
            true => "application/x-ndjson",
            false => "text/event-stream",
        };
        Self::ok(content_type, body)
    }
}

/// A provider on this computer that answers requests in turn, the last
/// answer again once they run out, and keeps what each request sent.
pub struct FakeServer {
    pub url: String,
    requests: Arc<Mutex<Vec<String>>>,
}

pub fn serve(answers: Vec<Answer>) -> FakeServer {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    let requests = Arc::new(Mutex::new(Vec::new()));
    let kept = requests.clone();
    std::thread::spawn(move || {
        for (i, stream) in listener.incoming().enumerate() {
            let Ok(mut stream) = stream else { return };
            let answer = answers[i.min(answers.len() - 1)].clone();
            let kept = kept.clone();
            std::thread::spawn(move || {
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
                request.push_str("\r\n");
                request.push_str(&String::from_utf8_lossy(&body));
                kept.lock().unwrap().push(request);
                let _ = write!(
                    stream,
                    "HTTP/1.1 {} X\r\ncontent-type: {}\r\nconnection: close\r\n{}\r\n",
                    answer.status, answer.content_type, answer.headers
                );
                match answer.hold {
                    Some((first, wait)) => {
                        let first = first.min(answer.body.len());
                        let _ = stream.write_all(&answer.body[..first]);
                        let _ = stream.flush();
                        std::thread::sleep(wait);
                        let _ = stream.write_all(&answer.body[first..]);
                    }
                    None => {
                        let _ = stream.write_all(&answer.body);
                    }
                }
            });
        }
    });
    FakeServer { url, requests }
}

impl FakeServer {
    pub fn target(&self, api: Api, key: Option<&str>) -> Target {
        Target {
            api,
            base_url: self.url.clone(),
            key: key.map(str::to_string),
        }
    }

    pub fn requests(&self) -> Vec<String> {
        self.requests.lock().unwrap().clone()
    }
}

pub const KEY: &str = "sk-test-0123456789abcdefSECRET";

const OPENAI_TEXT: &str = "data: {\"id\":\"c\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"Hel\"}}]}\n\n\
data: {\"id\":\"c\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"lo\"},\"finish_reason\":\"stop\"}]}\n\n\
data: [DONE]\n\n";

fn request<'a>(messages: &'a [Message]) -> Request<'a> {
    Request {
        system: "Be brief.",
        messages,
        tools: &[],
        model: "gpt-5.5",
        thinking: false,
        cache_key: "chat",
    }
}

async fn stream_text(target: &Target, messages: &[Message]) -> Result<(Reply, String), ChatError> {
    let mut streamed = String::new();
    let reply = stream(
        target,
        &request(messages),
        &mut |delta| {
            if let Delta::Text(text) = delta {
                streamed.push_str(text);
            }
        },
        &StopToken::default(),
    )
    .await?;
    Ok((reply, streamed))
}

fn hello() -> Vec<Message> {
    vec![Message::User {
        text: "Hi".to_string(),
    }]
}

#[tokio::test]
async fn streams_text_and_keeps_the_key_in_a_header() {
    let server = serve(vec![Answer::ok("text/event-stream", OPENAI_TEXT)]);
    let (reply, streamed) = stream_text(&server.target(Api::OpenAi, Some(KEY)), &hello())
        .await
        .unwrap();
    assert_eq!((reply.text.as_str(), streamed.as_str()), ("Hello", "Hello"));
    let request = &server.requests()[0];
    assert!(!request.lines().next().unwrap().contains(KEY));
    assert!(request.to_ascii_lowercase().contains(&format!(
        "authorization: bearer {}",
        KEY.to_ascii_lowercase()
    )));
    // Nothing is kept on the provider's side.
    assert!(!request.contains("\"store\":true"));
}

#[tokio::test]
async fn a_rate_limit_is_tried_again_after_the_wait_asked_for() {
    let mut limited = Answer::status(429, r#"{"error":"slow down"}"#);
    limited.headers = "retry-after-ms: 50\r\n".to_string();
    let server = serve(vec![limited, Answer::ok("text/event-stream", OPENAI_TEXT)]);
    let (reply, _) = stream_text(&server.target(Api::OpenAi, Some(KEY)), &hello())
        .await
        .unwrap();
    assert_eq!(reply.text, "Hello");
    assert_eq!(server.requests().len(), 2);
}

#[tokio::test]
async fn a_long_wait_asked_for_is_reported_rather_than_waited() {
    let mut limited = Answer::status(429, "{}");
    limited.headers = "retry-after: 3600\r\n".to_string();
    let server = serve(vec![limited]);
    let error = stream_text(&server.target(Api::OpenAi, Some(KEY)), &hello())
        .await
        .unwrap_err();
    assert_eq!(error, ChatError::RateLimited);
    assert_eq!(server.requests().len(), 1);
}

#[tokio::test]
async fn nothing_is_tried_again_once_text_streamed() {
    // Cut off after the first chunk.
    let cut = OPENAI_TEXT.split("\n\n").next().unwrap().to_string() + "\n\n";
    let server = serve(vec![Answer::ok("text/event-stream", cut)]);
    let error = stream_text(&server.target(Api::OpenAi, Some(KEY)), &hello())
        .await
        .unwrap_err();
    assert_eq!(error, ChatError::Failed);
    assert_eq!(server.requests().len(), 1);
}

#[tokio::test]
async fn refused_keys_and_offline_providers_are_reported_without_the_key() {
    for api in [Api::OpenAi, Api::Anthropic, Api::Google, Api::OpenRouter] {
        let server = serve(vec![Answer::status(
            401,
            r#"{"error":{"message":"bad key sk-test-0123456789abcdefSECRET"}}"#,
        )]);
        let error = stream_text(&server.target(api, Some(KEY)), &hello())
            .await
            .unwrap_err();
        assert_eq!(error, ChatError::KeyRefused, "{api:?}");
        assert!(!serde_json::to_string(&error).unwrap().contains(KEY));
    }
    let port = TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    let offline = Target {
        api: Api::OpenAi,
        base_url: format!("http://127.0.0.1:{port}/v1/"),
        key: Some(KEY.to_string()),
    };
    assert_eq!(
        stream_text(&offline, &hello()).await.unwrap_err(),
        ChatError::Unreachable
    );
}

#[tokio::test]
async fn stop_ends_a_stream_at_once() {
    let mut slow = Answer::ok("text/event-stream", OPENAI_TEXT);
    slow.hold = Some((
        OPENAI_TEXT.find("\n\n").unwrap() + 2,
        Duration::from_secs(30),
    ));
    let server = serve(vec![slow]);
    let stop = StopToken::default();
    let stopper = stop.clone();
    let target = server.target(Api::OpenAi, Some(KEY));
    let messages = hello();
    let started = std::time::Instant::now();
    let error = stream(
        &target,
        &request(&messages),
        &mut |delta| {
            if let Delta::Text(_) = delta {
                stopper.stop();
            }
        },
        &stop,
    )
    .await
    .unwrap_err();
    assert_eq!(error, ChatError::Stopped);
    assert!(started.elapsed() < Duration::from_secs(5));
}

#[test]
fn reasoning_goes_back_only_to_its_own_family() {
    let target = Target {
        api: Api::Anthropic,
        base_url: "https://api.anthropic.com/v1/".to_string(),
        key: None,
    };
    let same = family(&target, "model-a");
    let messages = vec![
        Message::User { text: "Hi".into() },
        Message::Assistant {
            text: "Let me look.".into(),
            calls: vec![Call {
                id: "c1".into(),
                name: "read".into(),
                arguments: serde_json::json!({}),
                signatures: vec!["callsig".into()],
            }],
            reasoning: Some(Reasoning {
                family: same.clone(),
                parts: vec![
                    ReasoningPart::Text("thinking".into()),
                    ReasoningPart::Signature("sig".into()),
                ],
            }),
        },
    ];
    let parts = |model: &str| {
        let request = Request {
            model,
            ..request(&messages)
        };
        let iden = ModelIden::new(AdapterKind::Anthropic, model);
        let chat = to_genai(&request, &family(&target, model), &iden);
        chat.messages[1].content.clone()
    };
    let kept = parts("model-a");
    assert_eq!(kept.thought_signatures(), vec!["sig"]);
    assert_eq!(
        kept.tool_calls()[0].thought_signatures,
        Some(vec!["callsig".to_string()])
    );
    let dropped = parts("model-b");
    assert!(dropped.thought_signatures().is_empty() && dropped.reasoning_contents().is_empty());
    assert_eq!(dropped.tool_calls()[0].thought_signatures, None);
    assert_eq!(dropped.first_text(), Some("Let me look."));
}

#[test]
fn statuses_become_our_own_kinds() {
    assert_eq!(from_status(Api::OpenAi, 401), ChatError::KeyRefused);
    assert_eq!(from_status(Api::Google, 400), ChatError::KeyRefused);
    assert_eq!(from_status(Api::Anthropic, 400), ChatError::Failed);
    assert_eq!(from_status(Api::Anthropic, 529), ChatError::Busy);
    assert_eq!(from_status(Api::OpenAi, 429), ChatError::RateLimited);
    assert_eq!(from_status(Api::OpenAi, 413), ChatError::TooLong);
}

#[test]
fn servers_on_this_computer_get_longer_waits() {
    let local = Target {
        api: Api::Ollama,
        base_url: "http://localhost:11434/".into(),
        key: None,
    };
    let remote = Target {
        api: Api::OpenAi,
        base_url: "https://api.openai.com/v1/".into(),
        key: None,
    };
    assert!(waits(&local).first > waits(&remote).first);
}

/// Model calls go through Rust only: the webview's CSP doesn't let it
/// reach a provider, or any address, itself.
#[test]
fn the_webview_cant_call_a_provider() {
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../../../tauri.conf.json")).unwrap();
    let connect = config["app"]["security"]["csp"]["connect-src"]
        .as_str()
        .unwrap();
    for source in connect.split_whitespace() {
        assert!(!matches!(source, "*" | "https:" | "http:"), "{source}");
    }
    for provider in super::super::providers::PROVIDERS {
        if let Some(base) = provider.base_url {
            let host = reqwest::Url::parse(base)
                .unwrap()
                .host_str()
                .unwrap()
                .to_string();
            assert!(!connect.contains(&host), "{host}");
        }
    }
    assert!(!connect.contains("localhost:") && !connect.contains("127.0.0.1"));
}

#[test]
fn odd_retry_waits_are_ignored() {
    let mut headers = reqwest::header::HeaderMap::new();
    for value in ["inf", "1e400", "-3", "soon"] {
        headers.insert("retry-after", value.parse().unwrap());
        assert_eq!(retry_after(&headers), None, "{value}");
    }
    headers.insert("retry-after", "2".parse().unwrap());
    assert_eq!(retry_after(&headers), Some(Duration::from_secs(2)));
}
