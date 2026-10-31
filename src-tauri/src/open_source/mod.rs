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

mod github;
mod netherstone_app;

use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::future::Future;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Manager;
use tauri::ipc::Channel;

use crate::import::{self, ImportSourceFile};
use crate::vault;

/// What a link starts with; the address follows.
pub const LINK_PREFIX: &str = "netherstone://open/";

/// The only hosts downloads come from, redirects included.
const HOSTS: &[&str] = &["netherstone.app", "api.github.com", "raw.githubusercontent.com"];

/// Pictures a shard can show, as the Markdown import brings them in.
const PICTURE_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "tif", "tiff"];

/// Files downloaded at once: a few, as GitHub's raw files are small and more
/// at once only risks its abuse limits.
const AT_ONCE: usize = 4;

/// How long a download may go without a byte before it fails, as the sync's
/// requests do.
const STALLED: Duration = Duration::from_secs(30);

/// Where a link points.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Address {
    /// `netherstone.app/templates/<id>`.
    Template { id: String },
    /// `github.com/<owner>/<repo>`, with what follows `/tree/` when given:
    /// the branch and then the folder, which only GitHub can tell apart, as
    /// a branch name can hold `/`.
    GitHub { owner: String, repo: String, tree: Vec<String> },
}

impl Address {
    /// Reads a link, or just its address. Anything but the two known kinds
    /// is refused.
    pub fn parse(text: &str) -> Option<Self> {
        let text = text.trim();
        let text = strip_prefix_ignoring_case(text, LINK_PREFIX).unwrap_or(text);
        let text = strip_prefix_ignoring_case(text, "https://").unwrap_or(text);
        if text.contains(['?', '#', '\\']) {
            return None;
        }
        let segments = text
            .trim_end_matches('/')
            .split('/')
            .map(|segment| {
                let decoded = urlencoding::decode(segment).ok()?;
                let fine = !decoded.is_empty()
                    && decoded != "."
                    && decoded != ".."
                    && !decoded.contains(['/', '\\'])
                    && !decoded.chars().any(char::is_control);
                fine.then(|| decoded.into_owned())
            })
            .collect::<Option<Vec<String>>>()?;
        let (host, rest) = segments.split_first()?;
        let rest: Vec<&str> = rest.iter().map(String::as_str).collect();
        match (host.to_ascii_lowercase().as_str(), rest.as_slice()) {
            ("netherstone.app", ["templates", id]) if is_template_id(id) => Some(Self::Template { id: id.to_string() }),
            ("github.com", [owner, repo, more @ ..]) if is_github_name(owner) && is_github_name(repo) => {
                let tree = match more {
                    [] => Vec::new(),
                    ["tree", tree @ ..] if !tree.is_empty() => tree.iter().map(|s| s.to_string()).collect(),
                    _ => return None,
                };
                Some(Self::GitHub { owner: owner.to_string(), repo: repo.to_string(), tree })
            }
            _ => None,
        }
    }

    /// The address as people see it, `github.com/lena-k/field-guide`.
    pub fn text(&self) -> String {
        match self {
            Self::Template { id } => format!("netherstone.app/templates/{id}"),
            Self::GitHub { owner, repo, tree } if tree.is_empty() => format!("github.com/{owner}/{repo}"),
            Self::GitHub { owner, repo, tree } => format!("github.com/{owner}/{repo}/tree/{}", tree.join("/")),
        }
    }

    fn reader(&self) -> Box<dyn Source> {
        match self {
            Self::Template { id } => Box::new(netherstone_app::Template { id: id.clone() }),
            Self::GitHub { owner, repo, tree } => Box::new(github::Folder {
                owner: owner.clone(),
                repo: repo.clone(),
                tree: tree.clone(),
            }),
        }
    }
}

fn strip_prefix_ignoring_case<'a>(text: &'a str, prefix: &str) -> Option<&'a str> {
    let head = text.get(..prefix.len())?;
    head.eq_ignore_ascii_case(prefix).then(|| &text[prefix.len()..])
}

