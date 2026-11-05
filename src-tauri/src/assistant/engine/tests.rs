use super::*;
use crate::assistant::catalog;
use crate::assistant::chat::tests::{Answer, KEY, serve};
use crate::assistant::sessions::Store;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;

#[derive(Default)]
struct Collect(Mutex<Vec<Event>>);

impl Sink for Collect {
    fn send(&self, event: Event) -> bool {
        self.0.lock().unwrap().push(event);
        true
    }
}

impl Collect {
    fn events(&self) -> Vec<Event> {
        self.0.lock().unwrap().clone()
    }

    fn text(&self) -> String {
        self.events()
            .into_iter()
            .filter_map(|event| match event {
                Event::Text { text } => Some(text),
                _ => None,
            })
            .collect()
    }
}

const TRIP: &str = "# Trip\n\nWe go to Lisbon in May, by train.\n";
const QUESTION: &str =
    "Where does Trip.md say we go? Read that shard first, then answer in one short sentence.";

/// A chat about a vault holding Trip.md, with `question` saved as its
/// first message.
fn turn(name: &str, target: Target, model: &str) -> Turn {
    let vault = crate::tools::tests::vault(name);
    std::fs::write(vault.root.join("Trip.md"), TRIP).unwrap();
    let store = Store::open_at(&vault.root.parent().unwrap().join("assistant.db")).unwrap();
    let chat = store.create(&vault.root, QUESTION).unwrap();
    store
        .add(
            &chat,
            &Message::User {
                text: QUESTION.into(),
            },
            &[],
            None,
        )
        .unwrap();
    let facts = catalog::facts(target.api, model);
    Turn {
        store: Arc::new(Mutex::new(store)),
        chat,
        vault: Arc::new(vault),
        model: Model {
            target,
            id: model.to_string(),
            facts,
        },
        stop: StopToken::default(),
        allowed: Arc::new(|| true),
    }
}

fn messages(turn: &Turn) -> Vec<Message> {
    let store = turn.store.lock().unwrap();
    store
        .messages(&turn.chat)
        .unwrap()
        .into_iter()
        .map(|saved| saved.message)
        .collect()
}

/// The recorded tool call and answer for each provider kind, and the model
/// each was recorded with.
fn recorded() -> Vec<(Api, &'static str, Vec<&'static str>)> {
    let sse = ["openrouter-1.sse", "openrouter-2.sse", "openrouter-3.sse"];
    vec![
        (
            Api::Anthropic,
            "claude-haiku-5-5",
            vec!["anthropic-1.sse", "anthropic-2.sse"],
        ),
        (
            Api::Google,
            "gemini-3.5-flash-lite",
            vec!["google-1.sse", "google-2.sse", "google-3.sse"],
        ),
        (
            Api::OpenRouter,
            "nvidia/nemotron-3.5-lightning:free",
            sse.to_vec(),
        ),
        // OpenAI's chat format, as OpenRouter speaks it.
        (Api::OpenAi, "a-chat-model", sse.to_vec()),
        // Written from the examples in Ollama's API docs.
        (
            Api::Ollama,
            "llama3.2:3b",
            vec!["ollama-1.ndjson", "ollama-2.ndjson"],
        ),
    ]
}

#[tokio::test]
async fn a_tool_round_trip_for_every_provider_kind() {
    for (api, model, names) in recorded() {
        let server = serve(names.iter().map(|name| Answer::recorded(name)).collect());
        let key = (api != Api::Ollama).then_some(KEY);
        let turn = turn(
            &format!("engine-trip-{model}"),
            server.target(api, key),
            model,
        );
        let sink = Collect::default();
        let (stop, _) = answer(&turn, &sink)
            .await
            .unwrap_or_else(|e| panic!("{api:?}: {e:?}"));
        assert_eq!(stop, Stop::Done, "{api:?}");
        assert!(sink.text().contains("Lisbon"), "{api:?}: {}", sink.text());

        let events = sink.events();
        assert!(
            events
                .iter()
                .any(|e| matches!(e, Event::Tool { name, .. } if name == "read")),
            "{api:?}"
        );
        assert!(
            events.contains(&Event::Sources {
                shards: vec!["Trip.md".into()]
            }),
            "{api:?}"
        );

        // Saved: the question, each tool call and its result, and the
        // answer citing the shard.
        let saved = messages(&turn);
        assert_eq!(saved.len(), 2 * names.len(), "{api:?}");
        let Some(Message::Tool { results }) = saved
            .iter()
            .rev()
            .find(|m| matches!(m, Message::Tool { .. }))
        else {
            panic!("{api:?}")
        };
        assert!(results[0].output.contains("Lisbon"), "{api:?}");
        let last = turn
            .store
            .lock()
            .unwrap()
            .messages(&turn.chat)
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(last.sources, vec!["Trip.md"], "{api:?}");

        // The last request sent the shard back, and the key never went in
        // an address.
        let requests = server.requests();
        assert_eq!(requests.len(), names.len(), "{api:?}");
        assert!(requests.last().unwrap().contains("Lisbon"), "{api:?}");
        assert!(
            requests
                .iter()
                .all(|r| !r.lines().next().unwrap().contains(KEY))
        );
    }
}

