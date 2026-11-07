//! Word forms for search. Each paragraph's words are stemmed in its own
//! language, so "running" finds "runs", and text in scripts written without
//! spaces is indexed by its pairs of characters, so any part of it is found.

use super::attachments::vault_key;
use crate::markdown_text::{BlockKind, TextBlock};
use frostem::{Algorithm, Stemmer};
use rusqlite::{Connection, params};
use std::collections::HashMap;
use std::ops::Range;
use std::path::Path;
use unicode_properties::{GeneralCategory, GeneralCategoryGroup, UnicodeGeneralCategory};
use whatlang::Lang;

/// How much of a shard is read to tell its main language.
const SAMPLE_BYTES: usize = 8_000;

/// The stemmer for a language whatlang tells, if there is one.
fn algorithm(lang: Lang) -> Option<Algorithm> {
    Some(match lang {
        Lang::Ara => Algorithm::Arabic,
        Lang::Hye => Algorithm::Armenian,
        Lang::Cat => Algorithm::Catalan,
        Lang::Ces => Algorithm::Czech,
        Lang::Dan => Algorithm::Danish,
        Lang::Nld => Algorithm::Dutch,
        Lang::Eng => Algorithm::English,
        Lang::Epo => Algorithm::Esperanto,
        Lang::Est => Algorithm::Estonian,
        Lang::Fin => Algorithm::Finnish,
        Lang::Fra => Algorithm::French,
        Lang::Deu => Algorithm::German,
        Lang::Ell => Algorithm::Greek,
        Lang::Hin => Algorithm::Hindi,
        Lang::Hun => Algorithm::Hungarian,
        Lang::Ind => Algorithm::Indonesian,
        Lang::Ita => Algorithm::Italian,
        Lang::Lit => Algorithm::Lithuanian,
        Lang::Nep => Algorithm::Nepali,
        Lang::Nob => Algorithm::Norwegian,
        Lang::Pes => Algorithm::Persian,
        Lang::Pol => Algorithm::Polish,
        Lang::Por => Algorithm::Portuguese,
        Lang::Ron => Algorithm::Romanian,
        Lang::Rus => Algorithm::Russian,
        Lang::Srp => Algorithm::Serbian,
        Lang::Spa => Algorithm::Spanish,
        Lang::Swe => Algorithm::Swedish,
        Lang::Tam => Algorithm::Tamil,
        Lang::Tur => Algorithm::Turkish,
        Lang::Ukr => Algorithm::Ukrainian,
        Lang::Yid => Algorithm::Yiddish,
        _ => return None,
    })
}

/// The language of `text` when whatlang is sure of it and it has a stemmer.
fn stemmed_language(text: &str) -> Option<Lang> {
    let info = whatlang::detect(text).filter(|info| info.is_reliable())?;
    algorithm(info.lang()).map(|_| info.lang())
}

/// The language with its stemmer, for one that has one.
fn with_stemmer(lang: Lang) -> Option<(Lang, Stemmer)> {
    algorithm(lang).map(|algorithm| (lang, Stemmer::new(algorithm)))
}

/// Whether `c` is in a script written without spaces between words (Chinese,
/// Japanese kana, Thai, Lao, Khmer, Myanmar), where the index can't find
/// words and text is matched by its pairs of characters instead.
pub fn is_unspaced(c: char) -> bool {
    matches!(c as u32,
        0x0E00..=0x0EFF
        | 0x1000..=0x109F
        | 0x1780..=0x17FF
        | 0x3040..=0x30FF
        | 0x31F0..=0x31FF
        | 0x3400..=0x4DBF
        | 0x4E00..=0x9FFF
        | 0xF900..=0xFAFF
        | 0xFF66..=0xFF9F
        | 0x20000..=0x323AF)
}

/// Whether the index keeps `c` in a word: letters, digits, marks and
/// private-use characters.
fn is_word_char(c: char) -> bool {
    c.is_alphanumeric()
        || matches!(c.general_category_group(), GeneralCategoryGroup::Mark)
        || c.general_category() == GeneralCategory::PrivateUse
}

/// The words of `text` as the index splits them, lowercase.
fn split_words(text: &str) -> impl Iterator<Item = String> + '_ {
    text.split(|c: char| !is_word_char(c))
        .filter(|word| !word.is_empty())
        .map(str::to_lowercase)
}

/// The runs of `text` in scripts without spaces, split where the index
/// splits words too.
fn unspaced_runs(text: &str) -> impl Iterator<Item = &str> {
    text.split(|c: char| !is_unspaced(c) || !is_word_char(c))
        .filter(|run| !run.is_empty())
}

