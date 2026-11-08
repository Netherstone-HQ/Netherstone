mod ai_apps;
mod ai_vaults;
mod asset_scope;
mod assistant;
mod attachments;
mod browser;
mod copy_access;
mod credentials;
mod db;
mod export;
mod github;
mod gone_vaults;
mod import;
mod integrations;
pub mod launch;
mod links;
mod locks;
mod markdown_text;
mod mcp;
mod open_access;
mod open_source;
mod shard_links;
mod shards;
mod splash;
mod sync;
mod tools;
#[cfg(feature = "updater")]
mod updater;
mod vault;
mod vault_access;
mod watcher;
mod window_icon;

/// Runs the MCP server AI apps start (`Netherstone mcp`) instead of the
/// app: no window, just the vault tools over stdin and stdout.
pub fn run_mcp_server() {
    if let Err(error) = mcp::run() {
        eprintln!("[Netherstone] The MCP server stopped: {}", error);
        std::process::exit(1);
    }
}

/// Makes Netherstone the app for its links where the installer didn't: a
/// dev build, so links can be tried from it (until the app is installed
/// again), and an AppImage, which has no installer. The installers register
/// the link for everything else.
fn register_links(_app: &tauri::App) {
    #[cfg(any(windows, target_os = "linux"))]
    {
        use tauri::Manager;
        use tauri_plugin_deep_link::DeepLinkExt;
        // Only Linux has AppImages, and only there does Env have the field.
        #[cfg(target_os = "linux")]
        let appimage = _app.env().appimage.is_some();
        #[cfg(not(target_os = "linux"))]
        let appimage = false;
        let without_installer = cfg!(debug_assertions) || appimage;
        if without_installer && let Err(error) = _app.deep_link().register_all() {
            eprintln!(
                "[Netherstone] Couldn't register Netherstone links: {}",
                error
            );
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // Opening the app again, or a link, hands what it opened to the window
    // already open. Dev builds run on their own, beside an installed app.
    #[cfg(all(desktop, not(debug_assertions)))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, args, cwd| {
        if let launch::Command::Open { paths, links } =
            launch::parse(args.into_iter().skip(1).map(Into::into))
        {
            launch::receive(app, &paths, links, std::path::Path::new(&cwd));
        }
        if let Some(window) = tauri::Manager::get_webview_window(app, "main") {
            let _ = window.unminimize();
            let _ = window.set_focus();
        }
    }));
    let builder = builder
        .plugin(launch::plugin())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(browser::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .register_asynchronous_uri_scheme_protocol(export::pdf::SCHEME, export::pdf::serve);
    #[cfg(feature = "updater")]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(updater::PendingUpdate::default());
    builder
        .manage(browser::BrowserState::default())
        .manage(watcher::WatcherState::new())
        .setup(|app| {
            for window in tauri::Manager::windows(app).values() {
                window_icon::apply(window);
            }
            splash::show_main_window_eventually(app.handle());
            register_links(app);
            std::thread::spawn(open_source::remove_leftovers);
            let handle = app.handle().clone();
            std::thread::spawn(move || integrations::turn_on_defaults(&handle));
            Ok(())
        })
        .on_window_event(|window, event| match event {
            tauri::WindowEvent::ScaleFactorChanged { .. } => window_icon::apply(window),
            // A chat stops with the window it streams to.
            tauri::WindowEvent::Destroyed => assistant::stop_window(window.label()),
            _ => {}
        })
        .on_page_load(|webview, payload| {
            if payload.event() == tauri::webview::PageLoadEvent::Started {
                assistant::stop_window(webview.window().label());
            }
        })
        // Commands are marked `async` so Tauri runs them on its async runtime.
        // Plain sync commands run on the main thread, where file IO, SQLite and
        // vault indexing freeze the window, and where the dialog plugin's
        // blocking pickers must not be called.
        .invoke_handler(tauri::generate_handler![
            splash::show_main_window,
            assistant::commands::assistant_status,
            assistant::commands::assistant_enabled,
            assistant::commands::assistant_set_enabled,
            assistant::commands::assistant_set_send_files,
            assistant::commands::assistant_set_model,
            assistant::commands::assistant_models,
            assistant::commands::assistant_save_key,
            assistant::commands::assistant_find_local,
            assistant::commands::assistant_save_local,
            assistant::commands::assistant_save_custom,
            assistant::commands::assistant_remove,
            assistant::commands::assistant_send,
            assistant::commands::assistant_ask_inline,
            assistant::commands::assistant_picked,
            assistant::commands::assistant_local_down,
            assistant::commands::assistant_stop,
            assistant::commands::assistant_chats,
            assistant::commands::assistant_chat,
            assistant::commands::assistant_retitle,
            assistant::commands::assistant_delete_chat,
            assistant::commands::assistant_delete_chats,
            assistant::commands::assistant_change_preview,
            assistant::commands::assistant_apply,
            assistant::commands::assistant_undo,
            assistant::commands::assistant_discard,
            assistant::commands::assistant_memory,
            assistant::commands::assistant_memory_edit,
            assistant::commands::assistant_memory_delete,
            assistant::commands::assistant_memory_delete_all,
            assistant::commands::assistant_remember,
            assistant::commands::assistant_forget,
            assistant::commands::assistant_discard_offer,
            #[cfg(feature = "updater")]
            updater::updater_check,
            #[cfg(feature = "updater")]
            updater::updater_install,
            browser::browser_reset_state,
            browser::browser_get_state,
            browser::browser_navigate,
            browser::browser_reload,
            browser::browser_stop_loading,
            browser::browser_go_back,
            browser::browser_go_forward,
            browser::browser_set_bounds,
            browser::browser_set_visible,
            vault::commands::open_vault_dialog,
            vault::commands::open_vault,
            mcp::commands::mcp_get_enabled,
            mcp::commands::mcp_set_enabled,
            mcp::commands::mcp_vaults,
            mcp::commands::mcp_set_vault_allowed,
            mcp::commands::ai_apps,
            mcp::commands::ai_app_connect,
            mcp::commands::mcp_setup,
            vault::commands::default_vault_location,
            vault::commands::create_vault,
            attachments::commands::open_media_files_dialog,
            import::commands::open_import_dialog,
            launch::take_launch,
            open_source::open_link_list,
            open_source::open_link_create,
            open_source::open_link_cancel,
            open_source::open_link_done,
            integrations::integrations_get,
            integrations::integrations_set,
            import::commands::list_import_sources,
            import::commands::read_import_file,
            import::commands::read_import_file_range,
            vault::commands::vault_free_space,
            import::commands::undo_import,
            import::commands::reserve_import_paths,
            import::commands::save_imported_shard,
            attachments::commands::persist_attachment_file,
            attachments::commands::confirm_attachment_copies,
            attachments::commands::persist_attachment_bytes,
            import::commands::import_attachment,
            import::commands::fix_imported_links,
            attachments::commands::file_exists,
            attachments::commands::show_linked_file,
            attachments::commands::open_file,
            vault::commands::scan_vault,
            github::commands::github_get_account,
            github::commands::github_token_storage,
            github::commands::github_start_sign_in,
            github::commands::github_finish_sign_in,
            github::commands::github_cancel_sign_in,
            github::commands::github_get_installation,
            github::commands::github_sign_out,
            sync::commands::sync_get_vault_record,
            sync::commands::find_nested_vault,
            sync::commands::sync_plan_vault,
            sync::commands::sync_snapshot_vault,
            sync::commands::sync_snapshot_outside_change,
            sync::commands::history_list_versions,
            sync::commands::history_read_version,
            sync::commands::history_restore,
            sync::commands::history_old_attachments,
            sync::commands::history_free_up_space,
            sync::commands::forget_gone_vaults,
            sync::commands::gone_vault_histories,
            sync::commands::delete_gone_vault_history,
            sync::commands::sync_turn_on_backup,
            sync::commands::sync_now,
            sync::commands::sync_list_backups,
            sync::commands::sync_connect_backup,
            sync::commands::sync_check_backup,
            sync::commands::sync_get_conflict_versions,
            sync::commands::sync_resolve_conflict,
            sync::commands::sync_turn_off_backup,
            vault::commands::start_vault_watcher,
            vault::commands::stop_vault_watcher,
            shards::files::read_markdown_file,
            shards::files::open_markdown_file,
            shards::files::save_markdown_file,
            shards::files::append_markdown_to_file,
            shards::drawings::read_drawing_file,
            shards::drawings::save_drawing_file,
            shards::drawings::merge_drawings,
            shards::drawings::create_drawing_file,
            shards::paths::create_folder,
            attachments::commands::reconcile_attachments,
            attachments::commands::list_attachments,
            attachments::commands::gallery_thumbnail,
            attachments::commands::describe_missing_attachment,
            attachments::commands::attachment_sync_infos,
            attachments::commands::clean_up_attachments,
            shards::drawings::find_shards_containing,
            shards::drawings::stale_drawing_pictures,
            shards::cache::upsert_ast_cache,
            shards::cache::write_shard_cache,
            vault::commands::index_vault,
            shards::queries::search_files,
            shards::queries::get_tagged_files,
            shards::queries::get_writing_log,
            shards::queries::get_broken_links,
            shards::queries::get_charts,
            shards::queries::get_file_metadata,
            shards::queries::get_backlinks,
            shards::paths::rename_file,
            shards::paths::move_file,
            shards::paths::delete_vault_path,
            export::choose_export_path,
            export::write_export_file,
            export::read_export_asset,
            export::fetch_export_asset,
            export::export_pdf
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, _event| {
            // macOS hands over files and folders (Open With, a drop on the
            // Dock, `open`) and links as an event, not on the command line.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = _event {
                let paths: Vec<_> = urls
                    .iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .collect();
                let links = urls
                    .iter()
                    .filter_map(|url| open_source::Address::parse(url.as_str()))
                    .collect();
                launch::receive(_app, &paths, links, std::path::Path::new("/"));
            }
        });
}

