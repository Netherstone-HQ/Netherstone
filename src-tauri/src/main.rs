// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // AI apps start the app as `Netherstone mcp` to use the vault.
    if std::env::args().nth(1).as_deref() == Some("mcp") {
        return netherstone_lib::run_mcp_server();
    }
    netherstone_lib::run()
}