/// A template's id is its folder's name in the templates collection.
fn is_template_id(id: &str) -> bool {
    id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// The characters GitHub allows in account and repository names.
fn is_github_name(name: &str) -> bool {
    name.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// Why a link couldn't be opened. The app turns each into its own message.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "code", rename_all = "kebab-case")]
pub enum Refusal {
    /// The template `name` needs a newer app; `version` as the template
    /// gives it. Neither when the list itself is newer than this app reads.
    UpdateFirst { name: Option<String>, version: Option<String> },
    TemplateNotFound,
    /// Private, renamed or gone.
    CantOpen,
    /// No shards in the folder.
    NothingToOpen,
    /// GitHub cut the listing off.
    TooManyFiles,
    NotEnoughSpace { needed: u64, free: u64, folder: String },
    /// No connection, or what came wasn't what was listed.
    DownloadFailed,
    Cancelled,
    /// The new vault's folder can't be used, as `create_vault` says.
    Vault { error: String },
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
    if segments.iter().any(|segment| segment.starts_with('.') || !vault::is_valid_folder_name(segment)) {
        return PathCheck::LeaveOut;
    }
    let extension = path.rsplit_once('.').map(|(_, ext)| ext.to_ascii_lowercase()).unwrap_or_default();
    match extension.as_str() {
        "md" => PathCheck::Keep(FileKind::Shard),
        "excalidraw" => PathCheck::Keep(FileKind::Drawing),
        ext if PICTURE_EXTENSIONS.contains(&ext) => PathCheck::Keep(FileKind::Picture),
        _ => PathCheck::LeaveOut,
    }
}

type Pending<'a, T> = Pin<Box<dyn Future<Output = Result<T, Refusal>> + Send + 'a>>;

/// A place links open folders from. A new one is one more reader file and
/// one more kind of `Address`.
trait Source: Send + Sync {
    /// Lists what's there, with sizes. Only the listing is downloaded.
    fn list<'a>(&'a self, web: &'a Web) -> Pending<'a, Listing>;

    /// What a missing file means for this source.
    fn gone(&self) -> Refusal;

    /// Downloads one listed file to `to`, checking it as it comes.
    fn fetch<'a>(&'a self, web: &'a Web, download: &'a Download, to: &'a Path, cancel: &'a AtomicBool) -> Pending<'a, ()> {
        Box::pin(async move {
            let mut response = web.client.get(&download.url).send().await.map_err(|_| Refusal::DownloadFailed)?;
            if response.status() == reqwest::StatusCode::NOT_FOUND {
                return Err(self.gone());
            }
            if !response.status().is_success() {
                return Err(Refusal::DownloadFailed);
            }
            if let Some(parent) = to.parent() {
                std::fs::create_dir_all(parent).map_err(|_| Refusal::DownloadFailed)?;
            }
            let mut file = std::fs::File::create(to).map_err(|_| Refusal::DownloadFailed)?;
            let mut received = Received::new(download);
            while let Some(chunk) = response.chunk().await.map_err(|_| Refusal::DownloadFailed)? {
                if cancel.load(Ordering::SeqCst) {
                    return Err(Refusal::Cancelled);
                }
                received.push(&chunk)?;
                file.write_all(&chunk).map_err(|_| Refusal::DownloadFailed)?;
            }
            received.finish()
        })
    }
}

/// Checks a download against its listing as it arrives: never more bytes
/// than listed, then exactly as many, then the sha256 when there is one.
struct Received {
    size: u64,
    sha256: Option<(String, Sha256)>,
    bytes: u64,
}

impl Received {
    fn new(download: &Download) -> Self {
        Self {
            size: download.size,
            sha256: download.sha256.clone().map(|hex| (hex, Sha256::new())),
            bytes: 0,
        }
    }

    fn push(&mut self, chunk: &[u8]) -> Result<(), Refusal> {
        self.bytes += chunk.len() as u64;
        if self.bytes > self.size {
            return Err(Refusal::DownloadFailed);
        }
        if let Some((_, hasher)) = &mut self.sha256 {
            hasher.update(chunk);
        }
        Ok(())
    }

