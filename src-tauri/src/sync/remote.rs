//! Uploading a vault's local backup history to its GitHub repository.

use super::state::DEFAULT_BRANCH;
use std::cell::RefCell;

use git2::{
    Cred, ErrorClass, ErrorCode, FetchOptions, Oid, PushOptions, RemoteCallbacks, Repository,
};

const REMOTE_NAME: &str = "origin";

/// Returned by [`push`] when GitHub has commits this device hasn't merged yet.
pub const BEHIND_MESSAGE: &str = "The backup on GitHub has changes this device doesn't have yet.";

/// Network failures share this wording so the app can show "Working offline".
pub const OFFLINE_MESSAGE: &str =
    "Couldn't reach GitHub. Check your internet connection and try again.";

/// Points the repository's `origin` at `url`.
pub fn set_remote(repository: &Repository, url: &str) -> Result<(), String> {
    match repository.find_remote(REMOTE_NAME) {
        Ok(remote) if remote.url().ok() == Some(url) => Ok(()),
        Ok(_) => repository
            .remote_set_url(REMOTE_NAME, url)
            .map_err(|e| format!("Failed to update backup location: {}", e.message())),
        Err(_) => repository
            .remote(REMOTE_NAME, url)
            .map(|_| ())
            .map_err(|e| format!("Failed to set backup location: {}", e.message())),
    }
}

fn transfer_error_message(e: &git2::Error, action: &str) -> String {
    let message = e.message();
    if e.code() == ErrorCode::Auth || message.contains("401") || message.contains("403") {
        "GitHub didn't accept the connection. Reconnect GitHub in Settings.".to_string()
    } else if e.code() == ErrorCode::NotFastForward {
        BEHIND_MESSAGE.to_string()
    } else if matches!(
        e.class(),
        ErrorClass::Net | ErrorClass::Os | ErrorClass::Ssl
    ) {
        OFFLINE_MESSAGE.to_string()
    } else {
        format!("{} failed: {}", action, message)
    }
}

/// Callbacks that authenticate as the signed-in GitHub user.
fn authenticated_callbacks(token: &str) -> RemoteCallbacks<'_> {
    let mut callbacks = RemoteCallbacks::new();
    let mut auth_attempts = 0;
    callbacks.credentials(move |_url, _username, _allowed| {
        // libgit2 asks again after a rejected credential; stop after one try.
        auth_attempts += 1;
        if auth_attempts > 1 {
            return Err(git2::Error::new(
                ErrorCode::Auth,
                ErrorClass::Http,
                "GitHub rejected the stored sign-in",
            ));
        }
        Cred::userpass_plaintext("x-access-token", token)
    });
    callbacks
}

fn remote_branch_ref() -> String {
    format!("refs/remotes/{}/{}", REMOTE_NAME, DEFAULT_BRANCH)
}

/// Downloads the backup branch from `origin` and returns its latest commit,
/// or `None` when the repository on GitHub is still empty.
pub fn fetch(repository: &Repository, token: &str) -> Result<Option<Oid>, String> {
    let mut remote = repository
        .find_remote(REMOTE_NAME)
        .map_err(|_| "This vault has no backup location yet.".to_string())?;

    let mut options = FetchOptions::new();
    options.remote_callbacks(authenticated_callbacks(token));
    let refspec = format!("+refs/heads/{}:{}", DEFAULT_BRANCH, remote_branch_ref());
    remote
        .fetch(&[refspec.as_str()], Some(&mut options), None)
        .map_err(|e| transfer_error_message(&e, "Download from GitHub"))?;

    match repository.find_reference(&remote_branch_ref()) {
        Ok(reference) => Ok(reference.target()),
        Err(e) if e.code() == ErrorCode::NotFound => Ok(None),
        Err(e) => Err(format!("Failed to read the backup on GitHub: {}", e.message())),
    }
}

