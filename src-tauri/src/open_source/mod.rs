//! Opening a folder from the web as a new vault, from a
//! `netherstone://open/<address>` link: a template from netherstone.app or a
//! public Markdown folder on github.com.
//!
//! Each kind of address has one reader (`netherstone_app`, `github`) that
//! lists what's there, with sizes, before anything downloads. The person sees
//! that and picks where the vault goes; only then do the files download, into
//! a scratch folder in the app's data, each checked against its listed size
//! and a template's zip against its sha256. A template is unpacked into the
//! new vault as it is. Any other folder goes through the app's Markdown
//! import (`src/lib/open-link.ts`), which turns its links into @ links and its
//! pictures into attachments. The scratch folder is removed after, and on
//! failure or Cancel.
//!
//! Any page can fire the link, so the window only works on the address a
//! launch handed it (`allow`), and nothing is written before Create vault.
//! Only shards, drawings and pictures are written, nothing outside the new
//! vault, and no `.git` or `.netherstone` folder, so the vault gets its own
//! id and no tie back to where it came from.

mod address;
mod download;
mod github;
mod netherstone_app;
mod unpack;

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::Manager;
use tauri::ipc::Channel;

pub use address::Address;
use download::{Pending, Source, Web, check_space, download_all};
use unpack::{move_drawings, unpack};

use crate::import::{self, ImportSourceFile};
use crate::vault;

/// Pictures a shard can show, as the Markdown import brings them in.
const PICTURE_EXTENSIONS: &[&str] = &[
    "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "tif", "tiff",
];

/// Why a link couldn't be opened. The app turns each into its own message.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "code", rename_all = "kebab-case")]
pub enum Refusal {
    /// The template `name` needs a newer app; `version` as the template
    /// gives it. Neither when the list itself is newer than this app reads.
    UpdateFirst {
        name: Option<String>,
        version: Option<String>,
    },
    TemplateNotFound,
    /// Private, renamed or gone.
    CantOpen,
    /// No shards in the folder.
    NothingToOpen,
    /// GitHub cut the listing off.
    TooManyFiles,
    NotEnoughSpace {
        needed: u64,
        free: u64,
        folder: String,
    },
    /// No connection, or what came wasn't what was listed.
    DownloadFailed,
    Cancelled,
    /// The new vault's folder can't be used, as `create_vault` says.
    Vault {
        error: String,
    },
}

/// What a link opens, as the dialog shows it before anything downloads.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    pub template: bool,
    pub name: String,
    pub address: String,
    /// Every file the vault gets.
    pub files: usize,
    pub shards: usize,
    pub drawings: usize,
    pub pictures: usize,
    /// Other files there, which aren't downloaded.
    pub left_out: usize,
    /// What the vault takes on disk.
    pub size: u64,
    #[serde(skip)]
    downloads: Vec<Download>,
    /// A template's first shard, opened once the vault is made.
    #[serde(skip)]
    first_shard: Option<String>,
}

impl Listing {
    /// What the downloads take in the scratch folder.
    fn download_size(&self) -> u64 {
        self.downloads.iter().map(|download| download.size).sum()
    }
}

/// One file to download into the scratch folder.
#[derive(Debug, Clone)]
struct Download {
    /// Where it goes in the scratch folder, `/`-separated and checked.
    path: String,
    url: String,
    size: u64,
    stage: Stage,
    sha256: Option<String>,
}

/// What's downloading, for the dialog's progress line.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    Template,
    Shards,
    Drawings,
    Pictures,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub stage: Stage,
    /// Files of this stage downloaded so far, of `total`.
    pub done: usize,
    pub total: usize,
    /// Bytes downloaded so far, of every stage.
    pub bytes: u64,
    pub total_bytes: u64,
}

/// The kinds of files a vault made from a link may hold.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FileKind {
    Shard,
    Drawing,
    Picture,
}