    fn finish(self) -> Result<(), Refusal> {
        let hash_matches = self.sha256.is_none_or(|(hex, hasher)| {
            let digest: String = hasher.finalize().iter().map(|byte| format!("{byte:02x}")).collect();
            digest.eq_ignore_ascii_case(&hex)
        });
        if self.bytes == self.size && hash_matches {
            Ok(())
        } else {
            Err(Refusal::DownloadFailed)
        }
    }
}

/// The network, as the readers use it.
struct Web {
    client: reqwest::Client,
    /// The sync's sign-in, which lifts GitHub's limit on listings. Opening
    /// works without one.
    github_token: Option<String>,
}

impl Web {
    fn new() -> Result<Self, Refusal> {
        let client = reqwest::Client::builder()
            .user_agent("Netherstone")
            .connect_timeout(STALLED)
            .read_timeout(STALLED)
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.url().host_str().is_some_and(|host| HOSTS.contains(&host)) {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            }))
            .build()
            .map_err(|_| Refusal::DownloadFailed)?;
        let github_token = crate::github::access_token().ok().flatten();
        Ok(Self { client, github_token })
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
        remove_scratch(previous.scratch.as_deref());
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
    crate::db::get_db_path().ok()?.parent().map(|data| data.join("opening"))
}

fn remove_scratch(scratch: Option<&Path>) {
    if let Some(scratch) = scratch
        && scratch.exists()
        && let Err(error) = std::fs::remove_dir_all(scratch)
    {
        eprintln!("[Netherstone] Couldn't remove {}: {}", scratch.display(), error);
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
        let opening = opening.as_mut().filter(|opening| opening.address == address).ok_or(Refusal::CantOpen)?;
        opening.cancel.store(false, Ordering::SeqCst);
        (opening.listing.clone().ok_or(Refusal::CantOpen)?, opening.cancel.clone())
    };
    let vault_error = |error: String| Refusal::Vault { error };
    let parent = Path::new(&parent);
    let documents = app.path().document_dir().ok();
    crate::vault_access::get().check_new_vault_parent(parent, documents.as_deref()).map_err(vault_error)?;
    let folder = vault::check_vault_folder(parent, &name).map_err(vault_error)?;
    let free = fs4::available_space(parent).map_err(|error| vault_error(error.to_string()))?;
    if free < listing.size {
        return Err(Refusal::NotEnoughSpace {
            needed: listing.size,
            free,
            folder: parent.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_else(|| parent.display().to_string()),
        });
    }

    let scratch = scratch_root()
        .ok_or(Refusal::DownloadFailed)?
        .join(format!("{}", chrono::Utc::now().timestamp_millis()));
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
    download_all(address.reader().as_ref(), &Web::new()?, listing, scratch, cancel, progress).await?;
    if cancel.load(Ordering::SeqCst) {
        return Err(Refusal::Cancelled);
    }
    let existed = folder.exists();
    std::fs::create_dir_all(folder).map_err(|error| Refusal::Vault { error: error.to_string() })?;
    let vault_path = folder.to_string_lossy().into_owned();
    if !listing.template {
        // The download only: the folders above it are the app's data and
        // the person's, so not the `_attachments` folders there either.
        import::picked().allow_only(&[scratch.to_path_buf()]);
        let mut entries: Vec<PathBuf> = std::fs::read_dir(scratch)
            .map_err(|_| Refusal::DownloadFailed)?
            .filter_map(|entry| entry.ok().map(|entry| entry.path()))
            .collect();
        entries.sort();
        return Ok(Created { vault: vault_path, first_shard: None, sources: import::list_sources(&entries) });
    }
    let zip = listing.downloads.first().map(|download| scratch.join(&download.path)).ok_or(Refusal::DownloadFailed)?;
    if let Err(refusal) = unpack(&zip, folder) {
        // The folder goes too when this made it and nothing else is in it.
        if !existed {
            let _ = std::fs::remove_dir(folder);
        }
        return Err(refusal);
    }
    let first_shard = listing
        .first_shard
        .as_deref()
        .map(|shard| shard.split('/').fold(folder.to_path_buf(), |path, segment| path.join(segment)))
        .filter(|path| path.is_file())
        .map(|path| path.to_string_lossy().into_owned());
    Ok(Created { vault: vault_path, first_shard, sources: Vec::new() })
}

