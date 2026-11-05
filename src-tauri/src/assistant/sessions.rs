//! Saved chats, in their own SQLite file in the app's data: outside every
//! vault and out of sync. Each message is kept whole, with the shards it
//! cites; a long chat also keeps a summary of its older messages, which is
//! sent in their place while they stay saved.

use super::chat::Message;
use crate::tools::proposals::{FileChange, Kind, Op};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub struct Store {
    conn: Connection,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatInfo {
    pub id: String,
    pub title: String,
    pub vault: String,
    /// Milliseconds since 1970.
    pub created: i64,
    pub updated: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Saved {
    pub seq: i64,
    pub message: Message,
    /// Shards the message cites, vault-relative.
    pub sources: Vec<String>,
    /// The model that wrote it, for answers.
    pub model: Option<String>,
}

/// Older messages, summarized.
#[derive(Debug, Clone, PartialEq)]
pub struct Summary {
    pub text: String,
    /// The last message it covers.
    pub through: i64,
}

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    vault TEXT NOT NULL,
    created INTEGER NOT NULL,
    updated INTEGER NOT NULL,
    summary TEXT,
    summary_through INTEGER
);
CREATE TABLE IF NOT EXISTS messages (
    chat TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    body TEXT NOT NULL,
    sources TEXT NOT NULL DEFAULT '[]',
    model TEXT,
    created INTEGER NOT NULL,
    PRIMARY KEY (chat, seq)
);
CREATE INDEX IF NOT EXISTS chats_by_update ON chats (updated DESC);
CREATE TABLE IF NOT EXISTS changes (
    id TEXT PRIMARY KEY,
    chat TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
    turn INTEGER NOT NULL,
    kind TEXT NOT NULL,
    path TEXT NOT NULL,
    ops TEXT NOT NULL,
    state TEXT NOT NULL,
    applied TEXT,
    model TEXT,
    created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS changes_by_chat ON changes (chat, created);
";

/// Where a proposed change stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChangeState {
    /// Shown, not made.
    Pending,
    Applied,
    Discarded,
}

/// A change the assistant proposed to one file, with the calls that make it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    pub id: String,
    #[serde(skip)]
    pub chat: String,
    /// The user message it answers.
    pub turn: i64,
    pub kind: Kind,
    /// Vault-relative: the file it changes, or for a new one, where it
    /// goes; once applied, where it went.
    pub path: String,
    #[serde(skip)]
    pub ops: Vec<Op>,
    /// How many calls make it.
    pub count: usize,
    pub state: ChangeState,
    /// The files applying changed, as they were and became.
    #[serde(skip)]
    pub applied: Vec<FileChange>,
    /// The name of the model that proposed it.
    #[serde(skip)]
    pub model: Option<String>,
}

fn json_text<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(|e| e.to_string())
}

const CHANGE_COLUMNS: &str = "id, chat, turn, kind, path, ops, state, applied, model";

fn change_from_row(row: &rusqlite::Row) -> rusqlite::Result<Option<Change>> {
    let kind: String = row.get(3)?;
    let ops: String = row.get(5)?;
    let state: String = row.get(6)?;
    let applied: Option<String> = row.get(7)?;
    let (Ok(kind), Ok(ops), Ok(state)) = (
        serde_json::from_str(&kind),
        serde_json::from_str::<Vec<Op>>(&ops),
        serde_json::from_str(&state),
    ) else {
        // From a newer app: left out.
        return Ok(None);
    };
    Ok(Some(Change {
        id: row.get(0)?,
        chat: row.get(1)?,
        turn: row.get(2)?,
        kind,
        path: row.get(4)?,
        count: ops.len(),
        ops,
        state,
        applied: applied
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default(),
        model: row.get(8)?,
    }))
}

const TITLE_LENGTH: usize = 60;
/// About how long a first title gets, cut between words.
const FIRST_TITLE_LENGTH: usize = 40;

fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn sql(error: rusqlite::Error) -> String {
    format!("Saved chats failed: {error}")
}

/// The file chats are saved in, beside the app's database.
pub fn path() -> Result<PathBuf, String> {
    Ok(crate::db::get_db_path()?.with_file_name("assistant.db"))
}

/// A chat's title: the start of `text`, on one line.
pub fn title_of(text: &str) -> String {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    match line.char_indices().nth(TITLE_LENGTH) {
        Some((end, _)) => format!("{}…", line[..end].trim_end()),
        None => line,
    }
}

