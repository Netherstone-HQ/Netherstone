use super::*;
use crate::assistant::catalog;
use crate::assistant::chat::tests::{Answer, KEY, serve};
use crate::assistant::engine::Event;
use crate::assistant::models::Target;
use crate::assistant::providers::Api;
use std::sync::Mutex;

#[derive(Default)]
struct Collect(Mutex<Vec<Event>>);

impl Sink for Collect {
    fn send(&self, event: Event) -> bool {
        self.0.lock().unwrap().push(event);
        true
    }
}

impl Collect {
    fn text(&self) -> String {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter_map(|event| match event {
                Event::Text { text } => Some(text.as_str()),
                _ => None,
            })
            .collect()
    }
}

const SHORTER: &str = "data: {\"id\":\"c\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"role\":\"assistant\",\"content\":\"It works \"}}]}\n\n\
data: {\"id\":\"c\",\"object\":\"chat.completion.chunk\",\"choices\":[{\"index\":0,\"delta\":{\"content\":\"offline.\"},\"finish_reason\":\"stop\"}]}\n\n\
data: [DONE]\n\n";

const SHARD: &str = "# Why local-first\n\nBecause everything lives on your own computer, \
the app keeps working when you lose your connection.\n";

fn ask(name: &str, target: Target, whole: bool) -> Ask {
    let vault = crate::tools::tests::vault(name);
    std::fs::write(vault.root.join("Why.md"), SHARD).unwrap();
    let facts = catalog::facts(target.api, "a-chat-model");
    Ask {
        vault: Arc::new(vault),
        model: Model {
            target,
            id: "a-chat-model".to_string(),
            thinking: None,
            facts,
        },
        stop: StopToken::default(),
        send_files: false,
        shard: "Why.md".to_string(),
        selection: "the app keeps working when you lose your connection".to_string(),
        whole,
        prompt: "Make it shorter".to_string(),
    }
}

#[tokio::test]
async fn streams_the_replacement_with_the_shard_and_no_tools() {
    let server = serve(vec![Answer::ok("text/event-stream", SHORTER)]);
    let ask = ask("inline-part", server.target(Api::OpenAi, Some(KEY)), false);
    let sink = Collect::default();
    let (stop, _) = rewrite(&ask, &sink).await.unwrap();
    assert_eq!(stop, Stop::Done);
    assert_eq!(sink.text(), "It works offline.");

    let requests = server.requests();
    assert_eq!(requests.len(), 1);
    let body = &requests[0];
    assert!(body.contains("<selection>"), "{body}");
    assert!(body.contains("Make it shorter"), "{body}");
    assert!(body.contains("<shard path=\\\"Why.md\\\">"), "{body}");
    assert!(body.contains("part of a paragraph"), "{body}");
    assert!(!body.contains("\"tools\""), "{body}");
}

#[tokio::test]
async fn whole_blocks_may_come_back_as_blocks() {
    let server = serve(vec![Answer::ok("text/event-stream", SHORTER)]);
    let ask = ask("inline-whole", server.target(Api::OpenAi, Some(KEY)), true);
    rewrite(&ask, &Collect::default()).await.unwrap();
    assert!(!server.requests()[0].contains("part of a paragraph"));
}

#[tokio::test]
async fn a_refused_key_is_an_error() {
    let server = serve(vec![Answer::status(401, "{}")]);
    let ask = ask(
        "inline-refused",
        server.target(Api::OpenAi, Some(KEY)),
        false,
    );
    let sink = Collect::default();
    assert_eq!(
        rewrite(&ask, &sink).await.unwrap_err(),
        ChatError::KeyRefused
    );
    assert_eq!(sink.text(), "");
}

#[tokio::test]
async fn stops_when_asked() {
    let server = serve(vec![Answer::ok("text/event-stream", SHORTER)]);
    let ask = ask("inline-stop", server.target(Api::OpenAi, Some(KEY)), false);
    ask.stop.stop();
    assert_eq!(
        rewrite(&ask, &Collect::default()).await.unwrap_err(),
        ChatError::Stopped
    );
}
