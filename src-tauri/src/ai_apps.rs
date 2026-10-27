//! The AI apps Settings connects to the vault, by adding the MCP server
//! (`Netherstone mcp`) to each app's own list of MCP servers. Every app is
//! one row in [`APPS`]: where it is installed, where it keeps its servers and
//! in what shape, so adding an app is adding a row.

use jsonc_parser::ParseOptions;
use jsonc_parser::cst::{CstInputValue, CstRootNode};
use serde::Serialize;
use serde_json::{Value as Json, json};
use serde_yaml_ng::{Mapping, Value as Yaml};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use yaml_edit::YamlFile;

/// The name the server goes by in every app's list.
const SERVER_NAME: &str = "netherstone";
/// What starts the server, after the app's own program.
const SERVER_ARGS: [&str; 1] = ["mcp"];
/// What Goose shows under the server's name.
const GOOSE_DESCRIPTION: &str = "Your Netherstone vault";

/// Where a path starts.
#[derive(Clone, Copy)]
enum Base {
    Home,
    /// The system's folder for app settings: AppData\Roaming on Windows,
    /// Library/Application Support on macOS, ~/.config on Linux.
    Config,
}

#[derive(Clone, Copy)]
struct Place {
    base: Base,
    path: &'static [&'static str],
}

impl Place {
    fn resolve(self) -> Option<PathBuf> {
        let base = match self.base {
            Base::Home => dirs::home_dir(),
            Base::Config => dirs::config_dir(),
        }?;
        Some(self.path.iter().fold(base, |path, part| path.join(part)))
    }
}