/// What to do with a path listed in a folder or a zip.
#[derive(Debug, PartialEq, Eq)]
enum PathCheck {
    Keep(FileKind),
    /// Hidden, a name some system can't hold, or not a vault file.
    LeaveOut,
    /// Climbs out, or names a drive or a root: nothing honest lists one.
    Refuse,
}

/// Checks a `/`-separated path from a listing or a zip.
fn check_path(path: &str) -> PathCheck {
    let segments: Vec<&str> = path.split('/').collect();
    let climbs_out = |segment: &&str| {
        segment.is_empty() || *segment == "." || *segment == ".." || segment.contains([':', '\\'])
    };
    if segments.iter().any(climbs_out) {
        return PathCheck::Refuse;
    }
    if segments
        .iter()
        .any(|segment| segment.starts_with('.') || !vault::is_valid_folder_name(segment))
    {
        return PathCheck::LeaveOut;
    }
    let extension = path
        .rsplit_once('.')
        .map(|(_, ext)| ext.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "md" => PathCheck::Keep(FileKind::Shard),
        "excalidraw" => PathCheck::Keep(FileKind::Drawing),
        ext if PICTURE_EXTENSIONS.contains(&ext) => PathCheck::Keep(FileKind::Picture),
        _ => PathCheck::LeaveOut,
    }
}

/// The link the window was handed and is working on.
struct Opening {
    address: Address,
    listing: Option<Listing>,
    cancel: Arc<AtomicBool>,
    scratch: Option<PathBuf>,
}

static OPENING: Mutex<Option<Opening>> = Mutex::new(None);

fn opening() -> std::sync::MutexGuard<'static, Option<Opening>> {
    OPENING.lock().unwrap_or_else(|e| e.into_inner())
}

/// Lets the window open `address`, which a launch handed it, in place of any
/// other.
pub fn allow(address: Address) {
    let previous = opening().replace(Opening {
        address,
        listing: None,
        cancel: Arc::new(AtomicBool::new(false)),
        scratch: None,
    });
    if let Some(previous) = previous {
        previous.cancel.store(true, Ordering::SeqCst);
        if let Some(scratch) = previous.scratch {
            tauri::async_runtime::spawn_blocking(move || remove_scratch(Some(&scratch)));
        }
    }
}

/// The address allowed, if `text` names it.
fn allowed(text: &str) -> Result<Address, Refusal> {
    let address = Address::parse(text).ok_or(Refusal::CantOpen)?;
    match opening().as_ref() {
        Some(opening) if opening.address == address => Ok(address),
        _ => Err(Refusal::CantOpen),
    }
}

/// Where downloads wait, in the app's data.
fn scratch_root() -> Option<PathBuf> {
    crate::db::get_db_path()
        .ok()?
        .parent()
        .map(|data| data.join("opening"))
}

fn remove_scratch(scratch: Option<&Path>) {
    if let Some(scratch) = scratch
        && scratch.exists()
        && let Err(error) = std::fs::remove_dir_all(scratch)
    {
        eprintln!(
            "[Netherstone] Couldn't remove {}: {}",
            scratch.display(),
            error
        );
    }
}

/// Removes downloads left behind when the app stopped mid-way.
pub fn remove_leftovers() {
    remove_scratch(scratch_root().as_deref());
}

/// Lists what the link the window was handed opens.
#[tauri::command]
pub async fn open_link_list(address: String) -> Result<Listing, Refusal> {
    let address = allowed(&address)?;
    let listing = address.reader().list(&Web::new()?).await?;
    if let Some(opening) = opening().as_mut()
        && opening.address == address
    {
        opening.listing = Some(listing.clone());
    }
    Ok(listing)
}

/// What Create vault made.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Created {
    pub vault: String,
    /// A template's first shard, to open.
    pub first_shard: Option<String>,
    /// Any other folder's files, which the Markdown import may now read.
    pub sources: Vec<ImportSourceFile>,
}