#[cfg(test)]
mod tests {
    /// The command names in a `generate_handler!` list or a permission's
    /// `commands.allow` list.
    fn names(list: &str) -> std::collections::BTreeSet<String> {
        list.lines()
            .map(|line| line.trim().trim_end_matches(',').trim_matches('"'))
            .filter(|line| !line.is_empty() && !line.starts_with('#'))
            .map(|path| path.rsplit("::").next().unwrap_or(path).to_string())
            .collect()
    }

    fn between<'a>(text: &'a str, start: &str, end: &str) -> &'a str {
        let from = text.find(start).expect("start not found") + start.len();
        let to = from + text[from..].find(end).expect("end not found");
        &text[from..to]
    }

    #[test]
    fn permissions_match_handler() {
        let handler = names(between(
            include_str!("lib.rs"),
            concat!("generate_handler", "!["),
            "])",
        ));
        let allowed = names(between(
            include_str!("../permissions/app.toml"),
            "commands.allow = [",
            "]",
        ));
        assert!(handler.len() > 100, "the handler list wasn't read");
        let missing: Vec<_> = handler.difference(&allowed).collect();
        let extra: Vec<_> = allowed.difference(&handler).collect();
        assert!(
            missing.is_empty() && extra.is_empty(),
            "permissions/app.toml is missing {missing:?} and has {extra:?} that the handler doesn't"
        );
    }

    /// Asks for `show_main_window` from `webview` as a page at `url`.
    fn ask(
        webview: &tauri::Webview<tauri::test::MockRuntime>,
        url: &str,
    ) -> Result<tauri::ipc::InvokeResponseBody, serde_json::Value> {
        struct View<'a>(&'a tauri::Webview<tauri::test::MockRuntime>);
        impl AsRef<tauri::Webview<tauri::test::MockRuntime>> for View<'_> {
            fn as_ref(&self) -> &tauri::Webview<tauri::test::MockRuntime> {
                self.0
            }
        }
        tauri::test::get_ipc_response(
            &View(webview),
            tauri::webview::InvokeRequest {
                cmd: "show_main_window".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: url.parse().unwrap(),
                body: tauri::ipc::InvokeBody::default(),
                headers: Default::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
    }

    #[test]
    fn only_the_app_view_reaches_app_commands() {
        // The app's real capabilities, with a handler that answers any
        // command that gets past them.
        use tauri::Manager;
        let app = tauri::test::mock_builder()
            .invoke_handler(|invoke| {
                invoke.resolver.resolve(true);
                true
            })
            .build(tauri::generate_context!())
            .unwrap();
        let main = match app.get_webview_window("main") {
            Some(main) => main,
            None => tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
                .build()
                .unwrap(),
        };
        assert!(ask(main.as_ref(), "tauri://localhost").is_ok());

        // A page in the browser panel is another view in the same window.
        let panel = main
            .as_ref()
            .window()
            .add_child(
                tauri::webview::WebviewBuilder::new(
                    "browser",
                    tauri::WebviewUrl::External("https://example.com".parse().unwrap()),
                ),
                tauri::LogicalPosition::new(0, 0),
                tauri::LogicalSize::new(100, 100),
            )
            .unwrap();
        assert!(ask(&panel, "https://example.com").is_err());
        assert!(ask(&panel, "tauri://localhost").is_err());
        // The main view sent to a website gets nothing either.
        assert!(ask(main.as_ref(), "https://example.com").is_err());
    }
}