/// What a shard adds to the index besides its text.
#[derive(Debug, Default, PartialEq)]
pub struct ShardWords {
    /// The stems of its words that differ from the word, then for each run
    /// of text without spaces, its pairs of characters side by side and its
    /// last character, so a phrase of pairs finds any part of the run.
    pub stems: String,
    /// The languages its words were stemmed in, as whatlang codes, so the
    /// vault's searches are stemmed in them too.
    pub languages: Vec<&'static str>,
}

/// The languages whatlang tells in a shard: its main one, from a sample of
/// its text, and each block's. This is most of the work of a shard's words,
/// and it needs nothing from the rest of the vault, so the indexer tells
/// many shards at once.
#[derive(Debug, Clone, PartialEq)]
pub struct ShardLanguages {
    main: Option<Lang>,
    blocks: Vec<Option<Lang>>,
}

/// The languages of a shard whose text is `blocks`.
pub fn shard_languages(blocks: &[TextBlock]) -> ShardLanguages {
    let mut sample = String::new();
    for block in blocks.iter().filter(|b| b.kind != BlockKind::CodeBlock) {
        if sample.len() >= SAMPLE_BYTES {
            break;
        }
        sample.push_str(&block.text);
        sample.push('\n');
    }
    ShardLanguages {
        main: stemmed_language(&sample),
        blocks: blocks.iter().map(|b| stemmed_language(&b.text)).collect(),
    }
}

impl ShardLanguages {
    /// Whether the shard needs the vault's language: when it has no main
    /// language, its name and the blocks whatlang can't tell take the vault's.
    pub fn needs_vault_language(&self) -> bool {
        self.main.is_none()
    }
}

/// The stems, character pairs and languages of a shard named `name` whose
/// text is `blocks`, told in `languages`. A paragraph whatlang can't tell is
/// taken to be in the shard's main language, or with none, in
/// `vault_language`. With neither, only its words as written are indexed.
pub fn shard_words(
    name: &str,
    blocks: &[TextBlock],
    languages: &ShardLanguages,
    vault_language: Option<Lang>,
) -> ShardWords {
    let main = languages.main.and_then(with_stemmer);
    let vault = vault_language.and_then(with_stemmer);

    let mut words = ShardWords::default();
    let mut add = |text: &str, language: Option<(Lang, Stemmer)>| {
        let mut push = |token: &str| {
            if !words.stems.is_empty() {
                words.stems.push(' ');
            }
            words.stems.push_str(token);
        };
        if let Some((lang, stemmer)) = language {
            for word in split_words(text).filter(|w| !w.chars().any(is_unspaced)) {
                let stem = stemmer.stem(&word);
                if stem != word {
                    push(&stem);
                    if !words.languages.contains(&lang.code()) {
                        words.languages.push(lang.code());
                    }
                }
            }
        }
        for run in unspaced_runs(text) {
            let chars: Vec<char> = run.chars().collect();
            for pair in chars.windows(2) {
                push(&pair.iter().collect::<String>());
            }
            push(&chars[chars.len() - 1].to_string());
        }
    };
    let title = name.strip_suffix(".md").unwrap_or(name);
    add(title, main.or(vault));
    for (block, lang) in blocks.iter().zip(&languages.blocks) {
        add(&block.text, lang.and_then(with_stemmer).or(main).or(vault));
    }
    words
}

/// The stemmers for the languages the vault at `vault_path` was indexed in.
fn vault_stemmers(conn: &Connection, vault_path: &Path) -> rusqlite::Result<Vec<Stemmer>> {
    // Steps through the distinct languages on the language index, then asks
    // for each whether any shard of the vault has it, which stops at the
    // first one, so a search doesn't read every shard's languages.
    let mut stmt = conn.prepare_cached(
        "WITH RECURSIVE languages(code) AS (
             SELECT MIN(language) FROM file_languages
             UNION ALL
             SELECT (SELECT MIN(language) FROM file_languages WHERE language > code)
             FROM languages WHERE code IS NOT NULL
         )
         SELECT code FROM languages WHERE code IS NOT NULL AND EXISTS (
             SELECT 1 FROM file_languages l JOIN files f ON f.id = l.file_id
             WHERE l.language = code AND f.vault_path = ?1
         )",
    )?;
    let codes = stmt
        .query_map(params![vault_key(vault_path)], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut stemmers: Vec<Stemmer> = codes
        .into_iter()
        .filter_map(|code| Lang::from_code(code).and_then(algorithm))
        .map(Stemmer::new)
        .collect();
    stemmers.sort_by_key(|s| s.algorithm() as usize);
    stemmers.dedup_by_key(|s| s.algorithm() as usize);
    Ok(stemmers)
}