/// Pushes the backup branch to `origin`, authenticating with `token`.
///
/// Does nothing when there is no commit yet (an empty vault).
pub fn push(repository: &Repository, token: &str) -> Result<(), String> {
    if repository.head().is_err() {
        return Ok(());
    }

    let mut remote = repository
        .find_remote(REMOTE_NAME)
        .map_err(|_| "This vault has no backup location yet.".to_string())?;

    let rejection: RefCell<Option<String>> = RefCell::new(None);
    let mut callbacks = authenticated_callbacks(token);
    callbacks.push_update_reference(|_refname, status| {
        if let Some(status) = status {
            *rejection.borrow_mut() = Some(status.to_string());
        }
        Ok(())
    });

    let mut options = PushOptions::new();
    options.remote_callbacks(callbacks);

    let refspec = format!("refs/heads/{0}:refs/heads/{0}", DEFAULT_BRANCH);
    remote
        .push(&[refspec.as_str()], Some(&mut options))
        .map_err(|e| transfer_error_message(&e, "Upload to GitHub"))?;
    drop(options);

    match rejection.into_inner() {
        Some(reason) if reason.contains("non-fast-forward") || reason.contains("fetch first") => {
            Err(BEHIND_MESSAGE.to_string())
        }
        Some(reason) => Err(format!("GitHub refused the upload: {}", reason)),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::planner::plan_vault;
    use crate::sync::repo::{commit_plan, open_or_init};
    use crate::sync::state::tests::temp_dir;
    use std::fs;

    #[test]
    fn pushes_the_backup_branch_to_the_remote() {
        let dir = temp_dir("push");
        let (vault, git_dir) = (dir.join("vault"), dir.join("git"));
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("Note.md"), "# Note").unwrap();

        // A local bare repository stands in for GitHub.
        let remote_dir = dir.join("remote.git");
        let remote = Repository::init_bare(&remote_dir).unwrap();

        let repository = open_or_init(&git_dir, &vault).unwrap();
        set_remote(&repository, remote_dir.to_str().unwrap()).unwrap();
        // Setting the same URL again is a no-op.
        set_remote(&repository, remote_dir.to_str().unwrap()).unwrap();

        // Nothing committed yet: nothing to push.
        push(&repository, "token").unwrap();
        assert!(remote.find_reference("refs/heads/main").is_err());

        commit_plan(&repository, &plan_vault(&vault).unwrap()).unwrap();
        push(&repository, "token").unwrap();

        let local_head = repository.head().unwrap().target().unwrap();
        let remote_head = remote.find_reference("refs/heads/main").unwrap().target();
        assert_eq!(remote_head, Some(local_head));
    }

    #[test]
    fn reports_a_remote_that_moved_ahead() {
        let dir = temp_dir("push-behind");
        let remote_dir = dir.join("remote.git");
        Repository::init_bare(&remote_dir).unwrap();

        // Another device pushes first.
        let other_vault = dir.join("other");
        fs::create_dir_all(&other_vault).unwrap();
        fs::write(other_vault.join("Other.md"), "other").unwrap();
        let other = open_or_init(&dir.join("other-git"), &other_vault).unwrap();
        set_remote(&other, remote_dir.to_str().unwrap()).unwrap();
        commit_plan(&other, &plan_vault(&other_vault).unwrap()).unwrap();
        push(&other, "token").unwrap();

        let vault = dir.join("vault");
        fs::create_dir_all(&vault).unwrap();
        fs::write(vault.join("Note.md"), "mine").unwrap();
        let repository = open_or_init(&dir.join("git"), &vault).unwrap();
        set_remote(&repository, remote_dir.to_str().unwrap()).unwrap();
        commit_plan(&repository, &plan_vault(&vault).unwrap()).unwrap();

        let error = push(&repository, "token").unwrap_err();
        assert!(
            error.contains("changes this device doesn't have"),
            "{}",
            error
        );
    }
}
