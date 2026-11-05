//! Questions asked of a sample vault, each with the shard that answers it,
//! to see how often searching for the question as asked, with any of its
//! words, puts that shard near the top. The vault is in `questions/`.

use crate::db::queries::{FileFilter, find_files};
use rusqlite::Connection;
use std::path::Path;

/// How far down the results the shard may be and still count as found.
const TOP: usize = 5;

/// Each question with the vault-relative path of the shard that answers it.
const QUESTIONS: &[(&str, &str)] = &[
    // research
    (
        "Do students learn more when they handwrite their notes?",
        "research/Question.md",
    ),
    (
        "Why does it matter whether students type or write notes?",
        "research/Question.md",
    ),
    (
        "What would count as an answer to the question?",
        "research/Question.md",
    ),
    (
        "Is distraction from other apps in scope?",
        "research/Question.md",
    ),
    (
        "Which questions are still unanswered by the sources?",
        "research/Open questions.md",
    ),
    (
        "Do tablets with a stylus behave like paper?",
        "research/Open questions.md",
    ),
    (
        "Would maths or diagrams show a bigger gap?",
        "research/Open questions.md",
    ),
    (
        "Do typed notes copy the lecture word for word?",
        "research/Findings/Laptop notes are more verbatim.md",
    ),
    (
        "Why are laptop notes longer?",
        "research/Findings/Laptop notes are more verbatim.md",
    ),
    (
        "Does handwriting lead to better test scores?",
        "research/Findings/Test scores.md",
    ),
    (
        "Should laptops be banned in class?",
        "research/Findings/Test scores.md",
    ),
    (
        "Who wrote The pen is mightier than the keyboard?",
        "research/Sources/Mueller and Oppenheimer 2014.md",
    ),
    (
        "Which study told laptop users not to copy verbatim?",
        "research/Sources/Mueller and Oppenheimer 2014.md",
    ),
    (
        "Which study added digital pens as a third condition?",
        "research/Sources/Morehead et al 2019.md",
    ),
    (
        "What did the eWriter experiment find?",
        "research/Sources/Morehead et al 2019.md",
    ),
    (
        "Which replication used mini meta-analyses?",
        "research/Sources/Urry et al 2021.md",
    ),
    (
        "Don't ditch the laptop just yet",
        "research/Sources/Urry et al 2021.md",
    ),
    (
        "Where do I keep my own thoughts about a source?",
        "research/Start here.md",
    ),
    (
        "How is the research vault laid out?",
        "research/Start here.md",
    ),
    // studying
    ("What does the nucleus do?", "studying/Biology/Cells.md"),
    (
        "Which parts are only found in plant cells?",
        "studying/Biology/Cells.md",
    ),
    ("Where is the DNA in bacteria?", "studying/Biology/Cells.md"),
    ("What are plasmids?", "studying/Biology/Cells.md"),
    (
        "Why do muscle cells have so many mitochondria?",
        "studying/Biology/Cells.md",
    ),
    (
        "What is the word equation for photosynthesis?",
        "studying/Biology/Photosynthesis.md",
    ),
    (
        "What limits the rate of photosynthesis?",
        "studying/Biology/Photosynthesis.md",
    ),
    (
        "What do plants do with the glucose they make?",
        "studying/Biology/Photosynthesis.md",
    ),
    (
        "Why is photosynthesis endothermic?",
        "studying/Biology/Photosynthesis.md",
    ),
    (
        "What does anaerobic respiration produce in yeast?",
        "studying/Biology/Respiration.md",
    ),
    ("What is oxygen debt?", "studying/Biology/Respiration.md"),
    (
        "Why does lactic acid build up during exercise?",
        "studying/Biology/Respiration.md",
    ),
    (
        "How is fermentation used for bread and beer?",
        "studying/Biology/Respiration.md",
    ),
    (
        "Why did the Third Estate resent the taxes?",
        "studying/History/Causes of the revolution.md",
    ),
    (
        "How did the American War of Independence cause the revolution?",
        "studying/History/Causes of the revolution.md",
    ),
    (
        "What role did bread prices play?",
        "studying/History/Causes of the revolution.md",
    ),
    (
        "Which Enlightenment writers questioned the king?",
        "studying/History/Causes of the revolution.md",
    ),
    (
        "What was the Tennis Court Oath?",
        "studying/History/The French Revolution.md",
    ),
    (
        "When was the Bastille stormed?",
        "studying/History/The French Revolution.md",
    ),
    (
        "Why was the flight to Varennes a turning point?",
        "studying/History/The French Revolution.md",
    ),
    (
        "When did Napoleon seize power?",
        "studying/History/The French Revolution.md",
    ),
    (
        "Who ran the Committee of Public Safety?",
        "studying/History/The Terror.md",
    ),
    (
        "What did the Law of Suspects allow?",
        "studying/History/The Terror.md",
    ),
    (
        "How many people were executed in the Terror?",
        "studying/History/The Terror.md",
    ),
    (
        "Why did the Convention turn on Robespierre?",
        "studying/History/The Terror.md",
    ),
    (
        "Why is rereading a bad way to revise?",
        "studying/How to revise.md",
    ),
    (
        "How should I space out revision sessions?",
        "studying/How to revise.md",
    ),
    (
        "Is mixing topics in one session better?",
        "studying/How to revise.md",
    ),
    ("How is a topic shard laid out?", "studying/Start here.md"),
    ("How do I add a new subject?", "studying/Start here.md"),
    // worldbuilding
    (
        "What does the word lampright mean?",
        "worldbuilding/Languages.md",
    ),
    (
        "How are place names built on the coast?",
        "worldbuilding/Languages.md",
    ),
    (
        "Where is Old Inland still spoken?",
        "worldbuilding/Languages.md",
    ),
    (
        "Why did families leave the inland valleys?",
        "worldbuilding/History/The founding.md",
    ),
    (
        "Who led the settlers north?",
        "worldbuilding/History/The founding.md",
    ),
    (
        "How many died in the first winter?",
        "worldbuilding/History/The founding.md",
    ),
    (
        "What is Mara hiding about her father?",
        "worldbuilding/People/Mara Vell.md",
    ),
    ("How old is Mara Vell?", "worldbuilding/People/Mara Vell.md"),
    (
        "Who keeps the light at Wrecker's Point?",
        "worldbuilding/People/Old Tobin.md",
    ),
    (
        "What did Tobin see on the night of the wreck?",
        "worldbuilding/People/Old Tobin.md",
    ),
    (
        "Who is Wren Vell?",
        "worldbuilding/People/The Vell family.md",
    ),
    (
        "What did Ansel promise the other founding families?",
        "worldbuilding/People/The Vell family.md",
    ),
    (
        "Does the Vell family ever sell land?",
        "worldbuilding/People/The Vell family.md",
    ),
    (
        "How many people live in Harrowgate?",
        "worldbuilding/Places/Harrowgate.md",
    ),
    (
        "What is the Greywater tavern?",
        "worldbuilding/Places/Harrowgate.md",
    ),
    (
        "What story hooks does the harbour town have?",
        "worldbuilding/Places/Harrowgate.md",
    ),
    (
        "What is the weather like on the coast in winter?",
        "worldbuilding/Places/The Salt Coast.md",
    ),
    (
        "What did inland people call the shore before it was settled?",
        "worldbuilding/Places/The Salt Coast.md",
    ),
    (
        "Why is the headland called Wrecker's Point?",
        "worldbuilding/Places/Wrecker's Point.md",
    ),
    (
        "Were ships lured onto the reef by a false lamp?",
        "worldbuilding/Places/Wrecker's Point.md",
    ),
    // asked in other words than the shard uses
    (
        "Is writing with a pen better than a keyboard for remembering lectures?",
        "research/Findings/Test scores.md",
    ),
    (
        "Was the original laptop study ever repeated?",
        "research/Sources/Urry et al 2021.md",
    ),
    (
        "Do pen tablets count as handwriting?",
        "research/Open questions.md",
    ),
    (
        "How do plants turn sunlight into sugar?",
        "studying/Biology/Photosynthesis.md",
    ),
    (
        "Why do my legs burn after sprinting?",
        "studying/Biology/Respiration.md",
    ),
    (
        "What is the powerhouse of the cell?",
        "studying/Biology/Cells.md",
    ),
    (
        "What are the green parts of a leaf called?",
        "studying/Biology/Photosynthesis.md",
    ),
    (
        "When was the king beheaded?",
        "studying/History/The French Revolution.md",
    ),
    (
        "How long did the Reign of Terror last?",
        "studying/History/The Terror.md",
    ),
    (
        "What's the best way to study for exams?",
        "studying/How to revise.md",
    ),
    (
        "Which family owns the salt business?",
        "worldbuilding/People/The Vell family.md",
    ),
    (
        "Who killed Mara's dad?",
        "worldbuilding/People/Mara Vell.md",
    ),
    (
        "Why do coast people distrust inlanders?",
        "worldbuilding/History/The founding.md",
    ),
    (
        "Where does the rich family live in the harbour town?",
        "worldbuilding/Places/Harrowgate.md",
    ),
    ("What does a vell look like?", "worldbuilding/Languages.md"),
    (
        "How hot should the oven be for bread?",
        "languages/Boulangerie.md",
    ),
    ("¿Cuánta luz necesitan los tomates?", "languages/Huerto.md"),
    ("Wie pumpe ich den Reifen auf?", "languages/Fahrrad.md"),
    ("Как упаковать тяжёлые книги?", "languages/Переезд.md"),
    // other languages and scripts
    ("¿Cuándo riego las tomateras?", "languages/Huerto.md"),
    ("¿Cuándo trasplantar las plántulas?", "languages/Huerto.md"),
    ("Wie oft sollte man die Kette ölen?", "languages/Fahrrad.md"),
    ("Wo steht der Reifendruck?", "languages/Fahrrad.md"),
    ("Comment nourrir le levain ?", "languages/Boulangerie.md"),
    (
        "À quelle température cuire le pain ?",
        "languages/Boulangerie.md",
    ),
    (
        "Почему книги упаковали в маленькие коробки?",
        "languages/Переезд.md",
    ),
    ("Где лежат паспорта?", "languages/Переезд.md"),
    ("京都への切符", "languages/旅行.md"),
    ("傘", "languages/旅行.md"),
    ("绿茶用多少度的水", "languages/茶.md"),
    ("茶叶怎么保存", "languages/茶.md"),
];