#[tokio::test]
async fn only_read_tools_run_whatever_the_model_asks() {
    let call = "data: {\"id\":\"c\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"create_shard\",\"arguments\":\"{\\\"path\\\":\\\"New.md\\\",\\\"content\\\":\\\"x\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n";
    let done = "data: {\"id\":\"c\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"I can't.\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
    let server = serve(vec![
        Answer::ok("text/event-stream", call),
        Answer::ok("text/event-stream", done),
    ]);
    let turn = turn(
        "engine-write-refused",
        server.target(Api::OpenAi, Some(KEY)),
        "gpt-5.5",
    );
    answer(&turn, &Collect::default()).await.unwrap();
    assert!(!turn.vault.root.join("New.md").exists());
    let Message::Tool { results } = &messages(&turn)[2] else {
        panic!()
    };
    assert!(
        results[0]
            .output
            .starts_with("Error: There's no tool called create_shard")
    );
    // The model is only offered the read tools.
    let offered = &server.requests()[0];
    assert!(offered.contains("\"read\"") && !offered.contains("\"create_shard\""));
}

#[tokio::test]
async fn the_step_limit_ends_a_model_that_keeps_calling_tools() {
    let call = "data: {\"id\":\"c\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"list_tags\",\"arguments\":\"{}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n";
    let server = serve(vec![Answer::ok("text/event-stream", call)]);
    let turn = turn(
        "engine-step-limit",
        server.target(Api::OpenAi, Some(KEY)),
        "gpt-5.5",
    );
    let sink = Collect::default();
    answer(&turn, &sink).await.unwrap();
    assert_eq!(server.requests().len(), MAX_STEPS);
    assert!(sink.events().contains(&Event::StepLimit));
    // Every call has its result, so the chat can go on.
    let Message::Tool { results } = messages(&turn).pop().unwrap() else {
        panic!()
    };
    assert!(results[0].output.starts_with("Not run"));
}

#[tokio::test]
async fn a_stopped_answer_keeps_what_streamed() {
    let text = "data: {\"id\":\"c\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"We go\"}}]}\n\n\
data: {\"id\":\"c\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\" far\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
    let mut slow = Answer::ok("text/event-stream", text);
    slow.hold = Some((text.find("\n\n").unwrap() + 2, Duration::from_secs(30)));
    let server = serve(vec![slow]);
    let turn = turn(
        "engine-stop",
        server.target(Api::OpenAi, Some(KEY)),
        "gpt-5.5",
    );

    struct StopOnText(Collect, StopToken);
    impl Sink for StopOnText {
        fn send(&self, event: Event) -> bool {
            if matches!(event, Event::Text { .. }) {
                self.1.stop();
            }
            self.0.send(event)
        }
    }
    let sink = StopOnText(Collect::default(), turn.stop.clone());
    // The first batch waits for more text, so stop comes with the next one.
    let error = answer(&turn, &sink).await.unwrap_err();
    assert_eq!(error, ChatError::Stopped);
    let saved = messages(&turn);
    assert_eq!(saved.len(), 2);
    assert!(matches!(&saved[1], Message::Assistant { text, .. } if text == "We go"));
}

#[tokio::test]
async fn a_listener_that_leaves_stops_the_chat() {
    struct Gone;
    impl Sink for Gone {
        fn send(&self, _: Event) -> bool {
            false
        }
    }
    let text = "data: {\"id\":\"c\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"We go\"}}]}\n\n";
    let mut slow = Answer::ok("text/event-stream", text.repeat(200));
    slow.hold = Some((text.len() * 100, Duration::from_secs(30)));
    let server = serve(vec![slow]);
    let turn = turn(
        "engine-gone",
        server.target(Api::OpenAi, Some(KEY)),
        "gpt-5.5",
    );
    assert_eq!(answer(&turn, &Gone).await.unwrap_err(), ChatError::Stopped);
}

