//! The images, drawings and PDFs that go with a shard the assistant reads.
//! They're sent only with the switch on and only to a model that takes
//! them, within its provider's limits. Whatever doesn't go is named in the
//! tool's result, so the answer can say what the model couldn't see.

use super::catalog::Facts;
use super::chat::{File, Message};
use super::providers::{Api, Limits};
use crate::db::attachments::{extract_html_attr_value, normalize_attachment_path};
use crate::markdown_text::markdown_options;
use base64::Engine;
use pulldown_cmark::{Event, Parser, Tag};
use std::path::Path;
use std::sync::Arc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Image,
    Pdf,
}

/// The type of a file models take, by its extension.
fn kind_of(path: &str) -> Option<(Kind, &'static str)> {
    let extension = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    Some(match extension.as_str() {
        "png" => (Kind::Image, "image/png"),
        "jpg" | "jpeg" => (Kind::Image, "image/jpeg"),
        "gif" => (Kind::Image, "image/gif"),
        "webp" => (Kind::Image, "image/webp"),
        "pdf" => (Kind::Pdf, "application/pdf"),
        _ => return None,
    })
}

/// The vault files `markdown` shows or links to that a model could take:
/// its images, its drawings as their pictures (the light one), and PDFs.
/// In order, once each.
pub fn in_shard(markdown: &str) -> Vec<String> {
    let mut found: Vec<String> = Vec::new();
    let mut add = |value: &str| {
        if let Some(path) = normalize_attachment_path(value)
            && kind_of(&path).is_some()
            && !found.contains(&path)
        {
            found.push(path);
        }
    };
    for event in Parser::new_ext(markdown, markdown_options()) {
        match event {
            Event::Start(Tag::Image { dest_url, .. } | Tag::Link { dest_url, .. }) => {
                add(&dest_url)
            }
            Event::Html(html) | Event::InlineHtml(html) => {
                for tag in html.split('<') {
                    if tag
                        .get(..3)
                        .is_some_and(|name| name.eq_ignore_ascii_case("img"))
                        && let Some(src) = extract_html_attr_value(tag, "src")
                    {
                        add(&src);
                    }
                }
            }
            _ => {}
        }
    }
    found
}

/// The file at `path` (vault-relative) when it's really in the vault at
/// `root`: no `..`, and no link leading out of it. A shard from elsewhere
/// could name any file on the computer.
fn inside(root: &Path, path: &str) -> Option<std::path::PathBuf> {
    let relative = Path::new(path);
    if !relative
        .components()
        .all(|part| matches!(part, std::path::Component::Normal(_)))
    {
        return None;
    }
    let full = root.join(relative).canonicalize().ok()?;
    full.starts_with(root.canonicalize().ok()?).then_some(full)
}

/// What a chat's model may be sent.
#[derive(Debug, Clone, Copy)]
pub struct Sending {
    /// The send-images-and-PDFs switch.
    pub on: bool,
    pub images: bool,
    pub pdfs: bool,
    pub limits: Limits,
}

impl Sending {
    pub fn new(on: bool, api: Api, facts: &Facts) -> Self {
        Self {
            on,
            images: facts.images,
            // Ollama's route sends any file as an image.
            pdfs: facts.pdfs && api != Api::Ollama,
            limits: Limits::of(api),
        }
    }

    /// The largest file of `kind` it takes, in bytes before base64.
    fn largest(&self, kind: Kind) -> Option<u64> {
        let each = match kind {
            Kind::Image => self.limits.image_bytes,
            Kind::Pdf => self.limits.pdf_bytes,
        };
        let request = self.limits.request_bytes.map(|bytes| bytes / 4 * 3);
        match (each, request) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        }
    }
}

fn megabytes(bytes: u64) -> String {
    format!("{} MB", bytes.div_ceil(1_000_000))
}

/// Which of the files of the shard at `shard` (vault-relative) go to the
/// model, and a line for the tool's result naming what goes and what
/// doesn't.
pub fn choose(
    root: &Path,
    shard: &str,
    paths: Vec<String>,
    sending: &Sending,
) -> (Vec<File>, Option<String>) {
    let mut sent = Vec::new();
    let (mut off, mut unseen, mut big) = (Vec::new(), Vec::new(), Vec::new());
    for path in paths {
        let Some((kind, mime)) = kind_of(&path) else {
            continue;
        };
        // A missing file is a broken link the shard's text already shows.
        let Some(full) = inside(root, &path) else {
            continue;
        };
        let Ok(metadata) = std::fs::metadata(&full) else {
            continue;
        };
        let takes = match kind {
            Kind::Image => sending.images,
            Kind::Pdf => sending.pdfs,
        };
        if !sending.on {
            off.push(path);
        } else if !takes {
            unseen.push(path);
        } else if let Some(largest) = sending.largest(kind)
            && metadata.len() > largest
        {
            big.push((path, largest));
        } else {
            let tokens = estimate_tokens(&full, kind, metadata.len());
            sent.push(File {
                path,
                mime: mime.to_string(),
                tokens,
                data: None,
            });
        }
    }

    let mut lines = Vec::new();
    if !sent.is_empty() {
        let names: Vec<&str> = sent.iter().map(|file| file.path.as_str()).collect();
        lines.push(format!(
            "{shard} shows files that come in the next message: {}.",
            names.join(", ")
        ));
    }
    if !off.is_empty() {
        lines.push(format!(
            "{shard} shows files you weren't sent, because sending images and PDFs is \
             turned off in Settings: {}. If they matter, tell the user.",
            off.join(", ")
        ));
    }
    if !unseen.is_empty() {
        lines.push(format!(
            "{shard} shows files this model can't take: {}. Tell the user what you \
             couldn't see.",
            unseen.join(", ")
        ));
    }
    if !big.is_empty() {
        let names: Vec<String> = big
            .iter()
            .map(|(path, largest)| format!("{path} (over {})", megabytes(*largest)))
            .collect();
        lines.push(format!(
            "{shard} shows files too big to send: {}. Tell the user they were skipped.",
            names.join(", ")
        ));
    }
    (sent, (!lines.is_empty()).then(|| lines.join("\n")))
}