/// Downloads what the link opens and makes the vault `parent/name` from it.
#[tauri::command]
pub async fn open_link_create(
    app: tauri::AppHandle,
    address: String,
    parent: String,
    name: String,
    progress: Channel<Progress>,
) -> Result<Created, Refusal> {
    let address = allowed(&address)?;
    let (listing, cancel) = {
        let mut opening = opening();
        let opening = opening
            .as_mut()
            .filter(|opening| opening.address == address)
            .ok_or(Refusal::CantOpen)?;
        opening.cancel.store(false, Ordering::SeqCst);
        (
            opening.listing.clone().ok_or(Refusal::CantOpen)?,
            opening.cancel.clone(),
        )
    };
    let vault_error = |error: String| Refusal::Vault { error };
    let parent = Path::new(&parent);
    let documents = app.path().document_dir().ok();
    crate::vault_access::get()
        .check_new_vault_parent(parent, documents.as_deref())
        .map_err(vault_error)?;
    let folder = vault::check_vault_folder(parent, &name).map_err(vault_error)?;
    let scratch_root = scratch_root().ok_or(Refusal::DownloadFailed)?;
    // The downloads land in the app's data first, maybe on another disk.
    std::fs::create_dir_all(&scratch_root).map_err(|_| Refusal::DownloadFailed)?;
    check_space(&scratch_root, listing.download_size())?;
    check_space(parent, listing.size)?;

    let scratch = scratch_root.join(format!("{}", chrono::Utc::now().timestamp_millis()));
    if let Some(opening) = opening().as_mut() {
        opening.scratch = Some(scratch.clone());
    }
    let made = make(&address, &listing, &scratch, &folder, &cancel, &progress).await;
    if made.is_err() || listing.template {
        remove_scratch(Some(&scratch));
    }
    let created = made?;
    crate::vault_access::get().allow(&folder);
    Ok(created)
}

async fn make(
    address: &Address,
    listing: &Listing,
    scratch: &Path,
    folder: &Path,
    cancel: &AtomicBool,
    progress: &Channel<Progress>,
) -> Result<Created, Refusal> {
    download_all(
        address.reader().as_ref(),
        &Web::new()?,
        listing,
        scratch,
        cancel,
        progress,
    )
    .await?;
    if cancel.load(Ordering::SeqCst) {
        return Err(Refusal::Cancelled);
    }
    // Checked again now the downloads take their space, in case they share
    // the vault's disk.
    if let Some(parent) = folder.parent() {
        check_space(parent, listing.size)?;
    }
    let existed = folder.exists();
    std::fs::create_dir_all(folder).map_err(|error| Refusal::Vault {
        error: error.to_string(),
    })?;
    let vault_path = folder.to_string_lossy().into_owned();
    if !listing.template {
        // Drawings go in as they are; the Markdown import takes the rest.
        let drawings: Vec<PathBuf> = listing
            .downloads
            .iter()
            .filter(|download| download.stage == Stage::Drawings)
            .map(|download| PathBuf::from(&download.path))
            .collect();
        let (scratch_dir, folder_dir) = (scratch.to_path_buf(), folder.to_path_buf());
        tauri::async_runtime::spawn_blocking(move || {
            move_drawings(&scratch_dir, &folder_dir, &drawings)
        })
        .await
        .map_err(|_| Refusal::DownloadFailed)??;
        // The download only: the folders above it are the app's data and
        // the person's, so not the `_attachments` folders there either.
        import::picked().allow_only(&[scratch.to_path_buf()]);
        let mut entries: Vec<PathBuf> = std::fs::read_dir(scratch)
            .map_err(|_| Refusal::DownloadFailed)?
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .collect();
        entries.sort();
        return Ok(Created {
            vault: vault_path,
            first_shard: None,
            sources: import::list_sources(&entries),
        });
    }
    let zip = listing
        .downloads
        .first()
        .map(|download| scratch.join(&download.path))
        .ok_or(Refusal::DownloadFailed)?;
    let target = folder.to_path_buf();
    let unpacked = tauri::async_runtime::spawn_blocking(move || unpack(&zip, &target))
        .await
        .map_err(|_| Refusal::DownloadFailed)?;
    if let Err(refusal) = unpacked {
        // The folder goes too when this made it and nothing else is in it.
        if !existed {
            let _ = std::fs::remove_dir(folder);
        }
        return Err(refusal);
    }
    let first_shard = listing
        .first_shard
        .as_deref()
        .map(|shard| {
            shard
                .split('/')
                .fold(folder.to_path_buf(), |path, segment| path.join(segment))
        })
        .filter(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned());
    Ok(Created {
        vault: vault_path,
        first_shard,
        sources: Vec::new(),
    })
}