/// How an app lists its MCP servers.
#[derive(Clone, Copy)]
enum Format {
    /// JSON with servers under `key`, each `{ command, args }`. `typed` apps
    /// also want `"type": "stdio"`.
    Json { key: &'static str, typed: bool },
    /// Goose's YAML, with servers under `extensions`.
    GooseYaml,
}

struct AiApp {
    id: &'static str,
    name: &'static str,
    /// Exists once the app is installed and has run.
    installed: Place,
    config: Place,
    format: Format,
    download_url: &'static str,
}

const APPS: &[AiApp] = &[
    AiApp {
        id: "claude-desktop",
        name: "Claude Desktop",
        installed: Place { base: Base::Config, path: &["Claude"] },
        config: Place { base: Base::Config, path: &["Claude", "claude_desktop_config.json"] },
        format: Format::Json { key: "mcpServers", typed: false },
        download_url: "https://claude.ai/download",
    },
    AiApp {
        id: "claude-code",
        name: "Claude Code",
        installed: Place { base: Base::Home, path: &[".claude"] },
        config: Place { base: Base::Home, path: &[".claude.json"] },
        format: Format::Json { key: "mcpServers", typed: true },
        download_url: "https://claude.com/product/claude-code",
    },
    AiApp {
        id: "cursor",
        name: "Cursor",
        installed: Place { base: Base::Home, path: &[".cursor"] },
        config: Place { base: Base::Home, path: &[".cursor", "mcp.json"] },
        format: Format::Json { key: "mcpServers", typed: false },
        download_url: "https://cursor.com/download",
    },
    AiApp {
        id: "vscode",
        name: "VS Code",
        installed: Place { base: Base::Config, path: &["Code", "User"] },
        config: Place { base: Base::Config, path: &["Code", "User", "mcp.json"] },
        format: Format::Json { key: "servers", typed: true },
        download_url: "https://code.visualstudio.com/download",
    },
    AiApp {
        id: "goose",
        name: "Goose",
        installed: if cfg!(windows) {
            Place { base: Base::Config, path: &["Block", "goose", "config"] }
        } else {
            Place { base: Base::Home, path: &[".config", "goose"] }
        },
        config: if cfg!(windows) {
            Place { base: Base::Config, path: &["Block", "goose", "config", "config.yaml"] }
        } else {
            Place { base: Base::Home, path: &[".config", "goose", "config.yaml"] }
        },
        format: Format::GooseYaml,
        download_url: "https://block.github.io/goose/docs/getting-started/installation",
    },
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStatus {
    id: &'static str,
    name: &'static str,
    installed: bool,
    connected: bool,
    download_url: &'static str,
}

/// The program AI apps start the server with: this one. An AppImage runs
/// from a mount that's gone once it quits, so it's the AppImage file itself.
fn server_command() -> Result<String, String> {
    let program = match std::env::var_os("APPIMAGE") {
        Some(appimage) => PathBuf::from(appimage),
        None => std::env::current_exe().map_err(|e| e.to_string())?,
    };
    Ok(program.to_string_lossy().into_owned())
}

/// Every app, whether it's on this computer and whether it starts the server.
pub fn statuses() -> Result<Vec<AppStatus>, String> {
    let command = server_command()?;
    Ok(APPS
        .iter()
        .map(|app| AppStatus {
            id: app.id,
            name: app.name,
            installed: app.installed.resolve().is_some_and(|path| path.exists()),
            connected: app
                .config
                .resolve()
                .is_some_and(|path| is_connected(app.format, &path, &command)),
            download_url: app.download_url,
        })
        .collect())
}

/// Adds the server to `id`'s list, or points it back at this program. The
/// rest of the app's settings are kept, and a file that can't be read is left
/// as it is.
pub fn connect(id: &str) -> Result<(), String> {
    let app = APPS
        .iter()
        .find(|app| app.id == id)
        .ok_or_else(|| format!("Unknown app: {id}"))?;
    let config = app
        .config
        .resolve()
        .ok_or_else(|| format!("Couldn't find where {} keeps its settings", app.name))?;
    add_server(app.format, &config, &server_command()?)
}

/// Adds the server, started with `command`, to the list in `config`.
fn add_server(format: Format, config: &Path, command: &str) -> Result<(), String> {
    // Write through a link to where the file really is, not over the link.
    let config = std::fs::canonicalize(config).unwrap_or_else(|_| config.to_path_buf());
    let existing = match std::fs::read_to_string(&config) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => String::new(),
        Err(error) => return Err(format!("Couldn't read {}: {error}", config.display())),
    };
    let text = with_server(format, &existing, command)
        .ok_or_else(|| format!("Couldn't read {}, so it was left as it is", config.display()))?;
    if let Some(folder) = config.parent() {
        std::fs::create_dir_all(folder)
            .map_err(|e| format!("Couldn't create {}: {e}", folder.display()))?;
    }
    // Settings files can hold keys for other servers.
    crate::vault::replace_atomically(&config, crate::vault::NewFile::OwnerOnly, |file| {
        std::io::Write::write_all(file, text.as_bytes())
    })
}

/// `text` with the server's entry added, or pointed back at `command`. Only
/// that entry is written: the rest keeps its order, comments and layout. The
/// edited text must read back as `text`'s settings with just that entry
/// changed, or there's no edit (`None`), as there's none for text that
/// isn't the app's settings.
fn with_server(format: Format, text: &str, command: &str) -> Option<String> {
    match format {
        Format::Json { key, typed } => json_with_server(text, key, json_entry(command, typed)),
        Format::GooseYaml => yaml_with_server(text, goose_entry(command)),
    }
}

fn json_with_server(text: &str, key: &str, entry: Json) -> Option<String> {
    let root = CstRootNode::parse(text, &ParseOptions::default()).ok()?;
    let servers = root.object_value_or_create()?.object_value_or_create(key)?;
    match servers.get(SERVER_NAME) {
        Some(server) => server.set_value(cst_value(&entry)),
        None => {
            servers.append(SERVER_NAME, cst_value(&entry));
        }
    }
    let edited = root.to_string();

    let mut expected = match text.trim() {
        "" => json!({}),
        _ => read_json(text)?,
    };
    expected
        .as_object_mut()?
        .entry(key)
        .or_insert_with(|| json!({}))
        .as_object_mut()?
        .insert(SERVER_NAME.to_string(), entry);
    (read_json(&edited)? == expected).then_some(edited)
}

fn yaml_with_server(text: &str, entry: Yaml) -> Option<String> {
    // The entry as the editor's own node, inside the list it goes in.
    let mut servers = Mapping::new();
    servers.insert(SERVER_NAME.into(), entry.clone());
    let mut addition = Mapping::new();
    addition.insert("extensions".into(), Yaml::Mapping(servers));
    let addition = yaml_edit::Document::from_str(&serde_yaml_ng::to_string(&addition).ok()?)
        .ok()?
        .get_mapping("extensions")?;

    let file = YamlFile::from_str(text).ok()?;
    let root = file.ensure_document().as_mapping()?;
    match root.get_mapping("extensions") {
        Some(extensions) => extensions.set(SERVER_NAME, addition.get_mapping(SERVER_NAME)?),
        None => root.set("extensions", addition),
    }
    let edited = file.to_string();

    // A file with only comments, or nothing, has no settings yet.
    let mut expected = match serde_yaml_ng::from_str::<Yaml>(text).ok()? {
        Yaml::Null => Yaml::Mapping(Mapping::new()),
        settings => settings,
    };
    expected
        .as_mapping_mut()?
        .entry("extensions".into())
        .or_insert_with(|| Yaml::Mapping(Mapping::new()))
        .as_mapping_mut()?
        .insert(SERVER_NAME.into(), entry);
    (serde_yaml_ng::from_str::<Yaml>(&edited).ok()? == expected).then_some(edited)
}

/// Settings in JSON, or the JSONC some apps (VS Code) keep them in.
fn read_json(text: &str) -> Option<Json> {
    jsonc_parser::parse_to_serde_value(text, &ParseOptions::default()).ok()
}

fn cst_value(value: &Json) -> CstInputValue {
    match value {
        Json::Null => CstInputValue::Null,
        Json::Bool(value) => CstInputValue::Bool(*value),
        Json::Number(number) => CstInputValue::Number(number.to_string()),
        Json::String(text) => CstInputValue::String(text.clone()),
        Json::Array(items) => CstInputValue::Array(items.iter().map(cst_value).collect()),
        Json::Object(fields) => CstInputValue::Object(
            fields.iter().map(|(name, value)| (name.clone(), cst_value(value))).collect(),
        ),
    }
}

/// What to paste into an app that isn't listed: the shape most apps take.
pub fn setup_snippet() -> Result<String, String> {
    let setup = json!({ "mcpServers": { SERVER_NAME: json_entry(&server_command()?, false) } });
    serde_json::to_string_pretty(&setup).map_err(|e| e.to_string())
}

fn json_entry(command: &str, typed: bool) -> Json {
    let mut entry = json!({ "command": command, "args": SERVER_ARGS });
    if typed {
        entry["type"] = json!("stdio");
    }
    entry
}

fn goose_entry(command: &str) -> Yaml {
    let mut entry = Mapping::new();
    entry.insert("enabled".into(), true.into());
    entry.insert("type".into(), "stdio".into());
    entry.insert("name".into(), SERVER_NAME.into());
    entry.insert("description".into(), GOOSE_DESCRIPTION.into());
    entry.insert("cmd".into(), command.into());
    entry.insert("args".into(), goose_args());
    entry.insert("envs".into(), Yaml::Mapping(Mapping::new()));
    entry.insert("env_keys".into(), Yaml::Sequence(Vec::new()));
    entry.insert("timeout".into(), 300.into());
    Yaml::Mapping(entry)
}

fn goose_args() -> Yaml {
    Yaml::Sequence(SERVER_ARGS.iter().map(|&arg| arg.into()).collect())
}

/// Whether the app's list starts the server with this program.
fn is_connected(format: Format, config: &Path, command: &str) -> bool {
    let Ok(text) = std::fs::read_to_string(config) else {
        return false;
    };
    match format {
        Format::Json { key, .. } => read_json(&text).is_some_and(|root| {
            let entry = &root[key][SERVER_NAME];
            entry["command"] == command && entry["args"] == json!(SERVER_ARGS)
        }),
        Format::GooseYaml => serde_yaml_ng::from_str::<Yaml>(&text).is_ok_and(|root| {
            let entry = &root["extensions"][SERVER_NAME];
            entry["enabled"] == Yaml::Bool(true)
                && entry["cmd"].as_str() == Some(command)
                && entry["args"] == goose_args()
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A config file in a folder of its own, as tests run side by side.
    fn temp_config(name: &str, text: Option<&str>) -> PathBuf {
        static FOLDERS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let folder = std::env::temp_dir().join(format!(
            "netherstone-ai-apps-{}-{}",
            std::process::id(),
            FOLDERS.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        let _ = std::fs::remove_dir_all(&folder);
        std::fs::create_dir_all(&folder).unwrap();
        let path = folder.join(name);
        if let Some(text) = text {
            std::fs::write(&path, text).unwrap();
        }
        path
    }

    #[test]
    fn every_app_has_its_own_id() {
        for (index, app) in APPS.iter().enumerate() {
            assert!(APPS[..index].iter().all(|other| other.id != app.id));
        }
    }

    #[test]
    fn json_keeps_the_order_comments_and_layout_around_the_entry() {
        let format = Format::Json { key: "servers", typed: true };
        let path = temp_config(
            "mcp.json",
            Some(
                "{\n    // Mine.\n    \"zeta\": 1,\n    \"servers\": {\n        \"other\": { \"command\": \"x\" }, // Keep.\n    },\n    \"alpha\": 2,\n}\n",
            ),
        );
        add_server(format, &path, "/apps/Netherstone").unwrap();

        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "{\n    // Mine.\n    \"zeta\": 1,\n    \"servers\": {\n        \"other\": { \"command\": \"x\" }, // Keep.\n        \"netherstone\": {\n            \"args\": [\"mcp\"],\n            \"command\": \"/apps/Netherstone\",\n            \"type\": \"stdio\",\n        },\n    },\n    \"alpha\": 2,\n}\n"
        );
        assert!(is_connected(format, &path, "/apps/Netherstone"));
    }

    #[test]
    fn json_points_the_entry_back_in_place() {
        let format = Format::Json { key: "mcpServers", typed: false };
        let path = temp_config(
            "mcp.json",
            Some(r#"{"mcpServers": {"a": 1, "netherstone": {"command": "/old", "args": ["mcp"]}, "b": 2}}"#),
        );
        assert!(!is_connected(format, &path, "/apps/Netherstone"));
        add_server(format, &path, "/apps/Netherstone").unwrap();

        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("{\"mcpServers\": {\"a\": 1, \"netherstone\": {"));
        assert!(text.ends_with("}, \"b\": 2}}"));
        assert!(is_connected(format, &path, "/apps/Netherstone"));
    }

    #[test]
    fn json_settings_that_arent_a_list_of_servers_are_left_as_they_are() {
        let format = Format::Json { key: "mcpServers", typed: false };
        for text in ["[1, 2]", r#"{"mcpServers": []}"#, r#"{"mcpServers": null}"#, "{ not json"] {
            let path = temp_config("mcp.json", Some(text));
            assert!(add_server(format, &path, "/apps/Netherstone").is_err());
            assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
        }
    }

    #[test]
    fn json_starts_a_missing_file() {
        let format = Format::Json { key: "mcpServers", typed: false };
        let path = temp_config("claude_desktop_config.json", None);
        add_server(format, &path, "/apps/Netherstone").unwrap();
        assert!(is_connected(format, &path, "/apps/Netherstone"));
    }

    #[test]
    fn goose_yaml_keeps_comments_and_order_around_the_entry() {
        let path = temp_config(
            "config.yaml",
            Some(
                "# Goose.\nGOOSE_PROVIDER: anthropic # Inline.\nextensions:\n  developer:\n    enabled: true\n    type: builtin\n# End.\nGOOSE_MODEL: x\n",
            ),
        );
        add_server(Format::GooseYaml, &path, "/apps/Netherstone").unwrap();

        let text = std::fs::read_to_string(&path).unwrap();
        assert!(text.starts_with("# Goose.\nGOOSE_PROVIDER: anthropic # Inline.\nextensions:\n  developer:\n    enabled: true\n    type: builtin\n  netherstone:\n"));
        assert!(text.ends_with("# End.\nGOOSE_MODEL: x\n"));
        assert!(is_connected(Format::GooseYaml, &path, "/apps/Netherstone"));
    }

    #[test]
    fn goose_yaml_starts_the_list_in_a_file_without_one() {
        for text in [None, Some("# Only a comment.\n"), Some("GOOSE_PROVIDER: anthropic\n")] {
            let path = temp_config("config.yaml", text);
            add_server(Format::GooseYaml, &path, "/apps/Netherstone").unwrap();
            let edited = std::fs::read_to_string(&path).unwrap();
            assert!(edited.starts_with(text.unwrap_or_default()));
            assert!(is_connected(Format::GooseYaml, &path, "/apps/Netherstone"));
        }
    }

    #[test]
    fn goose_yaml_that_isnt_a_list_of_extensions_is_left_as_it_is() {
        for text in ["- a\n- b\n", "extensions:\n- developer\n", "extensions: [\n"] {
            let path = temp_config("config.yaml", Some(text));
            assert!(add_server(Format::GooseYaml, &path, "/apps/Netherstone").is_err());
            assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
        }
    }

    #[test]
    fn the_setup_snippet_starts_this_program() {
        let setup: Json = serde_json::from_str(&setup_snippet().unwrap()).unwrap();
        assert_eq!(setup["mcpServers"][SERVER_NAME]["args"], json!(["mcp"]));
        assert_eq!(setup["mcpServers"][SERVER_NAME]["command"], server_command().unwrap());
    }
}