async fn download_all(
    source: &dyn Source,
    web: &Web,
    listing: &Listing,
    scratch: &Path,
    cancel: &AtomicBool,
    progress: &Channel<Progress>,
) -> Result<(), Refusal> {
    let total_bytes = listing.downloads.iter().map(|download| download.size).sum();
    let mut bytes = 0;
    for stage in [Stage::Template, Stage::Shards, Stage::Pictures] {
        let downloads: Vec<&Download> = listing.downloads.iter().filter(|download| download.stage == stage).collect();
        if downloads.is_empty() {
            continue;
        }
        let total = downloads.len();
        let report = |done, bytes| {
            let _ = progress.send(Progress { stage, done, total, bytes, total_bytes });
        };
        report(0, bytes);
        let fetches: Vec<Pending<'_, u64>> = downloads
            .iter()
            .map(|&download| -> Pending<'_, u64> {
                Box::pin(async move {
                    let to = download.path.split('/').fold(scratch.to_path_buf(), |path, segment| path.join(segment));
                    source.fetch(web, download, &to, cancel).await.map(|()| download.size)
                })
            })
            .collect();
        let mut fetches = futures_util::stream::iter(fetches).buffer_unordered(AT_ONCE);
        let mut done = 0;
        while let Some(fetched) = fetches.next().await {
            bytes += fetched?;
            done += 1;
            report(done, bytes);
        }
    }
    Ok(())
}

/// Unpacks a template's zip into the new vault: its shards, drawings and
/// pictures, as they are. Every entry is checked before anything is written.
/// When it fails part way, it takes back the files and folders it wrote and
/// leaves anything else, such as files put in the folder while it downloaded.
fn unpack(zip: &Path, vault_folder: &Path) -> Result<(), Refusal> {
    let mut written = Vec::new();
    let unpacked = unpack_into(zip, vault_folder, &mut written);
    if unpacked.is_err() {
        // Newest first, so a folder's files go before it; a folder goes
        // only when nothing else was put in it.
        for path in written.iter().rev() {
            let _ = match path {
                Written::File(path) => std::fs::remove_file(path),
                Written::Folder(path) => std::fs::remove_dir(path),
            };
        }
    }
    unpacked
}

/// A file or folder `unpack` made.
enum Written {
    File(PathBuf),
    Folder(PathBuf),
}

fn unpack_into(zip: &Path, vault_folder: &Path, written: &mut Vec<Written>) -> Result<(), Refusal> {
    fn failed<E>(_: E) -> Refusal {
        Refusal::DownloadFailed
    }
    let mut archive = zip::ZipArchive::new(std::fs::File::open(zip).map_err(failed)?).map_err(failed)?;
    let mut keep = Vec::new();
    for index in 0..archive.len() {
        let entry = archive.by_index_raw(index).map_err(failed)?;
        if entry.is_dir() {
            continue;
        }
        if entry.is_symlink() {
            return Err(Refusal::DownloadFailed);
        }
        match check_path(entry.name()) {
            PathCheck::Keep(_) => keep.push((index, entry.name().to_string(), entry.size())),
            PathCheck::LeaveOut => {}
            PathCheck::Refuse => return Err(Refusal::DownloadFailed),
        }
    }
    for (index, name, size) in keep {
        let target = name.split('/').fold(vault_folder.to_path_buf(), |path, segment| path.join(segment));
        if let Some(parent) = target.parent() {
            create_folders(parent, vault_folder, written).map_err(failed)?;
        }
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&target).map_err(failed)?;
        written.push(Written::File(target));
        let entry = archive.by_index(index).map_err(failed)?;
        let copied = std::io::copy(&mut entry.take(size + 1), &mut file).map_err(failed)?;
        if copied != size {
            return Err(Refusal::DownloadFailed);
        }
    }
    Ok(())
}

