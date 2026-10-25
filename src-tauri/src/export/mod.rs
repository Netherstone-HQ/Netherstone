//! Shard export: the save dialog, writing finished files, loading the images
//! a shard shows, and printing PDFs through the platform webview (see `pdf`).
//!
//! The front end turns a shard into HTML or a Word document
//! (`src/lib/export/`). Large payloads travel as raw IPC bodies, not JSON.

pub mod pdf;
mod pdf_platform;

use std::fs;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use tauri::ipc::{Request, Response};
use tauri_plugin_dialog::DialogExt;

/// Remote images larger than this are left out of an export.
const MAX_REMOTE_ASSET_BYTES: usize = 40 * 1024 * 1024;
const REMOTE_ASSET_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExportFormat {
    Html,
    Pdf,
    Docx,
}

impl ExportFormat {
    fn filter(self) -> (&'static str, &'static str) {
        match self {
            ExportFormat::Html => ("Web page", "html"),
            ExportFormat::Pdf => ("PDF document", "pdf"),
            ExportFormat::Docx => ("Word document", "docx"),
        }
    }
}

/// Paths picked in the save dialog this session: exports are only written
/// there.
static CHOSEN_PATHS: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

fn check_chosen(path: &Path) -> Result<(), String> {
    let chosen = CHOSEN_PATHS.lock().unwrap_or_else(|e| e.into_inner());
    if chosen.iter().any(|chosen| chosen == path) {
        Ok(())
    } else {
        Err("Choose where to save the export first.".to_string())
    }
}

/// Asks where to save an export. Returns the chosen path, with the format's
/// extension added if the name was typed without it.
#[tauri::command(async)]
pub fn choose_export_path(
    app: tauri::AppHandle,
    default_name: String,
    default_directory: Option<String>,
    format: ExportFormat,
) -> Option<String> {
    let (label, extension) = format.filter();
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Export shard")
        .add_filter(label, &[extension])
        .set_file_name(format!("{}.{extension}", sanitize_file_stem(&default_name)));

    if let Some(directory) = default_directory
        .map(PathBuf::from)
        .filter(|directory| directory.is_dir())
    {
        dialog = dialog.set_directory(directory);
    }

    let path = with_extension(dialog.blocking_save_file()?.into_path().ok()?, extension);
    CHOSEN_PATHS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .push(path.clone());
    Some(path.to_string_lossy().into_owned())
}

/// A header of a raw IPC request, URI-decoded.
pub(crate) fn header(request: &Request<'_>, name: &str) -> Option<String> {
    request
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| urlencoding::decode(value).ok())
        .map(|value| value.into_owned())
}

pub(crate) fn raw_body<'a>(request: &'a Request<'_>) -> Result<&'a [u8], String> {
    match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => Ok(bytes),
        _ => Err("The file arrived in an unexpected format.".to_string()),
    }
}

/// Writes a finished HTML or Word export. The body is the file; the target
/// path comes URI-encoded in the `x-export-path` header.
#[tauri::command(async)]
pub fn write_export_file(request: Request<'_>) -> Result<(), String> {
    let path = header(&request, "x-export-path").ok_or("The export is missing its destination.")?;
    check_chosen(Path::new(&path))?;
    write_atomically(Path::new(&path), raw_body(&request)?)
}

/// Reads an image on this computer for an export. Only pictures, the same
/// files a shard may show from anywhere.
#[tauri::command(async)]
pub fn read_export_asset(path: String) -> Result<Response, String> {
    if !crate::asset_scope::is_showable(Path::new(&path)) {
        return Err(format!("{path} isn't a picture"));
    }
    fs::read(&path)
        .map(Response::new)
        .map_err(|error| format!("Could not read {path}: {error}"))
}

/// How many redirects a remote image may take.
const MAX_REDIRECTS: usize = 5;

