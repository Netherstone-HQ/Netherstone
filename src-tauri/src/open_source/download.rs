//! Downloading what a listing names into the scratch folder: only from the
//! known sources, a few files at once, each checked as it comes.

use futures_util::StreamExt;
use sha2::{Digest, Sha256};
use std::future::Future;
use std::path::Path;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use tauri::ipc::Channel;
use tokio::io::AsyncWriteExt;

use super::{Download, Listing, Progress, Refusal, Stage};
use crate::links;

/// The only places downloads come from, redirects included.
const SOURCES: &[&str] = &[links::SITE, links::GITHUB_API, links::GITHUB_RAW];

fn is_source_host(host: &str) -> bool {
    SOURCES
        .iter()
        .any(|source| reqwest::Url::parse(source).is_ok_and(|url| url.host_str() == Some(host)))
}

/// Files downloaded at once: a few, as GitHub's raw files are small and more
/// at once only risks its abuse limits.
const AT_ONCE: usize = 4;

/// How long a download may go without a byte before it fails, as the sync's
/// requests do.
const STALLED: Duration = Duration::from_secs(30);

pub(super) type Pending<'a, T> = Pin<Box<dyn Future<Output = Result<T, Refusal>> + Send + 'a>>;

/// A place links open folders from. A new one is one more reader file and
/// one more kind of `Address`.
pub(super) trait Source: Send + Sync {
    /// Lists what's there, with sizes. Only the listing is downloaded.
    fn list<'a>(&'a self, web: &'a Web) -> Pending<'a, Listing>;

    /// What a missing file means for this source.
    fn gone(&self) -> Refusal;

    /// Downloads one listed file to `to`, checking it as it comes.
    fn fetch<'a>(
        &'a self,
        web: &'a Web,
        download: &'a Download,
        to: &'a Path,
        cancel: &'a AtomicBool,
    ) -> Pending<'a, ()> {
        Box::pin(async move {
            let mut response = web
                .client
                .get(&download.url)
                .send()
                .await
                .map_err(|_| Refusal::DownloadFailed)?;
            if response.status() == reqwest::StatusCode::NOT_FOUND {
                return Err(self.gone());
            }
            if !response.status().is_success() {
                return Err(Refusal::DownloadFailed);
            }
            if let Some(parent) = to.parent() {
                tokio::fs::create_dir_all(parent)
                    .await
                    .map_err(|_| Refusal::DownloadFailed)?;
            }
            let mut file = tokio::fs::File::create(to)
                .await
                .map_err(|_| Refusal::DownloadFailed)?;
            let mut received = Received::new(download);
            while let Some(chunk) = response
                .chunk()
                .await
                .map_err(|_| Refusal::DownloadFailed)?
            {
                if cancel.load(Ordering::SeqCst) {
                    return Err(Refusal::Cancelled);
                }
                received.push(&chunk)?;
                file.write_all(&chunk)
                    .await
                    .map_err(|_| Refusal::DownloadFailed)?;
            }
            file.flush().await.map_err(|_| Refusal::DownloadFailed)?;
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
            let digest: String = hasher
                .finalize()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect();
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
pub(super) struct Web {
    pub(super) client: reqwest::Client,
    /// The sync's sign-in, which lifts GitHub's limit on listings. Opening
    /// works without one.
    pub(super) github_token: Option<String>,
}

impl Web {
    pub(super) fn new() -> Result<Self, Refusal> {
        let client = reqwest::Client::builder()
            .user_agent("Netherstone")
            .connect_timeout(STALLED)
            .read_timeout(STALLED)
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.url().host_str().is_some_and(is_source_host) {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            }))
            .build()
            .map_err(|_| Refusal::DownloadFailed)?;
        let github_token = crate::github::access_token().ok().flatten();
        Ok(Self {
            client,
            github_token,
        })
    }
}

pub(super) async fn download_all(
    source: &dyn Source,
    web: &Web,
    listing: &Listing,
    scratch: &Path,
    cancel: &AtomicBool,
    progress: &Channel<Progress>,
) -> Result<(), Refusal> {
    let total_bytes = listing.download_size();
    let mut bytes = 0;
    for stage in [
        Stage::Template,
        Stage::Shards,
        Stage::Drawings,
        Stage::Pictures,
    ] {
        let downloads: Vec<&Download> = listing
            .downloads
            .iter()
            .filter(|download| download.stage == stage)
            .collect();
        if downloads.is_empty() {
            continue;
        }
        let total = downloads.len();
        let report = |done, bytes| {
            let _ = progress.send(Progress {
                stage,
                done,
                total,
                bytes,
                total_bytes,
            });
        };
        report(0, bytes);
        let fetches: Vec<Pending<'_, u64>> = downloads
            .iter()
            .map(|&download| -> Pending<'_, u64> {
                Box::pin(async move {
                    let to = download
                        .path
                        .split('/')
                        .fold(scratch.to_path_buf(), |path, segment| path.join(segment));
                    source
                        .fetch(web, download, &to, cancel)
                        .await
                        .map(|()| download.size)
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

/// Refuses when the disk holding `folder` has less than `needed` free.
pub(super) fn check_space(folder: &Path, needed: u64) -> Result<(), Refusal> {
    let free = fs4::available_space(folder).map_err(|error| Refusal::Vault {
        error: error.to_string(),
    })?;
    if free < needed {
        return Err(Refusal::NotEnoughSpace {
            needed,
            free,
            folder: folder
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| folder.display().to_string()),
        });
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;

    fn download(size: u64, sha256: Option<&str>) -> Download {
        Download {
            path: "a.md".into(),
            url: String::new(),
            size,
            stage: Stage::Shards,
            sha256: sha256.map(String::from),
        }
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
}