/// The questions whose shard isn't in the top results, with why. Kept here
/// so a change that finds more, or fewer, shows up.
const MISSES: &[(&str, &str)] = &[
    (
        "Is writing with a pen better than a keyboard for remembering lectures?",
        "Every research shard shares its words; the one with the answer says \
         handwriting and typing, not pen and keyboard.",
    ),
    (
        "What's the best way to study for exams?",
        "The shard says revise and test yourself, never study or exams.",
    ),
    (
        "What does a vell look like?",
        "Common words (what, does, like) outweigh vell, which is in many shards.",
    ),
    (
        "How hot should the oven be for bread?",
        "Asked in English of a shard in French: words aren't translated.",
    ),
];

#[test]
fn questions_find_their_shards() {
    let vault = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/db/words/questions");
    let conn = Connection::open_in_memory().unwrap();
    crate::db::schema::init_schema(&conn).unwrap();
    crate::db::indexer::index_vault(&conn, &vault).unwrap();

    let mut misses = Vec::new();
    for (question, shard) in QUESTIONS {
        let filter = FileFilter {
            query: question,
            any: true,
            ..FileFilter::default()
        };
        let found: Vec<String> = find_files(&conn, &vault, &filter, 0, TOP)
            .unwrap()
            .into_iter()
            .map(|file| {
                Path::new(&file.path)
                    .strip_prefix(&vault)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect();
        if !found.iter().any(|path| path == shard) {
            println!("miss: {question} wants {shard}, found {found:?}");
            misses.push(*question);
        }
    }
    println!(
        "found {} of {} questions in the top {TOP}",
        QUESTIONS.len() - misses.len(),
        QUESTIONS.len()
    );
    let known: Vec<&str> = MISSES.iter().map(|(question, _)| *question).collect();
    assert_eq!(misses, known);
}