/// One word of a search.
#[derive(Debug, Clone, PartialEq)]
pub struct Term {
    /// Lowercase, as typed.
    pub text: String,
    /// Its stems in the vault's languages that differ from it.
    pub stems: Vec<String>,
    /// In a script without spaces, so matched anywhere in the text.
    pub unspaced: bool,
}

/// A search of one vault's index.
pub struct Search {
    pub terms: Vec<Term>,
    /// Whether a shard needs only one of the words instead of all of them.
    pub any: bool,
    stemmers: Vec<Stemmer>,
}

/// An FTS5 string, quoted so nothing in it is read as query syntax.
fn quoted(text: &str) -> String {
    format!("\"{}\"", text.replace('"', "\"\""))
}

impl Search {
    /// The search for `query` in the vault at `vault_path`, stemmed in the
    /// languages its shards were indexed in.
    pub fn new(
        conn: &Connection,
        vault_path: &Path,
        query: &str,
        any: bool,
    ) -> rusqlite::Result<Self> {
        let words = search_words(query);
        let stemmers = if words.iter().any(|(_, unspaced)| !unspaced) {
            vault_stemmers(conn, vault_path)?
        } else {
            Vec::new()
        };
        Ok(Self::with_stemmers(words, any, stemmers))
    }

    fn with_stemmers(words: Vec<(String, bool)>, any: bool, stemmers: Vec<Stemmer>) -> Self {
        // Where words have no spaces between them, a question is one long
        // run, so any of its parts is searched for: every two characters
        // side by side, the length of most words in those scripts.
        let words = words.into_iter().flat_map(|(text, unspaced)| {
            let chars: Vec<char> = text.chars().collect();
            if any && unspaced && chars.len() > 2 {
                chars
                    .windows(2)
                    .map(|pair| (pair.iter().collect(), true))
                    .collect()
            } else {
                vec![(text, unspaced)]
            }
        });
        let mut seen = std::collections::HashSet::new();
        let terms = words
            .filter(|word| seen.insert(word.clone()))
            .map(|(text, unspaced)| {
                let mut stems: Vec<String> = Vec::new();
                if !unspaced {
                    for stemmer in &stemmers {
                        let stem = stemmer.stem(&text);
                        if stem != text && !stems.iter().any(|s| *s == stem) {
                            stems.push(stem.into_owned());
                        }
                    }
                }
                Term {
                    text,
                    stems,
                    unspaced,
                }
            })
            .collect();
        Self {
            terms,
            any,
            stemmers,
        }
    }

    #[cfg(test)]
    pub fn unstemmed(query: &str) -> Self {
        Self::with_stemmers(search_words(query), false, Vec::new())
    }

    pub fn is_empty(&self) -> bool {
        self.terms.is_empty()
    }

