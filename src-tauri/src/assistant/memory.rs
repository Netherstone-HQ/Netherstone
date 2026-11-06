//! What the assistant remembers about the user: a short plain-text list,
//! one item a line, in the app's data beside the saved chats, outside every
//! vault and out of sync. It's read at the start of every answer and sent
//! with it. The assistant only offers items; the user adds them.

use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};

/// The most items the list holds, so it stays a short list.
pub const MAX_ITEMS: usize = 30;
/// The longest an item gets, in characters.
pub const MAX_LENGTH: usize = 200;

/// The list as Settings shows it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub items: Vec<String>,
    pub max_items: usize,
    pub max_length: usize,
}

/// The file that holds the list.
pub struct List {
    path: PathBuf,
}

/// Held from a read to its write, so two changes don't cross.
fn lock() -> MutexGuard<'static, ()> {
    static LOCK: Mutex<()> = Mutex::new(());
    LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// An item as it's kept: one line, its spaces collapsed.
pub fn clean(text: &str) -> Result<String, String> {
    let item = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if item.is_empty() {
        return Err("A memory item can't be empty".to_string());
    }
    if item.chars().count() > MAX_LENGTH {
        return Err(format!("A memory item is at most {MAX_LENGTH} characters"));
    }
    Ok(item)
}

/// Whether `items` holds `item`, whatever its case.
pub fn holds(items: &[String], item: &str) -> bool {
    items.iter().any(|kept| same(kept, item))
}

pub fn same(a: &str, b: &str) -> bool {
    a.to_lowercase() == b.to_lowercase()
}

impl List {
    /// The list beside the saved chats.
    pub fn open() -> Result<Self, String> {
        Ok(Self::at(
            super::sessions::path()?.with_file_name("memory.txt"),
        ))
    }

    pub fn at(path: PathBuf) -> Self {
        Self { path }
    }

    fn read(&self) -> Result<Vec<String>, String> {
        match std::fs::read(&self.path) {
            // Saved by hand in another encoding, it's still read.
            Ok(bytes) => Ok(String::from_utf8_lossy(&bytes)
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(str::to_string)
                .collect()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Vec::new()),
            Err(error) => Err(format!("Couldn't read memory: {error}")),
        }
    }

    /// Writes the whole list at once, so a crash leaves the old one or the
    /// new one. An empty list leaves no file.
    fn write(&self, items: &[String]) -> Result<(), String> {
        let failed = |error: std::io::Error| format!("Couldn't save memory: {error}");
        if items.is_empty() {
            return match std::fs::remove_file(&self.path) {
                Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(failed(error)),
                _ => Ok(()),
            };
        }
        let mut text = items.join("\n");
        text.push('\n');
        let temp = self.path.with_extension("txt.tmp");
        std::fs::write(&temp, text).map_err(failed)?;
        std::fs::rename(&temp, &self.path).map_err(failed)
    }

    pub fn items(&self) -> Result<Vec<String>, String> {
        let _held = lock();
        self.read()
    }

    pub fn shown(&self) -> Result<Memory, String> {
        Ok(Memory {
            items: self.items()?,
            max_items: MAX_ITEMS,
            max_length: MAX_LENGTH,
        })
    }

    /// Adds `text` at the end. False when it's there already.
    pub fn add(&self, text: &str) -> Result<bool, String> {
        let item = clean(text)?;
        let _held = lock();
        let mut items = self.read()?;
        if holds(&items, &item) {
            return Ok(false);
        }
        if items.len() >= MAX_ITEMS {
            return Err(format!("Memory is full, it holds {MAX_ITEMS} items"));
        }
        items.push(item);
        self.write(&items)?;
        Ok(true)
    }

    /// Takes `item` out, when it's there.
    /// Takes `item` out, when it's there. False when it isn't.
    pub fn remove(&self, item: &str) -> Result<bool, String> {
        let _held = lock();
        let mut items = self.read()?;
        let Some(at) = items.iter().position(|kept| kept == item) else {
            return Ok(false);
        };
        items.remove(at);
        self.write(&items)?;
        Ok(true)
    }

    /// The list as it goes with a chat: within the limits, even when the
    /// file was edited by hand.
    pub fn for_chat(&self) -> Result<Vec<String>, String> {
        Ok(self
            .items()?
            .into_iter()
            .take(MAX_ITEMS)
            .map(|item| item.chars().take(MAX_LENGTH).collect())
            .collect())
    }

    /// Puts `text` in `item`'s place.
    pub fn edit(&self, item: &str, text: &str) -> Result<(), String> {
        let new = clean(text)?;
        let _held = lock();
        let mut items = self.read()?;
        let at = items
            .iter()
            .position(|kept| kept == item)
            .ok_or_else(|| "That item isn't in memory anymore".to_string())?;
        if items
            .iter()
            .enumerate()
            .any(|(other, kept)| other != at && same(kept, &new))
        {
            return Err("That's in memory already".to_string());
        }
        items[at] = new;
        self.write(&items)
    }

    pub fn clear(&self) -> Result<(), String> {
        let _held = lock();
        self.write(&[])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn list(name: &str) -> List {
        List::at(crate::sync::state::tests::temp_dir(name).join("memory.txt"))
    }

    #[test]
    fn items_are_kept_one_a_line_in_plain_text() {
        let list = list("memory-plain");
        assert!(list.items().unwrap().is_empty());
        assert!(list.add("I write in British English").unwrap());
        assert!(list.add("  Keep answers\nshort ").unwrap());
        assert_eq!(
            std::fs::read_to_string(&list.path).unwrap(),
            "I write in British English\nKeep answers short\n"
        );
        // Twice is once, whatever the case.
        assert!(!list.add("keep answers short").unwrap());
        assert_eq!(list.items().unwrap().len(), 2);
    }

    #[test]
    fn edit_remove_and_clear() {
        let list = list("memory-edit");
        list.add("I write in British English").unwrap();
        list.add("Keep answers short").unwrap();
        list.edit(
            "I write in British English",
            "I write in British English, no Oxford comma",
        )
        .unwrap();
        assert!(
            list.edit(
                "Keep answers short",
                "i write in british english, no oxford comma"
            )
            .is_err()
        );
        assert!(list.edit("Gone", "Anything").is_err());
        assert!(list.edit("Keep answers short", "   ").is_err());
        list.remove("Keep answers short").unwrap();
        assert_eq!(
            list.items().unwrap(),
            vec!["I write in British English, no Oxford comma"]
        );
        list.clear().unwrap();
        assert!(list.items().unwrap().is_empty() && !list.path.exists());
    }

    #[test]
    fn the_list_stays_short() {
        let list = list("memory-limits");
        assert!(list.add(&"a".repeat(MAX_LENGTH + 1)).is_err());
        assert!(list.add(&"a".repeat(MAX_LENGTH)).is_ok());
        for n in 1..MAX_ITEMS {
            list.add(&format!("Item {n}")).unwrap();
        }
        assert_eq!(list.items().unwrap().len(), MAX_ITEMS);
        assert!(list.add("One more").is_err());
    }
}