/// A new chat's title until it gets a short one, and if that fails: the
/// first sentence of its first message, cut between words.
fn first_title(text: &str) -> String {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = line.char_indices().peekable();
    let mut sentence = line.as_str();
    while let Some((at, c)) = chars.next() {
        let ends = chars.peek().is_none_or(|&(_, next)| next == ' ');
        if ends && matches!(c, '.' | '?' | '!' | '。' | '？' | '！') {
            let keep = if c == '.' { at } else { at + c.len_utf8() };
            sentence = &line[..keep];
            break;
        }
    }
    if sentence.chars().count() <= FIRST_TITLE_LENGTH {
        return sentence.to_string();
    }
    let end = sentence
        .char_indices()
        .nth(FIRST_TITLE_LENGTH)
        .map_or(sentence.len(), |(end, _)| end);
    // A word longer than the whole title is cut inside.
    let cut = sentence[..end]
        .rfind(' ')
        .filter(|&at| at > 0)
        .unwrap_or(end);
    format!("{}…", sentence[..cut].trim_end())
}

fn new_id() -> String {
    let seed = format!(
        "{}-{}-{:?}",
        chrono::Utc::now().timestamp_nanos_opt().unwrap_or_default(),
        std::process::id(),
        std::thread::current().id()
    );
    blake3::hash(seed.as_bytes()).to_hex()[..20].to_string()
}

impl Store {
    pub fn open() -> Result<Self, String> {
        Self::open_at(&path()?)
    }