/// Downloads an image a shard links to on the web, so exports can carry it.
/// Only addresses on the internet are fetched, never this computer or its
/// local network, redirects included.
#[tauri::command]
pub async fn fetch_export_asset(url: String) -> Result<Response, String> {
    let failed = |error: &dyn std::fmt::Display| format!("Could not download {url}: {error}");
    let mut target = reqwest::Url::parse(&url).map_err(|error| failed(&error))?;
    let mut redirects = 0;
    let mut response = loop {
        let address = public_address(&target).await.map_err(|error| failed(&error))?;
        let client = reqwest::Client::builder()
            .timeout(REMOTE_ASSET_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            // Connects to the address just checked, whatever the name
            // resolves to by then.
            .resolve(target.host_str().unwrap_or_default(), address)
            .build()
            .map_err(|error| failed(&error))?;
        let response = client
            .get(target.clone())
            .send()
            .await
            .and_then(|response| response.error_for_status())
            .map_err(|error| failed(&error))?;
        if !response.status().is_redirection() {
            break response;
        }
        redirects += 1;
        let location = response
            .headers()
            .get(reqwest::header::LOCATION)
            .and_then(|location| location.to_str().ok())
            .filter(|_| redirects <= MAX_REDIRECTS)
            .ok_or_else(|| failed(&"too many redirects"))?;
        target = target.join(location).map_err(|error| failed(&error))?;
    };

    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|error| failed(&error))? {
        bytes.extend_from_slice(&chunk);
        if bytes.len() > MAX_REMOTE_ASSET_BYTES {
            return Err(format!("{url} is too large to include."));
        }
    }

    Ok(Response::new(bytes))
}

/// The address to fetch `url` from: an http or https address whose host is
/// on the internet.
async fn public_address(url: &reqwest::Url) -> Result<SocketAddr, String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("only web addresses can be downloaded".to_string());
    }
    let port = url.port_or_known_default().unwrap_or(443);
    let host = url.host_str().unwrap_or_default();
    let literal = host.trim_start_matches('[').trim_end_matches(']').parse::<IpAddr>();
    let addresses: Vec<SocketAddr> = match literal {
        Ok(ip) => vec![SocketAddr::new(ip, port)],
        Err(_) if host.is_empty() => Vec::new(),
        Err(_) => {
            let host = host.to_string();
            tauri::async_runtime::spawn_blocking(move || {
                (host.as_str(), port)
                    .to_socket_addrs()
                    .map(|addresses| addresses.collect())
            })
            .await
            .map_err(|error| error.to_string())?
            .map_err(|error| error.to_string())?
        }
    };
    match addresses.first() {
        Some(first) if addresses.iter().all(|address| is_public(address.ip())) => Ok(*first),
        Some(_) => Err("it isn't on the internet".to_string()),
        None => Err("its address couldn't be found".to_string()),
    }
}

/// False for this computer, local networks and other addresses that aren't
/// on the internet.
fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, ..] = ip.octets();
            !(ip.is_loopback()
                || ip.is_private()
                || ip.is_link_local()
                || ip.is_unspecified()
                || ip.is_broadcast()
                || ip.is_documentation()
                || ip.is_multicast()
                || a == 0
                || (a == 100 && (64..128).contains(&b)))
        }
        IpAddr::V6(ip) => match ip.to_ipv4_mapped() {
            Some(v4) => is_public(IpAddr::V4(v4)),
            None => {
                let first = ip.segments()[0];
                !(ip.is_loopback()
                    || ip.is_unspecified()
                    || ip.is_multicast()
                    || (first & 0xfe00) == 0xfc00
                    || (first & 0xffc0) == 0xfe80)
            }
        },
    }
}

/// Prints an HTML export to PDF. The body is the HTML; the destination and
/// the paper come URI-encoded in the `x-export-path` and `x-export-page`
/// (JSON, see `pdf::PageSetup`) headers.
#[tauri::command]
pub async fn export_pdf(app: tauri::AppHandle, request: Request<'_>) -> Result<(), String> {
    let output = PathBuf::from(header(&request, "x-export-path").ok_or("The export is missing its destination.")?);
    check_chosen(&output)?;
    let page: pdf::PageSetup =
        serde_json::from_str(&header(&request, "x-export-page").ok_or("The export is missing its paper size.")?)
            .map_err(|error| format!("The export's paper size is malformed: {error}"))?;
    let html = raw_body(&request)?.to_vec();

    // Printed beside the target, then renamed over it, like other exports.
    let temp_path = temp_path_for(&output)?;
    // Whatever a cut short export left there goes first, so the printer
    // never writes through a link to somewhere else.
    match fs::remove_file(&temp_path) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            return Err(describe_write_error(&output, error));
        }
        _ => {}
    }
    if let Err(error) = pdf::render(&app, html, page, temp_path.clone()).await {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }
    fs::rename(&temp_path, &output).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        describe_write_error(&output, error)
    })
}