#[tokio::test]
async fn a_long_chat_is_summarized_and_carries_on() {
    let summary = "data: {\"id\":\"c\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"Earlier: talk of trains.\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
    let reply = "data: {\"id\":\"c\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"Lisbon.\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
    let server = serve(vec![
        Answer::ok("text/event-stream", summary),
        Answer::ok("text/event-stream", reply),
    ]);
    let mut turn = turn(
        "engine-summary",
        server.target(Api::OpenAi, Some(KEY)),
        "a-model-with-no-facts",
    );
    turn.model.facts.context = Some(8_000);
    {
        // Older turns well past the limit, then the question again.
        let store = turn.store.lock().unwrap();
        for i in 0..6 {
            store
                .add(
                    &turn.chat,
                    &Message::Assistant {
                        text: format!("Trains {i} ").repeat(800),
                        calls: vec![],
                        reasoning: None,
                    },
                    &[],
                    None,
                )
                .unwrap();
            store
                .add(
                    &turn.chat,
                    &Message::User {
                        text: "And then?".into(),
                    },
                    &[],
                    None,
                )
                .unwrap();
        }
        for _ in 0..2 {
            store
                .add(
                    &turn.chat,
                    &Message::Assistant {
                        text: "Short.".into(),
                        calls: vec![],
                        reasoning: None,
                    },
                    &[],
                    None,
                )
                .unwrap();
            store
                .add(
                    &turn.chat,
                    &Message::User {
                        text: QUESTION.into(),
                    },
                    &[],
                    None,
                )
                .unwrap();
        }
    }
    let sink = Collect::default();
    answer(&turn, &sink).await.unwrap();
    assert!(sink.events().contains(&Event::Summarized));
    assert_eq!(sink.text(), "Lisbon.");

    let store = turn.store.lock().unwrap();
    let kept = store.summary(&turn.chat).unwrap().unwrap();
    assert_eq!(kept.text, "Earlier: talk of trains.");
    // The full chat stays saved; the answer went out with the summary in
    // place of the older messages.
    assert_eq!(store.messages(&turn.chat).unwrap().len(), 18);
    let sent = &server.requests()[1];
    assert!(sent.contains("Earlier: talk of trains.") && !sent.contains("Trains 0"));
}

#[test]
fn a_call_saved_without_its_result_is_answered_as_not_run() {
    let call = |id: &str| Call {
        id: id.into(),
        name: "read".into(),
        arguments: Value::Null,
        signatures: vec![],
    };
    let asked = Message::Assistant {
        text: String::new(),
        calls: vec![call("a"), call("b")],
        reasoning: None,
    };
    let half = Message::Tool {
        results: vec![CallResult {
            id: "a".into(),
            name: "read".into(),
            output: "x".into(),
        }],
    };
    let user = Message::User { text: "q".into() };
    let fixed = answered(vec![user.clone(), asked.clone(), half, user.clone(), asked]);
    assert_eq!(fixed.len(), 6);
    let Message::Tool { results } = &fixed[2] else {
        panic!()
    };
    assert_eq!(
        results.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
        vec!["a", "b"]
    );
    let Message::Tool { results } = &fixed[5] else {
        panic!()
    };
    assert!(results.iter().all(|r| r.output == "Not run."));
}

#[tokio::test]
async fn a_vault_closed_mid_answer_stops_the_tools() {
    let call = "data: {\"id\":\"c\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"list_tags\",\"arguments\":\"{}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n";
    let server = serve(vec![Answer::ok("text/event-stream", call)]);
    let mut turn = turn(
        "engine-closed",
        server.target(Api::OpenAi, Some(KEY)),
        "gpt-5.5",
    );
    turn.allowed = Arc::new(|| false);
    assert_eq!(
        answer(&turn, &Collect::default()).await.unwrap_err(),
        ChatError::VaultClosed
    );
    assert_eq!(server.requests().len(), 1);
}

#[test]
fn older_messages_end_before_a_user_message() {
    let saved = |seq, message| Saved {
        seq,
        message,
        sources: vec![],
        model: None,
    };
    let user = || Message::User { text: "q".into() };
    let answer = || Message::Assistant {
        text: "a".into(),
        calls: vec![],
        reasoning: None,
    };
    let tool = || Message::Tool { results: vec![] };
    let history = vec![
        saved(1, user()),
        saved(2, answer()),
        saved(3, tool()),
        saved(4, answer()),
        saved(5, user()),
        saved(6, answer()),
        saved(7, tool()),
        saved(8, answer()),
        saved(9, user()),
    ];
    assert_eq!(split_point(&history), Some(4));
    assert_eq!(split_point(&history[..3]), None);
}