    pub fn open_at(path: &Path) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(sql)?;
        // Deleted chats are overwritten on disk, not just unlinked.
        conn.execute_batch(
            "PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON; PRAGMA journal_mode = WAL;",
        )
        .map_err(sql)?;
        conn.busy_timeout(std::time::Duration::from_secs(10))
            .map_err(sql)?;
        conn.execute_batch(SCHEMA).map_err(sql)?;
        Ok(Self { conn })
    }

    /// Starts a chat about `vault` with its first message's text as title.
    pub fn create(&self, vault: &Path, first: &str) -> Result<String, String> {
        let id = new_id();
        let time = now();
        self.conn
            .execute(
                "INSERT INTO chats (id, title, vault, created, updated) VALUES (?1, ?2, ?3, ?4, ?4)",
                params![id, first_title(first), vault.to_string_lossy(), time],
            )
            .map_err(sql)?;
        Ok(id)
    }

    pub fn info(&self, chat: &str) -> Result<Option<ChatInfo>, String> {
        self.conn
            .query_row(
                "SELECT id, title, vault, created, updated FROM chats WHERE id = ?1",
                params![chat],
                info_from_row,
            )
            .optional()
            .map_err(sql)
    }

    /// Every chat, the most recent first.
    pub fn list(&self) -> Result<Vec<ChatInfo>, String> {
        let mut statement = self
            .conn
            .prepare("SELECT id, title, vault, created, updated FROM chats ORDER BY updated DESC")
            .map_err(sql)?;
        statement
            .query_map([], info_from_row)
            .map_err(sql)?
            .collect::<Result<_, _>>()
            .map_err(sql)
    }

    pub fn add(
        &self,
        chat: &str,
        message: &Message,
        sources: &[String],
        model: Option<&str>,
    ) -> Result<i64, String> {
        let body = serde_json::to_string(message).map_err(|e| e.to_string())?;
        let sources = serde_json::to_string(sources).map_err(|e| e.to_string())?;
        let time = now();
        let seq: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE chat = ?1",
                params![chat],
                |row| row.get(0),
            )
            .map_err(sql)?;
        self.conn
            .execute(
                "INSERT INTO messages (chat, seq, body, sources, model, created) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![chat, seq, body, sources, model, time],
            )
            .map_err(sql)?;
        self.conn
            .execute(
                "UPDATE chats SET updated = ?2 WHERE id = ?1",
                params![chat, time],
            )
            .map_err(sql)?;
        Ok(seq)
    }

    /// A chat's messages, in order.
    pub fn messages(&self, chat: &str) -> Result<Vec<Saved>, String> {
        let mut statement = self
            .conn
            .prepare("SELECT seq, body, sources, model FROM messages WHERE chat = ?1 ORDER BY seq")
            .map_err(sql)?;
        let rows = statement
            .query_map(params![chat], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                ))
            })
            .map_err(sql)?;
        let mut saved = Vec::new();
        for row in rows {
            let (seq, body, sources, model) = row.map_err(sql)?;
            // A message from a newer app that this one can't read is left out.
            let Ok(message) = serde_json::from_str(&body) else {
                continue;
            };
            saved.push(Saved {
                seq,
                message,
                sources: serde_json::from_str(&sources).unwrap_or_default(),
                model,
            });
        }
        Ok(saved)
    }

    pub fn summary(&self, chat: &str) -> Result<Option<Summary>, String> {
        let row: Option<(Option<String>, Option<i64>)> = self
            .conn
            .query_row(
                "SELECT summary, summary_through FROM chats WHERE id = ?1",
                params![chat],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(sql)?;
        Ok(match row {
            Some((Some(text), Some(through))) => Some(Summary { text, through }),
            _ => None,
        })
    }

    /// Gives the chat a new title, cut like the first one.
    pub fn set_title(&self, chat: &str, title: &str) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE chats SET title = ?2 WHERE id = ?1",
                params![chat, title_of(title)],
            )
            .map_err(sql)?;
        Ok(())
    }

    pub fn set_summary(&self, chat: &str, summary: &Summary) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE chats SET summary = ?2, summary_through = ?3 WHERE id = ?1",
                params![chat, summary.text, summary.through],
            )
            .map(|_| ())
            .map_err(sql)
    }

    pub fn delete(&self, chat: &str) -> Result<(), String> {
        self.conn
            .execute("DELETE FROM chats WHERE id = ?1", params![chat])
            .map(|_| ())
            .map_err(sql)
    }

    pub fn delete_all(&self) -> Result<(), String> {
        self.conn
            .execute_batch("DELETE FROM changes; DELETE FROM messages; DELETE FROM chats; VACUUM;")
            .map_err(sql)
    }

    // ── Proposed changes ─────────────────────────────────────────────────────

    /// Keeps a new proposed change, pending.
    pub fn add_change(
        &self,
        chat: &str,
        turn: i64,
        kind: Kind,
        path: &str,
        ops: &[Op],
        model: Option<&str>,
    ) -> Result<String, String> {
        let id = new_id();
        self.conn
            .execute(
                "INSERT INTO changes (id, chat, turn, kind, path, ops, state, model, created) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    id,
                    chat,
                    turn,
                    json_text(&kind)?,
                    path,
                    json_text(&ops)?,
                    json_text(&ChangeState::Pending)?,
                    model,
                    now()
                ],
            )
            .map_err(sql)?;
        Ok(id)
    }

    /// A chat's changes, in the order they were proposed.
    pub fn changes(&self, chat: &str) -> Result<Vec<Change>, String> {
        let mut statement = self
            .conn
            .prepare(&format!(
                "SELECT {CHANGE_COLUMNS} FROM changes WHERE chat = ?1 ORDER BY created, rowid"
            ))
            .map_err(sql)?;
        let rows = statement
            .query_map(params![chat], change_from_row)
            .map_err(sql)?;
        let mut found = Vec::new();
        for row in rows {
            found.extend(row.map_err(sql)?);
        }
        Ok(found)
    }

    pub fn change(&self, id: &str) -> Result<Option<Change>, String> {
        self.conn
            .query_row(
                &format!("SELECT {CHANGE_COLUMNS} FROM changes WHERE id = ?1"),
                params![id],
                change_from_row,
            )
            .optional()
            .map(Option::flatten)
            .map_err(sql)
    }

    pub fn set_ops(&self, id: &str, ops: &[Op]) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE changes SET ops = ?2 WHERE id = ?1",
                params![id, json_text(&ops)?],
            )
            .map(|_| ())
            .map_err(sql)
    }

    /// Notes where a change stands, with what applying it changed and where
    /// its file is.
    pub fn set_change_state(
        &self,
        id: &str,
        state: ChangeState,
        applied: &[FileChange],
        path: &str,
    ) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE changes SET state = ?2, applied = ?3, path = ?4 WHERE id = ?1",
                params![id, json_text(&state)?, json_text(&applied)?, path],
            )
            .map(|_| ())
            .map_err(sql)
    }

    /// Drops every change not made yet.
    pub fn discard_pending(&self) -> Result<(), String> {
        self.conn
            .execute(
                "UPDATE changes SET state = ?1 WHERE state = ?2",
                params![
                    json_text(&ChangeState::Discarded)?,
                    json_text(&ChangeState::Pending)?
                ],
            )
            .map(|_| ())
            .map_err(sql)
    }
}