    fn joiner(&self) -> &'static str {
        if self.any { " OR " } else { " AND " }
    }

    /// The FTS5 query for the words: each as a word start, or any of its
    /// stems as a whole word. A word without spaces is its character pairs
    /// side by side, or one character starting a pair. None for no words.
    pub fn fts(&self) -> Option<String> {
        let groups: Vec<String> = self
            .terms
            .iter()
            .map(|term| {
                if term.unspaced {
                    let chars: Vec<char> = term.text.chars().collect();
                    return match chars.len() {
                        1 => format!("stems : {}*", quoted(&term.text)),
                        _ => {
                            let pairs: Vec<String> =
                                chars.windows(2).map(|pair| pair.iter().collect()).collect();
                            format!("stems : {}", quoted(&pairs.join(" ")))
                        }
                    };
                }
                let mut forms = vec![format!("{}*", quoted(&term.text))];
                forms.extend(term.stems.iter().map(|stem| quoted(stem)));
                format!("({})", forms.join(" OR "))
            })
            .collect();
        (!groups.is_empty()).then(|| groups.join(self.joiner()))
    }

    /// The FTS5 query for all the words as typed, in the name or text only.
    /// None for any of the words, where nearly every shard has one.
    pub fn exact(&self) -> Option<String> {
        if self.any {
            return None;
        }
        let groups: Vec<String> = self
            .terms
            .iter()
            .filter(|term| !term.unspaced)
            .map(|term| format!("{}*", quoted(&term.text)))
            .collect();
        (!groups.is_empty()).then(|| format!("{{name content}} : ({})", groups.join(" AND ")))
    }

    /// Where the words appear in `text`, each with the index of its term in
    /// `terms`: words starting with a term or sharing one of its stems, and
    /// unspaced terms anywhere. In order, without overlaps.
    pub fn matches(&self, text: &str) -> Vec<(Range<usize>, usize)> {
        let mut found = Vec::new();
        let mut stems: HashMap<String, Vec<String>> = HashMap::new();
        let mut word_start = None;
        for (index, c) in text.char_indices().chain([(text.len(), ' ')]) {
            let in_word = is_word_char(c) && !is_unspaced(c);
            match (in_word, word_start) {
                (true, None) => word_start = Some(index),
                (false, Some(start)) => {
                    let word = text[start..index].to_lowercase();
                    if let Some(term) = self.word_term(&word, &mut stems) {
                        found.push((start..index, term));
                    }
                    word_start = None;
                }
                _ => {}
            }
        }
        // These scripts have no case, so the text is searched as it is.
        for (index, term) in self.terms.iter().enumerate() {
            if term.unspaced {
                found.extend(
                    text.match_indices(term.text.as_str())
                        .map(|(at, part)| (at..at + part.len(), index)),
                );
            }
        }
        found.sort_by_key(|(range, _)| (range.start, range.end));
        let mut merged: Vec<(Range<usize>, usize)> = Vec::new();
        for (range, term) in found {
            match merged.last() {
                Some((last, _)) if range.start < last.end => {}
                _ => merged.push((range, term)),
            }
        }
        merged
    }

    /// The term `word` matches: one it starts with, or one whose stems
    /// include the word's own stem in a vault language.
    fn word_term(&self, word: &str, cache: &mut HashMap<String, Vec<String>>) -> Option<usize> {
        let spaced = || self.terms.iter().enumerate().filter(|(_, t)| !t.unspaced);
        if let Some((index, _)) = spaced().find(|(_, t)| word.starts_with(t.text.as_str())) {
            return Some(index);
        }
        if self.stemmers.is_empty() {
            return None;
        }
        let word_stems = cache.entry(word.to_string()).or_insert_with(|| {
            self.stemmers
                .iter()
                .map(|stemmer| stemmer.stem(word).into_owned())
                .collect()
        });
        spaced()
            .find(|(_, term)| {
                word_stems
                    .iter()
                    .any(|stem| *stem == term.text || term.stems.contains(stem))
            })
            .map(|(index, _)| index)
    }
}

/// The words of a search, lowercase, split as the index splits text: at
/// anything but letters and digits, so "contractor's" gives "contractor",
/// and where a script without spaces starts or ends. Each says whether it's
/// in such a script. Single letters, like the "s" left from "contractor's",
/// are dropped when there are longer words, since they would match nearly
/// everything.
pub fn search_words(query: &str) -> Vec<(String, bool)> {
    let mut words: Vec<(String, bool)> = Vec::new();
    for word in split_words(query) {
        let mut current = String::new();
        let mut unspaced = false;
        for c in word.chars() {
            if is_unspaced(c) != unspaced && !current.is_empty() {
                words.push((std::mem::take(&mut current), unspaced));
            }
            unspaced = is_unspaced(c);
            current.push(c);
        }
        if !current.is_empty() {
            words.push((current, unspaced));
        }
    }
    let is_letter = |(word, unspaced): &(String, bool)| !unspaced && word.chars().count() == 1;
    if words.iter().all(is_letter) {
        return words;
    }
    words.into_iter().filter(|word| !is_letter(word)).collect()
}

