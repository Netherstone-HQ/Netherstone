//! The AI apps Settings connects to the vault, by adding the MCP server
//! (`Netherstone mcp`) to each app's own list of MCP servers. Every app is
//! one row in [`APPS`]: where it is installed, where it keeps its servers and
//! in what shape, so adding an app is adding a row.

use serde::Serialize;
use serde_json::{Value as Json, json};
use serde_yaml_ng::{Mapping, Value as Yaml};
use std::path::{Path, PathBuf};

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
        Ok(text) => Some(text).filter(|text| !text.trim().is_empty()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
        Err(error) => return Err(format!("Couldn't read {}: {error}", config.display())),
    };
    let unreadable = || format!("Couldn't read {}, so it was left as it is", config.display());
    let text = match format {
        Format::Json { key, typed } => {
            let mut root = match existing.as_deref() {
                Some(text) => serde_json::from_str::<Json>(text).map_err(|_| unreadable())?,
                None => json!({}),
            };
            let servers = root
                .as_object_mut()
                .ok_or_else(unreadable)?
                .entry(key)
                .or_insert_with(|| json!({}));
            servers
                .as_object_mut()
                .ok_or_else(unreadable)?
                .insert(SERVER_NAME.to_string(), json_entry(command, typed));
            serde_json::to_string_pretty(&root).map_err(|e| e.to_string())? + "\n"
        }
        Format::GooseYaml => {
            let mut root = match existing.as_deref() {
                Some(text) => serde_yaml_ng::from_str::<Yaml>(text).map_err(|_| unreadable())?,
                None => Yaml::Mapping(Mapping::new()),
            };
            let extensions = root
                .as_mapping_mut()
                .ok_or_else(unreadable)?
                .entry("extensions".into())
                .or_insert_with(|| Yaml::Mapping(Mapping::new()));
            extensions
                .as_mapping_mut()
                .ok_or_else(unreadable)?
                .insert(SERVER_NAME.into(), goose_entry(command));
            serde_yaml_ng::to_string(&root).map_err(|e| e.to_string())?
        }
    };
    if let Some(folder) = config.parent() {
        std::fs::create_dir_all(folder)
            .map_err(|e| format!("Couldn't create {}: {e}", folder.display()))?;
    }
    // Settings files can hold keys for other servers.
    crate::vault::replace_atomically(&config, crate::vault::NewFile::OwnerOnly, |file| {
        std::io::Write::write_all(file, text.as_bytes())
    })
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
        Format::Json { key, .. } => serde_json::from_str::<Json>(&text).is_ok_and(|root| {
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

    fn temp_config(name: &str, text: Option<&str>) -> PathBuf {
        let folder = std::env::temp_dir().join(format!(
            "netherstone-ai-apps-{}-{name}",
            std::process::id()
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
    fn json_keeps_other_servers_and_counts_as_connected_after() {
        let format = Format::Json { key: "mcpServers", typed: false };
        let path = temp_config(
            "claude_desktop_config.json",
            Some(r#"{"theme":"dark","mcpServers":{"other":{"command":"x"}}}"#),
        );
        assert!(!is_connected(format, &path, "/apps/Netherstone"));
        add_server(format, &path, "/apps/Netherstone").unwrap();

        let root: Json = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(root["theme"], "dark");
        assert_eq!(root["mcpServers"]["other"]["command"], "x");
        assert!(is_connected(format, &path, "/apps/Netherstone"));
        // Moved since: connect again.
        assert!(!is_connected(format, &path, "/elsewhere/Netherstone"));
    }

    #[test]
    fn goose_yaml_keeps_other_extensions() {
        let path = temp_config(
            "config.yaml",
            Some("GOOSE_PROVIDER: anthropic\nextensions:\n  developer:\n    enabled: true\n    type: builtin\n    name: developer\n"),
        );
        add_server(Format::GooseYaml, &path, "/apps/Netherstone").unwrap();

        let root: Yaml = serde_yaml_ng::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(root["GOOSE_PROVIDER"].as_str(), Some("anthropic"));
        assert_eq!(root["extensions"]["developer"]["type"].as_str(), Some("builtin"));
        assert!(is_connected(Format::GooseYaml, &path, "/apps/Netherstone"));
    }

    #[test]
    fn the_setup_snippet_starts_this_program() {
        let setup: Json = serde_json::from_str(&setup_snippet().unwrap()).unwrap();
        assert_eq!(setup["mcpServers"][SERVER_NAME]["args"], json!(["mcp"]));
        assert_eq!(setup["mcpServers"][SERVER_NAME]["command"], server_command().unwrap());
    }
}