fn info_from_row(row: &rusqlite::Row) -> rusqlite::Result<ChatInfo> {
    Ok(ChatInfo {
        id: row.get(0)?,
        title: row.get(1)?,
        vault: row.get(2)?,
        created: row.get(3)?,
        updated: row.get(4)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::assistant::chat::{Call, CallResult, Reasoning, ReasoningPart};
    use serde_json::json;

    fn store(name: &str) -> Store {
        let dir = crate::sync::state::tests::temp_dir(name);
        Store::open_at(&dir.join("assistant.db")).unwrap()
    }

    #[test]
    fn a_chat_keeps_its_messages_in_order_with_their_sources() {
        let store = store("sessions-order");
        let chat = store
            .create(Path::new("/vaults/Notes"), "What did I plan\nfor the trip?")
            .unwrap();
        let answer = Message::Assistant {
            text: String::new(),
            calls: vec![Call {
                id: "c1".into(),
                name: "read".into(),
                arguments: json!({ "path": "Trip.md" }),
                signatures: vec!["sig".into()],
            }],
            reasoning: Some(Reasoning {
                family: "anthropic|x|m".into(),
                parts: vec![
                    ReasoningPart::Text("think".into()),
                    ReasoningPart::Signature("s".into()),
                ],
            }),
        };
        store
            .add(&chat, &Message::user("What did I plan?"), &[], None)
            .unwrap();
        store.add(&chat, &answer, &[], Some("m")).unwrap();
        store
            .add(
                &chat,
                &Message::Tool {
                    results: vec![CallResult {
                        id: "c1".into(),
                        name: "read".into(),
                        output: "{}".into(),
                    }],
                    files: vec![],
                },
                &["Trip.md".to_string()],
                None,
            )
            .unwrap();

        let saved = store.messages(&chat).unwrap();
        assert_eq!(
            saved.iter().map(|s| s.seq).collect::<Vec<_>>(),
            vec![1, 2, 3]
        );
        assert_eq!(saved[1].message, answer);
        assert_eq!(saved[1].model.as_deref(), Some("m"));
        assert_eq!(saved[2].sources, vec!["Trip.md"]);
        let info = store.info(&chat).unwrap().unwrap();
        assert_eq!(info.title, "What did I plan for the trip?");
        assert_eq!(info.vault, "/vaults/Notes");
    }

    #[test]
    fn a_first_title_is_the_first_sentence_cut_between_words() {
        assert_eq!(
            first_title("What's still open before the 0.7 tag? And the notes."),
            "What's still open before the 0.7 tag?"
        );
        assert_eq!(
            first_title("Summarize this shard. Keep it short."),
            "Summarize this shard"
        );
        assert_eq!(
            first_title("Tell me everything I wrote about the trip to Lisbon in May"),
            "Tell me everything I wrote about the…"
        );
        assert_eq!(
            first_title(&"a".repeat(50)).chars().count(),
            FIRST_TITLE_LENGTH + 1
        );
    }

    #[test]
    fn long_titles_are_cut() {
        let title = title_of(&"word ".repeat(40));
        assert!(title.ends_with('…') && title.chars().count() <= TITLE_LENGTH + 1);
    }

    #[test]
    fn a_chat_can_be_renamed() {
        let store = store("sessions-rename");
        let chat = store.create(Path::new("/v"), "What's still open?").unwrap();
        store.set_title(&chat, "Open items\nbefore 0.7").unwrap();
        assert_eq!(
            store.info(&chat).unwrap().unwrap().title,
            "Open items before 0.7"
        );
    }

    #[test]
    fn deleting_one_chat_or_all_of_them() {
        let store = store("sessions-delete");
        let a = store.create(Path::new("/v"), "a").unwrap();
        let b = store.create(Path::new("/v"), "b").unwrap();
        store.add(&a, &Message::user("a"), &[], None).unwrap();
        store.delete(&a).unwrap();
        assert!(store.info(&a).unwrap().is_none());
        assert!(store.messages(&a).unwrap().is_empty());
        assert_eq!(store.list().unwrap().len(), 1);
        store.delete_all().unwrap();
        assert!(store.list().unwrap().is_empty() && store.info(&b).unwrap().is_none());
    }

    #[test]
    fn a_summary_stands_in_for_older_messages() {
        let store = store("sessions-summary");
        let chat = store.create(Path::new("/v"), "a").unwrap();
        assert!(store.summary(&chat).unwrap().is_none());
        let summary = Summary {
            text: "Earlier: a trip".into(),
            through: 4,
        };
        store.set_summary(&chat, &summary).unwrap();
        assert_eq!(store.summary(&chat).unwrap(), Some(summary));
    }
}