#[cfg(test)]
mod questions;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::markdown_text::text_blocks;

    fn shard_words(name: &str, blocks: &[TextBlock], vault_language: Option<Lang>) -> ShardWords {
        super::shard_words(name, blocks, &shard_languages(blocks), vault_language)
    }

    fn search(query: &str, algorithms: &[Algorithm]) -> Search {
        Search::with_stemmers(
            search_words(query),
            false,
            algorithms.iter().map(|a| Stemmer::new(*a)).collect(),
        )
    }

    #[test]
    fn paragraphs_are_stemmed_in_their_own_language() {
        let words = shard_words(
            "Notes.md",
            &text_blocks(
                "The gardeners were planting flowers along the running paths, and we \
                 talked about the season ahead of us while the children played.\n\n\
                 Los jardineros estaban plantando flores en los caminos, y hablamos de \
                 la temporada que viene mientras los niños jugaban en el parque.\n",
            ),
            None,
        );
        let stems: Vec<&str> = words.stems.split(' ').collect();
        assert!(stems.contains(&"garden"), "{stems:?}");
        assert!(stems.contains(&"plant"), "{stems:?}");
        assert!(stems.contains(&"jardiner"), "{stems:?}");
        assert!(!stems.contains(&"the"));
        let mut languages = words.languages.clone();
        languages.sort();
        assert_eq!(languages, ["eng", "spa"]);
    }

    #[test]
    fn short_paragraphs_take_the_main_language() {
        let words = shard_words(
            "Plan.md",
            &text_blocks(
                "# Meetings\n\nWe talked about the gardens and the planting season ahead of us.\n\n- Flowers\n",
            ),
            None,
        );
        let stems: Vec<&str> = words.stems.split(' ').collect();
        assert!(stems.contains(&"meet"), "{stems:?}");
        assert!(stems.contains(&"flower"), "{stems:?}");
    }

    #[test]
    fn text_without_a_known_language_is_left_as_written() {
        let words = shard_words("x.md", &text_blocks("qzx vbnm\n"), None);
        assert_eq!(words, ShardWords::default());
    }

    #[test]
    fn short_shards_take_the_vault_language() {
        let words = shard_words("x.md", &text_blocks("Pack the bags.\n"), Some(Lang::Eng));
        assert_eq!(words.stems, "bag");
        assert_eq!(words.languages, ["eng"]);
    }

    #[test]
    fn unspaced_text_is_kept_by_character_pairs() {
        let words = shard_words("東京.md", &text_blocks("今日は東京へ。Then home.\n"), None);
        assert_eq!(words.stems, "東京 京 今日 日は は東 東京 京へ へ");
    }

    #[test]
    fn marks_stay_in_words() {
        assert_eq!(search_words("हिंदी"), [("हिंदी".to_string(), false)]);
        let thai = Search::with_stemmers(search_words("ไม่ดี"), false, Vec::new());
        assert_eq!(thai.fts().unwrap(), "stems : \"ไม ม่ ่ด ดี\"");
        // Punctuation splits a run, as it splits words.
        let words = shard_words("a.md", &text_blocks("東・京\n"), None);
        assert_eq!(words.stems, "東 京");
    }

    #[test]
    fn search_words_split_at_scripts() {
        assert_eq!(
            search_words("iPhone用 the s"),
            [
                ("iphone".to_string(), false),
                ("用".to_string(), true),
                ("the".to_string(), false)
            ]
        );
        let words = |query| -> Vec<String> {
            search_words(query)
                .into_iter()
                .map(|(word, _)| word)
                .collect()
        };
        assert_eq!(words("Contractor's quote"), ["contractor", "quote"]);
        assert_eq!(words("auto-save"), ["auto", "save"]);
        assert_eq!(words("a b"), ["a", "b"]);
        assert!(words(" ' \" ").is_empty());
    }

    #[test]
    fn queries_match_stems_and_exact_words() {
        let search = search("running gardens", &[Algorithm::English]);
        assert_eq!(
            search.fts().unwrap(),
            "(\"running\"* OR \"run\") AND (\"gardens\"* OR \"garden\")"
        );
        assert_eq!(
            search.exact().unwrap(),
            "{name content} : (\"running\"* AND \"gardens\"*)"
        );
        let text = "She runs in the garden and gardens daily.";
        let found: Vec<&str> = search
            .matches(text)
            .into_iter()
            .map(|(range, _)| &text[range])
            .collect();
        assert_eq!(found, ["runs", "garden", "gardens"]);
    }

    #[test]
    fn any_part_of_unspaced_text_is_enough_for_any_words() {
        let search = Search::with_stemmers(search_words("京都への"), true, Vec::new());
        let terms: Vec<&str> = search.terms.iter().map(|t| t.text.as_str()).collect();
        assert_eq!(terms, ["京都", "都へ", "への"]);
    }

    #[test]
    fn unspaced_terms_match_anywhere() {
        assert_eq!(
            search("東京へ 日", &[]).fts().unwrap(),
            "stems : \"東京 京へ\" AND stems : \"日\"*"
        );
        let search = search("東京", &[]);
        let text = "今日は東京へ。";
        let found: Vec<&str> = search
            .matches(text)
            .into_iter()
            .map(|(range, _)| &text[range])
            .collect();
        assert_eq!(found, ["東京"]);
    }
}
