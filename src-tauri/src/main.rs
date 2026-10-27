// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    use netherstone_lib::launch::{Command, parse};
    match parse(std::env::args_os().skip(1)) {
        // AI apps start the app as `Netherstone mcp` to use the vault.
        Command::Mcp => netherstone_lib::run_mcp_server(),
        Command::Open(_) => netherstone_lib::run(),
    }
}
