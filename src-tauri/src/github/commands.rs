//! GitHub sign-in commands.

use crate::github;

#[tauri::command(async)]
pub(crate) fn github_get_account() -> Result<Option<github::GitHubAccount>, String> {
    github::current_account()
}

#[tauri::command]
pub(crate) async fn github_start_sign_in() -> Result<github::SignInCode, String> {
    github::start_sign_in().await
}

#[tauri::command]
pub(crate) async fn github_finish_sign_in(
    remember: Option<bool>,
) -> Result<Option<github::GitHubAccount>, String> {
    github::finish_sign_in(remember.unwrap_or(true)).await
}

#[tauri::command(async)]
pub(crate) fn github_token_storage() -> Result<github::TokenStorageStatus, String> {
    github::token_storage_status()
}

#[tauri::command]
pub(crate) async fn github_get_installation() -> Result<github::app::InstallationStatus, String> {
    github::installation_status().await
}

#[tauri::command(async)]
pub(crate) fn github_cancel_sign_in() {
    github::cancel_sign_in()
}

#[tauri::command(async)]
pub(crate) fn github_sign_out() -> Result<(), String> {
    github::sign_out()
}
