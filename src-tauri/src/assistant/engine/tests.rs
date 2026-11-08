use super::context::split_point;
use super::history::{answered, without_unanswered};
use super::run::MAX_STEPS;
use super::tools::{offer, propose};
use super::*;
use crate::assistant::catalog;
use crate::assistant::chat::tests::{Answer, KEY, serve};
use crate::assistant::chat::{Call, CallResult, Message};
use crate::assistant::memory;
use crate::assistant::prompts::change_states;
use crate::assistant::providers::Api;
use crate::assistant::sessions::Store;
use crate::assistant::sessions::{Change, ChangeState, Saved};
use crate::assistant::titles::{clean_title, short_title};
use crate::tools::proposals;
use serde_json::Value;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::atomic::Ordering;

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
    let vault_dir = vault.root.parent().unwrap().to_path_buf();
    std::fs::write(vault.root.join("Trip.md"), TRIP).unwrap();
    let store = Store::open_at(&vault.root.parent().unwrap().join("assistant.db")).unwrap();
    let chat = store.create(&vault.root, QUESTION).unwrap();
    store
        .add(&chat, &Message::user(QUESTION), &[], None)
        .unwrap();
    let facts = catalog::facts(target.api, model);
    Turn {
        store: Arc::new(Mutex::new(store)),
        chat,
        vault: Arc::new(vault),
        model: Model {
            target,
            id: model.to_string(),
            thinking: facts.reasoning.then_some(Thinking::Low),
            facts,
        },
        stop: StopToken::default(),
        allowed: Arc::new(|| true),
        send_files: false,
        added: Vec::new(),
        asked: Default::default(),
        step_limited: Default::default(),
        memory: Arc::new(List::at(vault_dir.join("memory.txt"))),
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
        let Some(Message::Tool { results, .. }) = saved
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

/// Trip.md with a picture and a PDF, for a model that takes both.
fn turn_with_files(name: &str, target: Target, model: &str, send_files: bool) -> Turn {
    let mut turn = turn(name, target, model);
    let root = &turn.vault.root;
    std::fs::create_dir_all(root.join("_attachments")).unwrap();
    image::RgbImage::new(4, 4)
        .save(root.join("_attachments/map.png"))
        .unwrap();
    std::fs::write(root.join("_attachments/plan.pdf"), b"%PDF-1.4 plan").unwrap();
    std::fs::write(
        root.join("Trip.md"),
        format!("{TRIP}\n![Map](_attachments/map.png)\n\n[Plan](_attachments/plan.pdf)\n"),
    )
    .unwrap();
    turn.model.facts.images = true;
    turn.model.facts.pdfs = true;
    turn.send_files = send_files;
    turn
}

#[tokio::test]
async fn images_and_pdfs_go_with_a_read_shard_for_every_provider_kind() {
    use base64::Engine;
    let png = base64::engine::general_purpose::STANDARD.encode(
        std::fs::read({
            let probe = turn_with_files(
                "engine-files-probe",
                serve(vec![]).target(Api::OpenAi, None),
                "m",
                true,
            );
            probe.vault.root.join("_attachments/map.png")
        })
        .unwrap(),
    );
    let pdf = base64::engine::general_purpose::STANDARD.encode(b"%PDF-1.4 plan");
    for (api, model, names) in recorded() {
        let server = serve(names.iter().map(|name| Answer::recorded(name)).collect());
        let key = (api != Api::Ollama).then_some(KEY);
        let turn = turn_with_files(
            &format!("engine-files-{model}"),
            server.target(api, key),
            model,
            true,
        );
        answer(&turn, &Collect::default())
            .await
            .unwrap_or_else(|e| panic!("{api:?}: {e:?}"));

        let last = server.requests().pop().unwrap();
        assert!(last.contains(&png), "{api:?}: the picture goes");
        let (image, document) = match api {
            Api::Anthropic => ("\"type\":\"image\"", Some("\"type\":\"document\"")),
            Api::Google => ("\"inline_data\"", Some("\"inline_data\"")),
            Api::OpenAi | Api::OpenRouter => ("\"image_url\"", Some("\"file_data\"")),
            Api::Ollama => ("\"images\"", None),
        };
        assert!(last.contains(image), "{api:?}: {last}");
        match document {
            Some(document) => {
                assert!(
                    last.contains(&pdf) && last.contains(document),
                    "{api:?}: {last}"
                )
            }
            // Ollama's route would send a PDF as an image.
            None => assert!(!last.contains(&pdf), "{api:?}"),
        }
        let Some(Message::Tool { files, results }) = messages(&turn)
            .into_iter()
            .find(|m| matches!(m, Message::Tool { results, .. } if results[0].name == "read"))
        else {
            panic!("{api:?}")
        };
        assert!(
            files.iter().all(|file| file.data.is_none()),
            "only paths are saved"
        );
        assert!(
            results[0].output.contains("come in the next message"),
            "{api:?}"
        );
    }
}

#[tokio::test]
async fn a_text_only_model_is_told_what_it_cant_see() {
    let server = serve(
        ["openrouter-1.sse", "openrouter-2.sse", "openrouter-3.sse"]
            .iter()
            .map(|name| Answer::recorded(name))
            .collect(),
    );
    let mut turn = turn_with_files(
        "engine-files-text-only",
        server.target(Api::OpenRouter, Some(KEY)),
        "nvidia/nemotron-3.5-lightning:free",
        true,
    );
    turn.model.facts.images = false;
    turn.model.facts.pdfs = false;
    answer(&turn, &Collect::default()).await.unwrap();
    let last = server.requests().pop().unwrap();
    assert!(!last.contains("image_url") && !last.contains("file_data"));
    assert!(last.contains("can't take: _attachments/map.png, _attachments/plan.pdf"));

    // With the switch off, nothing goes either, and the model knows why.
    let server = serve(
        ["openrouter-1.sse", "openrouter-2.sse", "openrouter-3.sse"]
            .iter()
            .map(|name| Answer::recorded(name))
            .collect(),
    );
    let turn = turn_with_files(
        "engine-files-off",
        server.target(Api::OpenRouter, Some(KEY)),
        "nvidia/nemotron-3.5-lightning:free",
        false,
    );
    answer(&turn, &Collect::default()).await.unwrap();
    let last = server.requests().pop().unwrap();
    assert!(!last.contains("image_url") && !last.contains("file_data"));
    assert!(last.contains("turned off in Settings"));
}

#[tokio::test]
async fn files_a_provider_turns_down_are_left_out_and_the_model_told() {
    let server = serve(vec![
        Answer::recorded("openrouter-1.sse"),
        Answer::recorded("openrouter-2.sse"),
        Answer::status(400, "{\"error\":{\"message\":\"PDF has too many pages\"}}"),
        Answer::recorded("openrouter-3.sse"),
    ]);
    let turn = turn_with_files(
        "engine-files-refused",
        server.target(Api::OpenRouter, Some(KEY)),
        "nvidia/nemotron-3.5-lightning:free",
        true,
    );
    let sink = Collect::default();
    answer(&turn, &sink).await.unwrap();
    assert!(sink.text().contains("Lisbon"));
    let requests = server.requests();
    assert_eq!(requests.len(), 4);
    assert!(requests[2].contains("file_data"));
    assert!(!requests[3].contains("file_data") && !requests[3].contains("image_url"));
    assert!(requests[3].contains("turned down the images and PDFs"));
}

#[tokio::test]
async fn write_tools_only_propose_and_other_tools_dont_run() {
    let edit = r#"{\"path\":\"Trip.md\",\"action\":\"replace\",\"find\":\"by train\",\"replace_with\":\"by bus\",\"summary\":\"Bus, not train\"}"#;
    let call = format!(
        "data: {{\"id\":\"c\",\"choices\":[{{\"index\":0,\"delta\":{{\"role\":\"assistant\",\"tool_calls\":[{{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{{\"name\":\"edit_shard\",\"arguments\":\"{edit}\"}}}},{{\"index\":1,\"id\":\"call_2\",\"type\":\"function\",\"function\":{{\"name\":\"fix_link\",\"arguments\":\"{{}}\"}}}}]}},\"finish_reason\":\"tool_calls\"}}]}}\n\ndata: [DONE]\n\n"
    );
    let done = "data: {\"id\":\"c\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Changed it.\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
    let server = serve(vec![
        Answer::ok("text/event-stream", call.as_str()),
        Answer::ok("text/event-stream", done),
    ]);
    let turn = turn(
        "engine-write-proposed",
        server.target(Api::OpenAi, Some(KEY)),
        "gpt-5.5",
    );
    turn.asked.store(1, Ordering::SeqCst);
    answer(&turn, &Collect::default()).await.unwrap();
    assert_eq!(
        std::fs::read_to_string(turn.vault.root.join("Trip.md")).unwrap(),
        TRIP
    );
    let Message::Tool { results, .. } = &messages(&turn)[2] else {
        panic!()
    };
    assert!(
        results[0].output.starts_with("Proposed, not made yet"),
        "{}",
        results[0].output
    );
    assert!(
        results[1]
            .output
            .starts_with("Error: There's no tool called fix_link")
    );

    let changes = turn.store.lock().unwrap().changes(&turn.chat).unwrap();
    assert_eq!(changes.len(), 1);
    assert_eq!((changes[0].path.as_str(), changes[0].turn), ("Trip.md", 1));
    assert_eq!(changes[0].state, ChangeState::Pending);
    // The model is offered the read tools and the write tools it proposes with.
    let offered = &server.requests()[0];
    assert!(offered.contains("\"read\"") && offered.contains("\"edit_shard\""));
    assert!(!offered.contains("\"fix_link\"") && !offered.contains("\"create_folder\""));
}

#[tokio::test]
async fn memory_goes_with_the_chat_and_the_model_only_offers_items() {
    let call = "data: {\"id\":\"c\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"remember\",\"arguments\":\"{\\\"text\\\":\\\"I write in British English\\\"}\"}},{\"index\":1,\"id\":\"call_2\",\"type\":\"function\",\"function\":{\"name\":\"remember\",\"arguments\":\"{\\\"text\\\":\\\"keep answers short\\\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\ndata: [DONE]\n\n";
    let done = "data: {\"id\":\"c\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"Will do.\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
    let server = serve(vec![
        Answer::ok("text/event-stream", call),
        Answer::ok("text/event-stream", done),
    ]);
    let turn = turn(
        "engine-memory",
        server.target(Api::OpenAi, Some(KEY)),
        "gpt-5.5",
    );
    turn.asked.store(1, Ordering::SeqCst);
    turn.memory.add("Keep answers short").unwrap();
    answer(&turn, &Collect::default()).await.unwrap();

    // Sent with the chat, and the tool offered.
    let sent = &server.requests()[0];
    assert!(sent.contains("- Keep answers short") && sent.contains("\"remember\""));
    // Offered, not added; what's in memory already isn't offered again.
    assert_eq!(turn.memory.items().unwrap(), vec!["Keep answers short"]);
    let Message::Tool { results, .. } = &messages(&turn)[2] else {
        panic!()
    };
    assert!(results[0].output.starts_with("Offered, not added yet"));
    assert!(results[1].output.starts_with("That's in memory already"));
    let offers = turn.store.lock().unwrap().offers(&turn.chat).unwrap();
    assert_eq!(offers.len(), 1);
    assert_eq!(
        (offers[0].text.as_str(), offers[0].turn, offers[0].state),
        ("I write in British English", 1, ChangeState::Pending)
    );
}

#[tokio::test]
async fn a_full_memory_takes_no_more_offers() {
    let server = serve(Vec::new());
    let turn = turn(
        "engine-memory-full",
        server.target(Api::OpenAi, Some(KEY)),
        "gpt-5.5",
    );
    for n in 0..memory::MAX_ITEMS {
        turn.memory.add(&format!("Item {n}")).unwrap();
    }
    let call = Call {
        id: "call_1".to_string(),
        name: "remember".to_string(),
        arguments: serde_json::json!({ "text": "One more" }),
        signatures: Vec::new(),
    };
    assert!(
        offer(&turn, &call)
            .await
            .unwrap_err()
            .starts_with("Memory is full")
    );
    assert!(
        turn.store
            .lock()
            .unwrap()
            .offers(&turn.chat)
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn a_stopped_answer_proposes_nothing() {
    let server = serve(Vec::new());
    let turn = turn(
        "engine-stopped-proposes-nothing",
        server.target(Api::OpenAi, Some(KEY)),
        "gpt-5.5",
    );
    turn.stop.stop();
    let call = Call {
        id: "call_1".to_string(),
        name: "edit_shard".to_string(),
        arguments: serde_json::json!({
            "path": "Trip.md", "action": "replace", "find": "by train", "replace_with": "by bus"
        }),
        signatures: Vec::new(),
    };
    assert!(propose(&turn, &call).await.is_err());
    assert!(
        turn.store
            .lock()
            .unwrap()
            .changes(&turn.chat)
            .unwrap()
            .is_empty()
    );
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
    let Message::Tool { results, .. } = messages(&turn).pop().unwrap() else {
        panic!()
    };
    assert!(results[0].output.starts_with("Not run"));
}

#[tokio::test]
async fn a_stopped_answer_keeps_what_streamed() {
    let text = "data: {\"id\":\"c\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"We go\"}}]}\n\n\
data: {\"id\":\"c\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\" far\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
    let mut slow = Answer::ok("text/event-stream", text);
    slow.hold = Some(text.find("\n\n").unwrap() + 2);
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
    // A step's first words are sent at once, and stop with them.
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
    slow.hold = Some(text.len() * 100);
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
                .add(&turn.chat, &Message::user("And then?"), &[], None)
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
                .add(&turn.chat, &Message::user(QUESTION), &[], None)
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

/// Older turns, enough of them to summarize, then the question again.
fn long_chat(turn: &Turn) {
    let store = turn.store.lock().unwrap();
    for i in 0..6 {
        let answer = Message::Assistant {
            text: format!("Trains {i} ").repeat(800),
            calls: vec![],
            reasoning: None,
        };
        store.add(&turn.chat, &answer, &[], None).unwrap();
        store
            .add(&turn.chat, &Message::user("And then?"), &[], None)
            .unwrap();
    }
    store
        .add(&turn.chat, &Message::user(QUESTION), &[], None)
        .unwrap();
}

#[tokio::test]
async fn a_context_too_small_for_the_instructions_and_tools_sends_nothing() {
    let server = serve(Vec::new());
    let mut turn = turn(
        "engine-small-context",
        server.target(Api::Ollama, None),
        "llama3.2:3b",
    );
    // Ollama's smallest default.
    turn.model.facts.context = Some(4_096);
    assert_eq!(
        answer(&turn, &Collect::default()).await.unwrap_err(),
        ChatError::ContextTooSmall
    );
    assert!(server.requests().is_empty());
}

#[tokio::test]
async fn no_summary_runs_when_the_instructions_and_tools_fill_the_budget() {
    let server = serve(vec![Answer::recorded("ollama-2.ndjson")]);
    let turn = turn(
        "engine-no-futile-summary",
        server.target(Api::Ollama, None),
        "llama3.2:3b",
    );
    // A model that isn't loaded yet, so its context isn't known.
    assert_eq!(turn.model.facts.context, None);
    long_chat(&turn);
    let sink = Collect::default();
    answer(&turn, &sink).await.unwrap();
    assert!(!sink.events().contains(&Event::Summarized));
    assert_eq!(server.requests().len(), 1);
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
        files: vec![],
    };
    let user = Message::user("q");
    let fixed = answered(vec![user.clone(), asked.clone(), half, user.clone(), asked]);
    assert_eq!(fixed.len(), 6);
    let Message::Tool { results, .. } = &fixed[2] else {
        panic!()
    };
    assert_eq!(
        results.iter().map(|r| r.id.as_str()).collect::<Vec<_>>(),
        vec!["a", "b"]
    );
    let Message::Tool { results, .. } = &fixed[5] else {
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
    let user = || Message::user("q");
    let answer = || Message::Assistant {
        text: "a".into(),
        calls: vec![],
        reasoning: None,
    };
    let tool = || Message::Tool {
        results: vec![],
        files: vec![],
    };
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
            .add(&chat, &Message::user("And when?"), &[], None)
            .unwrap();
        let again = Collect::default();
        answer(&turn, &again).await.unwrap();
        println!("{id} again: {:?}", again.text());
        assert!(again.text().contains("May"), "{id}");
    }
}

#[tokio::test]
async fn added_shards_go_with_the_message_and_count_as_read() {
    use base64::Engine;
    let server = serve(
        ["anthropic-1.sse", "anthropic-2.sse"]
            .iter()
            .map(|name| Answer::recorded(name))
            .collect(),
    );
    let mut turn = turn_with_files(
        "engine-added",
        server.target(Api::Anthropic, Some(KEY)),
        "claude-haiku-5-5",
        true,
    );
    turn.added = vec!["Trip.md".to_string(), "Gone.md".to_string()];
    let (shards, files) = attach(&turn, &turn.added).await;
    assert!(shards[0].text.contains("Lisbon"));
    assert!(shards[0].text.contains("come in this message"));
    assert!(shards[1].text.starts_with("Error:"), "{}", shards[1].text);
    assert_eq!(files.len(), 2);

    let message = Message::User {
        text: "Sum this up".to_string(),
        shards,
        files,
    };
    let chat = {
        let store = turn.store.lock().unwrap();
        let chat = store.create(&turn.vault.root, "Sum this up").unwrap();
        store.add(&chat, &message, &[], None).unwrap();
        chat
    };
    turn.chat = chat;
    let events = Collect::default();
    answer(&turn, &events).await.unwrap();

    assert_eq!(
        events.events()[0],
        Event::Sources {
            shards: vec!["Trip.md".to_string(), "Gone.md".to_string()]
        }
    );
    let png = base64::engine::general_purpose::STANDARD
        .encode(std::fs::read(turn.vault.root.join("_attachments/map.png")).unwrap());
    let first = &server.requests()[0];
    assert!(first.contains("<shard path=\\\"Trip.md\\\">"), "{first}");
    assert!(first.contains(&png) && first.contains("\"type\":\"document\""));
    let Some(Message::User { files, .. }) = messages(&turn).into_iter().next() else {
        panic!("the message is saved");
    };
    assert!(
        files.iter().all(|file| file.data.is_none()),
        "only paths are saved"
    );
}

#[tokio::test]
async fn a_short_title_comes_from_the_first_question_and_answer() {
    let named = "data: {\"id\":\"c\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"\\\"Open items before 0.7.\\\"\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
    let server = serve(vec![Answer::ok("text/event-stream", named)]);
    let turn = turn(
        "engine-short-title",
        server.target(Api::OpenAi, Some(KEY)),
        "gpt-5.5",
    );
    let title = short_title(
        &turn.model,
        &turn.chat,
        "What's still open before the 0.7 tag?",
        "Two things are open.",
        &StopToken::default(),
    )
    .await
    .unwrap();
    assert_eq!(title, "Open items before 0.7");
    let asked = &server.requests()[0];
    assert!(
        asked.contains("What's still open before the 0.7 tag?")
            && asked.contains("Two things are open.")
    );
    assert!(!asked.contains("\"tools\""));
}

#[test]
fn titles_lose_what_models_wrap_them_in() {
    assert_eq!(
        clean_title("\n Title: «Trip plans». \nmore").as_deref(),
        Some("Trip plans")
    );
    assert_eq!(
        clean_title("**Bread water**").as_deref(),
        Some("Bread water")
    );
    assert_eq!(clean_title("  \n \"\" "), None);
}

#[test]
fn earlier_changes_are_told_as_they_stand() {
    let change = |turn, kind, path: &str, state| Change {
        id: format!("{turn}-{path}"),
        chat: "c".into(),
        turn,
        kind,
        path: path.into(),
        ops: Vec::new(),
        count: 1,
        state,
        applied: Vec::new(),
        model: None,
        moving: None,
    };
    let changes = [
        change(
            1,
            proposals::Kind::NewShard,
            "Test notes.md",
            ChangeState::Applied,
        ),
        change(1, proposals::Kind::Shard, "Hub.md", ChangeState::Discarded),
        change(3, proposals::Kind::Shard, "Plan.md", ChangeState::Pending),
        // This message's own changes aren't earlier ones.
        change(5, proposals::Kind::Shard, "Now.md", ChangeState::Pending),
    ];
    let told = change_states(&changes, 5);
    assert!(
        told.contains("\n- new shard Test notes.md: applied"),
        "{told}"
    );
    assert!(told.contains("\n- change to Hub.md: discarded"), "{told}");
    assert!(
        told.contains("\n- change to Plan.md: not applied or discarded yet"),
        "{told}"
    );
    assert!(!told.contains("Now.md"), "{told}");
    assert_eq!(change_states(&changes[3..], 5), "");
}

#[test]
fn questions_that_got_no_answer_are_left_out() {
    let answer = Message::Assistant {
        text: "Lisbon".into(),
        calls: Vec::new(),
        reasoning: None,
    };
    let sent = without_unanswered(vec![
        Message::user("first"),
        answer.clone(),
        Message::user("failed"),
        Message::user("asked again"),
    ]);
    assert_eq!(
        sent,
        vec![Message::user("first"), answer, Message::user("asked again")]
    );
}