fn temp_path_for(path: &Path) -> Result<PathBuf, String> {
    let file_name = path
        .file_name()
        .ok_or("Choose a file name for the export.")?
        .to_string_lossy();
    Ok(path.with_file_name(format!(".{file_name}.part")))
}

/// Writes next to the target and renames over it, so a failed export never
/// leaves half a file behind.
fn write_atomically(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temp_path = temp_path_for(path)?;

    crate::vault::create_temp(&temp_path)
        .and_then(|mut file| std::io::Write::write_all(&mut file, bytes))
        .map_err(|error| describe_write_error(path, error))?;

    fs::rename(&temp_path, path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        describe_write_error(path, error)
    })
}

fn describe_write_error(path: &Path, error: std::io::Error) -> String {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string_lossy().into_owned());

    match error.kind() {
        std::io::ErrorKind::PermissionDenied => format!(
            "Netherstone can't write {name}. If it's open in another app, close it and try again."
        ),
        _ => format!("Could not save {name}: {error}"),
    }
}

/// Characters Windows, macOS and Linux all accept in a file name.
fn sanitize_file_stem(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|character| match character {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => '-',
            character if character.is_control() => '-',
            character => character,
        })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.');

    if trimmed.is_empty() {
        "Untitled".to_string()
    } else {
        trimmed.to_string()
    }
}

fn with_extension(path: PathBuf, extension: &str) -> PathBuf {
    let has_extension = path
        .extension()
        .is_some_and(|current| current.eq_ignore_ascii_case(extension));

    if has_extension {
        path
    } else {
        let mut name = path.file_name().unwrap_or_default().to_os_string();
        name.push(".");
        name.push(extension);
        path.with_file_name(name)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_stems_drop_reserved_characters() {
        assert_eq!(sanitize_file_stem("Plan: Q3/Q4?"), "Plan- Q3-Q4-");
        assert_eq!(sanitize_file_stem("  notes.  "), "notes");
        assert_eq!(sanitize_file_stem("***"), "---");
        assert_eq!(sanitize_file_stem(""), "Untitled");
    }

    #[test]
    fn extensions_are_added_once() {
        assert_eq!(
            with_extension(PathBuf::from("a/report"), "pdf"),
            PathBuf::from("a/report.pdf")
        );
        assert_eq!(
            with_extension(PathBuf::from("a/report.PDF"), "pdf"),
            PathBuf::from("a/report.PDF")
        );
        assert_eq!(
            with_extension(PathBuf::from("a/v1.2"), "docx"),
            PathBuf::from("a/v1.2.docx")
        );
    }

    #[test]
    fn atomic_writes_replace_the_target() {
        let directory = std::env::temp_dir().join(format!(
            "netherstone-export-test-{}",
            std::process::id()
        ));
        fs::create_dir_all(&directory).unwrap();
        let target = directory.join("out.html");

        write_atomically(&target, b"first").unwrap();
        write_atomically(&target, b"second").unwrap();

        assert_eq!(fs::read(&target).unwrap(), b"second");
        assert!(!directory.join(".out.html.part").exists());
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn only_addresses_on_the_internet_are_fetched() {
        for ip in ["93.184.216.34", "1.1.1.1", "2606:4700:4700::1111"] {
            assert!(is_public(ip.parse().unwrap()), "{ip}");
        }
        for ip in [
            "127.0.0.1", "10.0.0.5", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0",
            "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:192.168.0.1",
        ] {
            assert!(!is_public(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn exports_are_only_written_where_the_user_chose() {
        let chosen = std::env::temp_dir().join("netherstone-chosen-export.html");
        assert!(check_chosen(&chosen).is_err());
        CHOSEN_PATHS.lock().unwrap().push(chosen.clone());
        assert!(check_chosen(&chosen).is_ok());
        assert!(check_chosen(&chosen.with_file_name(".bashrc")).is_err());
    }
}