/// A rough count of the tokens a model reads for a file, for knowing when a
/// chat nears its limit: an image by its size once fitted to 1568 pixels
/// on its long side, about 750 pixels a token (Anthropic's guide), and a
/// PDF at 1,500 tokens a page, the low end of Anthropic's guide.
fn estimate_tokens(path: &Path, kind: Kind, bytes: u64) -> u64 {
    const LONG_SIDE: f64 = 1568.0;
    const PIXELS_PER_TOKEN: f64 = 750.0;
    const TOKENS_PER_PAGE: u64 = 1_500;
    match kind {
        Kind::Image => {
            let Ok((width, height)) = image::image_dimensions(path) else {
                return (LONG_SIDE * LONG_SIDE / PIXELS_PER_TOKEN) as u64;
            };
            let (width, height) = (width as f64, height as f64);
            let scale = (LONG_SIDE / width.max(height)).min(1.0);
            (width * scale * height * scale / PIXELS_PER_TOKEN).ceil() as u64
        }
        Kind::Pdf => {
            let pages = std::fs::read(path)
                .map_or(1, |data| count_pages(&data))
                .max(1);
            (pages as u64 * TOKENS_PER_PAGE).max(bytes.div_ceil(4).min(TOKENS_PER_PAGE))
        }
    }
}

/// The pages a PDF names as `/Type /Page`, which compressed ones may hide.
fn count_pages(data: &[u8]) -> usize {
    let mut pages = 0;
    for (at, _) in data.windows(5).enumerate().filter(|(_, w)| w == b"/Page") {
        let before = &data[at.saturating_sub(8)..at];
        let after = data.get(at + 5).copied();
        let typed = before.ends_with(b"/Type ") || before.ends_with(b"/Type");
        if typed && after != Some(b's') {
            pages += 1;
        }
    }
    pages
}

/// Reads the data of the files in `messages`, newest first, while they fit
/// the provider's limits beside `text_bytes` of text. Older files that
/// don't fit, and files gone from the vault, are left out of the request.
pub fn load(root: &Path, messages: &mut [Message], limits: &Limits, text_bytes: u64) {
    let mut request_left = limits
        .request_bytes
        .map(|bytes| bytes.saturating_sub(text_bytes));
    // OpenAI caps the PDFs of a request together.
    let mut pdfs_left = limits.pdf_bytes;
    for message in messages.iter_mut().rev() {
        for file in message.files_mut().iter_mut().rev() {
            file.data = None;
            let Some(Ok(bytes)) = inside(root, &file.path).map(std::fs::read) else {
                continue;
            };
            let encoded = (bytes.len() as u64).div_ceil(3) * 4;
            let pdf = file.mime == "application/pdf";
            if request_left.is_some_and(|left| encoded > left)
                || (pdf && pdfs_left.is_some_and(|left| bytes.len() as u64 > left))
            {
                continue;
            }
            request_left = request_left.map(|left| left - encoded);
            if pdf {
                pdfs_left = pdfs_left.map(|left| left - bytes.len() as u64);
            }
            let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
            file.data = Some(Arc::from(data));
        }
    }
}

/// Whether any file in `messages` has its data read.
pub fn any_sent(messages: &[Message]) -> bool {
    messages
        .iter()
        .any(|message| message.files().iter().any(|f| f.data.is_some()))
}