/// Stops the download running now. What came so far is removed.
#[tauri::command]
pub fn open_link_cancel() {
    if let Some(opening) = opening().as_ref() {
        opening.cancel.store(true, Ordering::SeqCst);
    }
}

/// Done with the link: the import took what it needed from the scratch
/// folder, or the dialog closed.
#[tauri::command(async)]
pub fn open_link_done() {
    if let Some(opening) = opening().take() {
        opening.cancel.store(true, Ordering::SeqCst);
        if opening.scratch.is_some() {
            import::picked().allow(&[]);
        }
        remove_scratch(opening.scratch.as_deref());
    }
}

/// Whether this app is older than `minimum`, the oldest version a template
/// works in. A minimum with no pre-release (`0.7`, `0.7.0`) takes that
/// version's betas too; one with a pre-release (`0.7.0-beta.2`) is exact.
fn needs_update(minimum: &str, current: &str) -> bool {
    let (Some(minimum), Some(current)) = (version(minimum), version(current)) else {
        return true;
    };
    if minimum.pre.is_empty() {
        (current.major, current.minor, current.patch)
            < (minimum.major, minimum.minor, minimum.patch)
    } else {
        current < minimum
    }
}

/// Reads a version, with any missing minor or patch taken as 0.
fn version(text: &str) -> Option<semver::Version> {
    let text = text.trim().trim_start_matches('v');
    let split = text.find(['-', '+']).unwrap_or(text.len());
    let (core, rest) = text.split_at(split);
    let parts = core.split('.').count();
    let padded = format!("{core}{}{rest}", ".0".repeat(3usize.saturating_sub(parts)));
    semver::Version::parse(&padded).ok()
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_only_vault_files_inside_the_vault() {
        assert_eq!(
            check_path("World/Places.md"),
            PathCheck::Keep(FileKind::Shard)
        );
        assert_eq!(
            check_path("Map.excalidraw"),
            PathCheck::Keep(FileKind::Drawing)
        );
        assert_eq!(
            check_path("_attachments/map.PNG"),
            PathCheck::Keep(FileKind::Picture)
        );
        for left_out in [
            ".git/config",
            ".netherstone/vault-id",
            "docs/.hidden.md",
            "build.sh",
            "a?.md",
            "trailing./a.md",
        ] {
            assert_eq!(check_path(left_out), PathCheck::LeaveOut, "{left_out}");
        }
        for refused in [
            "../a.md",
            "a/../../b.md",
            "/etc/a.md",
            "a//b.md",
            "C:/a.md",
            "a\\..\\b.md",
            "./a.md",
            "",
        ] {
            assert_eq!(check_path(refused), PathCheck::Refuse, "{refused}");
        }
    }

    #[test]
    fn compares_versions() {
        assert!(!needs_update("0.7", "0.7.0-beta.1"));
        assert!(!needs_update("0.7.0", "0.7.2"));
        assert!(needs_update("0.7.0", "0.6.0-beta.2"));
        assert!(needs_update("0.7.0-beta.2", "0.7.0-beta.1"));
        assert!(!needs_update("0.7.0-beta.2", "0.7.0"));
        assert!(needs_update("1", "0.9.0"));
        assert!(needs_update("soon", "0.7.0"));
    }
}