// ── Live ─────────────────────────────────────────────────────────────────────

/// Passes requests on to `upstream` and keeps each response body, as a
/// recorder in front of a real provider.
struct Recorder {
    url: String,
    bodies: Arc<Mutex<Vec<Vec<u8>>>>,
}

fn record(upstream: String) -> Recorder {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}/", listener.local_addr().unwrap());
    let bodies = Arc::new(Mutex::new(Vec::new()));
    let kept = bodies.clone();
    std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        for stream in listener.incoming() {
            let Ok(mut stream) = stream else { return };
            let mut reader = BufReader::new(stream.try_clone().unwrap());
            let mut first = String::new();
            reader.read_line(&mut first).unwrap();
            let mut headers = Vec::new();
            let mut length = 0;
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                    break;
                }
                let (name, value) = line.trim_end().split_once(':').unwrap();
                if name.eq_ignore_ascii_case("content-length") {
                    length = value.trim().parse().unwrap();
                }
                if !["host", "content-length", "connection", "accept-encoding"]
                    .contains(&name.to_ascii_lowercase().as_str())
                {
                    headers.push((name.to_string(), value.trim().to_string()));
                }
            }
            let mut body = vec![0; length];
            reader.read_exact(&mut body).unwrap();
            let path = first
                .split_whitespace()
                .nth(1)
                .unwrap()
                .trim_start_matches('/');
            let (status, content_type, answer) = runtime.block_on(async {
                let mut request = reqwest::Client::new()
                    .post(format!("{upstream}{path}"))
                    .body(body);
                for (name, value) in &headers {
                    request = request.header(name, value);
                }
                let response = request.send().await.unwrap();
                let status = response.status().as_u16();
                let content_type = response
                    .headers()
                    .get("content-type")
                    .map(|v| v.to_str().unwrap().to_string())
                    .unwrap_or_default();
                (
                    status,
                    content_type,
                    response.bytes().await.unwrap().to_vec(),
                )
            });
            kept.lock().unwrap().push(answer.clone());
            let _ = write!(
                stream,
                "HTTP/1.1 {status} X\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                answer.len()
            );
            let _ = stream.write_all(&answer);
        }
    });
    Recorder { url, bodies }
}

/// Runs the trip question against the real providers with the keys in
/// these environment variables, skipping any not set:
/// `cargo test live_chats -- --ignored --nocapture`. With RECORD set, the
/// responses are saved as the fixtures the other tests replay.
#[tokio::test]
#[ignore]
async fn live_chats() {
    for (api, model, _) in recorded() {
        let (id, variable) = match api {
            Api::Anthropic => ("anthropic", "ANTHROPIC_TEST_KEY"),
            Api::Google => ("google", "GEMINI_TEST_KEY"),
            Api::OpenRouter => ("openrouter", "OPENROUTER_TEST_KEY"),
            _ => continue,
        };
        let Ok(key) = std::env::var(variable) else {
            continue;
        };
        if std::env::var("LIVE_ONLY").is_ok_and(|only| only != id) {
            continue;
        }
        let provider = crate::assistant::providers::find(id).unwrap();
        let recorder = record(provider.base_url.unwrap().to_string());
        let target = Target {
            api,
            base_url: recorder.url.clone(),
            key: Some(key),
        };
        let turn = turn(&format!("engine-live-{id}"), target, model);
        let sink = Collect::default();
        let result = answer(&turn, &sink).await;
        println!("{id}: {result:?} {:?}", sink.text());
        result.unwrap();
        assert!(sink.text().contains("Lisbon"), "{id}");
        let bodies = recorder.bodies.lock().unwrap().clone();
        println!("{id}: {} responses", bodies.len());
        if std::env::var("RECORD").is_ok() {
            let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("src/assistant/chat/fixtures");
            std::fs::create_dir_all(&dir).unwrap();
            for (i, body) in bodies.iter().enumerate() {
                std::fs::write(dir.join(format!("{id}-{}.sse", i + 1)), body).unwrap();
            }
        }
        // A second question in the same chat sends the reasoning back.
        let chat = turn.chat.clone();
        turn.store
            .lock()
            .unwrap()
            .add(
                &chat,
                &Message::User {
                    text: "And when?".into(),
                },
                &[],
                None,
            )
            .unwrap();
        let again = Collect::default();
        answer(&turn, &again).await.unwrap();
        println!("{id} again: {:?}", again.text());
        assert!(again.text().contains("May"), "{id}");
    }
}