/// Makes `folder` and the folders above it, up to `vault_folder`, noting
/// the ones it made.
fn create_folders(folder: &Path, vault_folder: &Path, written: &mut Vec<Written>) -> std::io::Result<()> {
    if folder == vault_folder {
        return Ok(());
    }
    if let Some(parent) = folder.parent() {
        create_folders(parent, vault_folder, written)?;
    }
    match std::fs::create_dir(folder) {
        Ok(()) => written.push(Written::Folder(folder.to_path_buf())),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists && folder.is_dir() => {}
        Err(error) => return Err(error),
    }
    Ok(())
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
        (current.major, current.minor, current.patch) < (minimum.major, minimum.minor, minimum.patch)
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
    use crate::sync::state::tests::temp_dir;

    fn github(owner: &str, repo: &str, tree: &[&str]) -> Address {
        Address::GitHub {
            owner: owner.into(),
            repo: repo.into(),
            tree: tree.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn reads_addresses() {
        let template = Some(Address::Template { id: "worldbuilding".into() });
        assert_eq!(Address::parse("netherstone://open/netherstone.app/templates/worldbuilding"), template);
        assert_eq!(Address::parse("NETHERSTONE://open/netherstone.app/templates/worldbuilding/"), template);
        assert_eq!(Address::parse("netherstone.app/templates/worldbuilding"), template);
        assert_eq!(Address::parse("netherstone://open/github.com/lena-k/field-guide"), Some(github("lena-k", "field-guide", &[])));
        assert_eq!(
            Address::parse("netherstone://open/https://github.com/lena-k/field-guide/tree/main/Field%20notes"),
            Some(github("lena-k", "field-guide", &["main", "Field notes"]))
        );
        assert_eq!(github("lena-k", "field-guide", &["main", "docs"]).text(), "github.com/lena-k/field-guide/tree/main/docs");
    }

    #[test]
    fn refuses_other_addresses() {
        for text in [
            "netherstone://open/example.com/templates/worldbuilding",
            "netherstone://open/netherstone.app/templates/../etc",
            "netherstone://open/netherstone.app/templates/a%2Fb",
            "netherstone://open/netherstone.app/templates",
            "netherstone://open/netherstone.app/other/worldbuilding",
            "netherstone://open/github.com/lena-k",
            "netherstone://open/github.com/lena-k/field-guide/blob/main/README.md",
            "netherstone://open/github.com/lena-k/field-guide/tree",
            "netherstone://open/github.com/lena-k/field-guide/tree/main/..",
            "netherstone://open/github.com/lena-k/field-guide/tree/main/%2E%2E",
            "netherstone://open/github.com/lena-k/field-guide?x=1",
            "netherstone://open/github.com/lena k/field-guide",
            "netherstone://open/github.com//field-guide",
            "netherstone://open/raw.githubusercontent.com/lena-k/field-guide/main/a.md",
        ] {
            assert_eq!(Address::parse(text), None, "{text}");
        }
    }

    #[test]
    fn writes_only_vault_files_inside_the_vault() {
        assert_eq!(check_path("World/Places.md"), PathCheck::Keep(FileKind::Shard));
        assert_eq!(check_path("Map.excalidraw"), PathCheck::Keep(FileKind::Drawing));
        assert_eq!(check_path("_attachments/map.PNG"), PathCheck::Keep(FileKind::Picture));
        for left_out in [".git/config", ".netherstone/vault-id", "docs/.hidden.md", "build.sh", "a?.md", "trailing./a.md"] {
            assert_eq!(check_path(left_out), PathCheck::LeaveOut, "{left_out}");
        }
        for refused in ["../a.md", "a/../../b.md", "/etc/a.md", "a//b.md", "C:/a.md", "a\\..\\b.md", "./a.md", ""] {
            assert_eq!(check_path(refused), PathCheck::Refuse, "{refused}");
        }
    }

    fn download(size: u64, sha256: Option<&str>) -> Download {
        Download { path: "a.md".into(), url: String::new(), size, stage: Stage::Shards, sha256: sha256.map(String::from) }
    }

    #[test]
    fn checks_sizes_and_hashes() {
        let mut received = Received::new(&download(5, None));
        received.push(b"hel").unwrap();
        received.push(b"lo").unwrap();
        assert_eq!(received.finish(), Ok(()));

        let mut short = Received::new(&download(5, None));
        short.push(b"hel").unwrap();
        assert_eq!(short.finish(), Err(Refusal::DownloadFailed));

        let mut long = Received::new(&download(2, None));
        assert_eq!(long.push(b"hel"), Err(Refusal::DownloadFailed));

        // sha256 of "hello".
        let hello = "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824";
        let mut hashed = Received::new(&download(5, Some(hello)));
        hashed.push(b"hello").unwrap();
        assert_eq!(hashed.finish(), Ok(()));

        let mut wrong = Received::new(&download(5, Some(hello)));
        wrong.push(b"jello").unwrap();
        assert_eq!(wrong.finish(), Err(Refusal::DownloadFailed));
    }

    fn zip_of(dir: &Path, entries: &[(&str, &[u8])]) -> PathBuf {
        let path = dir.join("template.zip");
        let mut writer = zip::ZipWriter::new(std::fs::File::create(&path).unwrap());
        let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (name, bytes) in entries {
            writer.start_file(*name, options).unwrap();
            writer.write_all(bytes).unwrap();
        }
        writer.finish().unwrap();
        path
    }

    #[test]
    fn unpacks_templates_as_they_are() {
        let dir = temp_dir("open-source-unpack");
        let zip = zip_of(
            &dir,
            &[
                ("Start here.md", b"# Start"),
                ("World/Places.md", b"@Start here"),
                ("_attachments/map.png", b"png"),
                (".netherstone/vault-id", b"old"),
                ("run.sh", b"echo"),
            ],
        );
        let vault_folder = dir.join("Worldbuilding");
        std::fs::create_dir(&vault_folder).unwrap();
        unpack(&zip, &vault_folder).unwrap();
        assert_eq!(std::fs::read_to_string(vault_folder.join("World").join("Places.md")).unwrap(), "@Start here");
        assert!(vault_folder.join("_attachments").join("map.png").is_file());
        assert!(!vault_folder.join(".netherstone").exists());
        assert!(!vault_folder.join("run.sh").exists());

        let climbing = zip_of(&dir, &[("Start here.md", b"# Start"), ("../outside.md", b"x")]);
        let other = dir.join("Other");
        std::fs::create_dir(&other).unwrap();
        assert_eq!(unpack(&climbing, &other), Err(Refusal::DownloadFailed));
        assert!(!dir.join("outside.md").exists());
        assert!(!other.join("Start here.md").exists());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_failed_unpack_takes_back_only_what_it_wrote() {
        let dir = temp_dir("open-source-unpack-failed");
        let zip = zip_of(&dir, &[("Start here.md", b"# Start"), ("World/Places.md", b"x"), ("Mine/Map.md", b"x"), ("Notes.md", b"x")]);
        let vault_folder = dir.join("Worldbuilding");
        // Put in the folder while the template downloaded.
        std::fs::create_dir_all(vault_folder.join("Mine")).unwrap();
        std::fs::write(vault_folder.join("Notes.md"), "mine").unwrap();

        assert_eq!(unpack(&zip, &vault_folder), Err(Refusal::DownloadFailed));
        assert_eq!(std::fs::read_to_string(vault_folder.join("Notes.md")).unwrap(), "mine");
        assert!(vault_folder.join("Mine").is_dir());
        assert!(!vault_folder.join("Mine").join("Map.md").exists());
        assert!(!vault_folder.join("Start here.md").exists());
        assert!(!vault_folder.join("World").exists());
        std::fs::remove_dir_all(&dir).unwrap();
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