/// `messages` with no file data, for a request a provider refused with them.
pub fn without_data(messages: &mut [Message]) {
    for message in messages {
        for file in message.files_mut() {
            file.data = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_images_drawings_and_pdfs() {
        let markdown = "![Map](_attachments/map.png) and [plan](_attachments/Plan%20B.pdf)\n\n\
            <img src=\"_attachments/Flow.png\" data-dark-src=\"_attachments/Flow-dark.png\" \
            data-excalidraw=\"Flow.excalidraw\" />\n\n\
            [site](https://example.com/a.png) ![again](_attachments/map.png) \
            [notes](_attachments/notes.txt) ![svg](_attachments/x.svg)\n";
        assert_eq!(
            in_shard(markdown),
            [
                "_attachments/map.png",
                "_attachments/Plan B.pdf",
                "_attachments/Flow.png"
            ]
        );
    }

    fn vault(name: &str) -> std::path::PathBuf {
        let root = crate::sync::state::tests::temp_dir(name);
        std::fs::create_dir_all(root.join("_attachments")).unwrap();
        image::RgbImage::new(3136, 1568)
            .save(root.join("_attachments/map.png"))
            .unwrap();
        std::fs::write(
            root.join("_attachments/plan.pdf"),
            b"%PDF-1.4\n1 0 obj << /Type /Pages /Count 2 >>\n2 0 obj << /Type /Page >>\n3 0 obj << /Type/Page >>\n",
        )
        .unwrap();
        root
    }

    fn paths() -> Vec<String> {
        vec![
            "_attachments/map.png".to_string(),
            "_attachments/plan.pdf".to_string(),
            "_attachments/gone.png".to_string(),
        ]
    }

    #[test]
    fn files_go_only_where_they_may() {
        let root = vault("files-choose");
        let facts = Facts {
            images: true,
            pdfs: true,
            ..Facts::default()
        };

        let (sent, note) = choose(
            &root,
            "Trip.md",
            paths(),
            &Sending::new(true, Api::Anthropic, &facts),
        );
        assert_eq!(sent.len(), 2);
        // Fitted to 1568 x 784, at 750 pixels a token.
        assert_eq!(sent[0].tokens, 1568 * 784 / 750 + 1);
        assert_eq!(sent[1].tokens, 3_000);
        assert!(note.unwrap().contains("come in the next message"));

        let (sent, note) = choose(
            &root,
            "Trip.md",
            paths(),
            &Sending::new(false, Api::Anthropic, &facts),
        );
        assert!(sent.is_empty());
        assert!(note.unwrap().contains("turned off in Settings"));

        let text_only = Sending::new(true, Api::Anthropic, &Facts::default());
        let (sent, note) = choose(&root, "Trip.md", paths(), &text_only);
        assert!(sent.is_empty());
        assert!(
            note.unwrap()
                .contains("can't take: _attachments/map.png, _attachments/plan.pdf")
        );

        // Ollama gets images, never PDFs.
        let (sent, note) = choose(
            &root,
            "Trip.md",
            paths(),
            &Sending::new(true, Api::Ollama, &facts),
        );
        assert_eq!(sent.len(), 1);
        assert!(note.unwrap().contains("can't take: _attachments/plan.pdf"));

        let mut small = Sending::new(true, Api::Google, &facts);
        small.limits.request_bytes = Some(100);
        let (sent, note) = choose(&root, "Trip.md", paths(), &small);
        assert!(sent.is_empty());
        assert!(
            note.unwrap()
                .contains("too big to send: _attachments/map.png (over 1 MB)")
        );
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn files_outside_the_vault_never_go() {
        let root = vault("files-outside");
        let outside = root.parent().unwrap().join("files-outside-secret.png");
        image::RgbImage::new(1, 1).save(&outside).unwrap();
        let facts = Facts {
            images: true,
            ..Facts::default()
        };
        let sending = Sending::new(true, Api::Anthropic, &facts);
        let escape = "_attachments/../../files-outside-secret.png".to_string();
        // A link with .. isn't an attachment, and isn't sent if asked for.
        assert!(in_shard(&format!("![x]({escape})")).is_empty());
        let (sent, note) = choose(&root, "Trip.md", vec![escape], &sending);
        assert!(sent.is_empty() && note.is_none());
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&outside, root.join("_attachments/link.png")).unwrap();
            let (sent, _) = choose(
                &root,
                "Trip.md",
                vec!["_attachments/link.png".into()],
                &sending,
            );
            assert!(sent.is_empty());
        }
        std::fs::remove_file(&outside).unwrap();
        std::fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn newest_files_fill_the_request_first() {
        let root = vault("files-load");
        let file = |path: &str, mime: &str| File {
            path: path.to_string(),
            mime: mime.to_string(),
            tokens: 1,
            data: None,
        };
        let tool = |files| Message::Tool {
            results: Vec::new(),
            files,
        };
        let pdf_size = std::fs::metadata(root.join("_attachments/plan.pdf"))
            .unwrap()
            .len();
        let mut messages = vec![
            tool(vec![file("_attachments/map.png", "image/png")]),
            tool(vec![
                file("_attachments/plan.pdf", "application/pdf"),
                file("_attachments/gone.png", "image/png"),
            ]),
        ];
        let limits = Limits {
            request_bytes: Some(pdf_size.div_ceil(3) * 4 + 10),
            ..Limits::UNKNOWN
        };
        load(&root, &mut messages, &limits, 10);
        let data = |message: &Message| match message {
            Message::Tool { files, .. } => {
                files.iter().map(|f| f.data.is_some()).collect::<Vec<_>>()
            }
            _ => Vec::new(),
        };
        assert_eq!(data(&messages[0]), [false]);
        assert_eq!(data(&messages[1]), [true, false]);
        assert!(any_sent(&messages));
        without_data(&mut messages);
        assert!(!any_sent(&messages));
        std::fs::remove_dir_all(&root).unwrap();
    }
}
