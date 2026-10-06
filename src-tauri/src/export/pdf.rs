//! PDF export through the webview the app already runs on. A hidden window
//! loads the export's HTML from an internal URL, waits until its fonts and
//! images are ready, and asks the platform webview to print it to a file
//! (see `pdf_platform`). The text stays text: fonts are embedded and links
//! keep working.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::Deserialize;
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager, Runtime, UriSchemeContext, UriSchemeResponder, WebviewUrl};
use tokio::sync::oneshot;

use super::pdf_platform;

/// The internal URL scheme export pages load from.
pub const SCHEME: &str = "nsexport";

const READY_TIMEOUT: Duration = Duration::from_secs(30);
const PRINT_TIMEOUT: Duration = Duration::from_secs(60);

/// Paper and margins, in millimetres.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageSetup {
    pub width_mm: f64,
    pub height_mm: f64,
    pub margin_top_mm: f64,
    pub margin_right_mm: f64,
    pub margin_bottom_mm: f64,
    pub margin_left_mm: f64,
}

struct Job {
    html: Vec<u8>,
    ready: Option<oneshot::Sender<()>>,
}

fn jobs() -> &'static Mutex<HashMap<String, Job>> {
    static JOBS: OnceLock<Mutex<HashMap<String, Job>>> = OnceLock::new();
    JOBS.get_or_init(Default::default)
}

/// Serves `/<job>/page.html`, and hears `/<job>/ready` from the page once
/// its fonts and images have loaded.
pub fn serve<R: Runtime>(_: UriSchemeContext<'_, R>, request: Request<Vec<u8>>, responder: UriSchemeResponder) {
    let path = request.uri().path().trim_start_matches('/').to_string();
    let (job_id, file) = path.split_once('/').unwrap_or((path.as_str(), ""));
    let mut jobs = jobs().lock().unwrap();

    let response = match (jobs.get_mut(job_id), file) {
        (Some(job), "page.html") => Response::builder()
            .header("Content-Type", "text/html; charset=utf-8")
            .body(job.html.clone()),
        (Some(job), "ready") => {
            if let Some(ready) = job.ready.take() {
                let _ = ready.send(());
            }
            Response::builder().status(StatusCode::NO_CONTENT).body(Vec::new())
        }
        _ => Response::builder().status(StatusCode::NOT_FOUND).body(Vec::new()),
    };

    responder.respond(response.unwrap_or_else(|_| Response::new(Vec::new())));
}

fn page_url(job_id: &str) -> tauri::Url {
    // Windows serves custom schemes as http://<scheme>.localhost.
    let address = if cfg!(windows) {
        format!("http://{SCHEME}.localhost/{job_id}/page.html")
    } else {
        format!("{SCHEME}://localhost/{job_id}/page.html")
    };
    tauri::Url::parse(&address).expect("export page URLs are valid")
}

/// Removes a job when the export ends, however it ends.
struct JobGuard(String);

impl Drop for JobGuard {
    fn drop(&mut self) {
        jobs().lock().unwrap().remove(&self.0);
    }
}

pub async fn render<R: Runtime>(
    app: &AppHandle<R>,
    html: Vec<u8>,
    page: PageSetup,
    output: PathBuf,
) -> Result<(), String> {
    static NEXT_JOB: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let job_id = format!("job{}", NEXT_JOB.fetch_add(1, std::sync::atomic::Ordering::Relaxed));

    let (ready_sender, ready) = oneshot::channel();
    jobs().lock().unwrap().insert(
        job_id.clone(),
        Job {
            html,
            ready: Some(ready_sender),
        },
    );
    let _guard = JobGuard(job_id.clone());

    let label = format!("export-{job_id}");
    let window = tauri::WebviewWindowBuilder::new(app, &label, WebviewUrl::CustomProtocol(page_url(&job_id)))
        .title("Netherstone export")
        .visible(false)
        .focused(false)
        .skip_taskbar(true)
        .inner_size(900.0, 1200.0)
        .build()
        .map_err(|error| format!("Could not prepare the PDF: {error}"))?;

    let result = async {
        tokio::time::timeout(READY_TIMEOUT, ready)
            .await
            .map_err(|_| "The PDF took too long to prepare.".to_string())?
            .map_err(|_| "The PDF could not be prepared.".to_string())?;

        let webview = window
            .get_webview(&label)
            .ok_or("The PDF window closed before printing.")?;
        let (done_sender, done) = oneshot::channel();
        pdf_platform::print_to_pdf(&webview, &output, page, done_sender)?;

        tokio::time::timeout(PRINT_TIMEOUT, done)
            .await
            .map_err(|_| "Printing the PDF took too long.".to_string())?
            .map_err(|_| "The PDF could not be printed.".to_string())?
    }
    .await;

    let _ = window.destroy();
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_urls_use_the_platform_form() {
        let url = page_url("job7");
        if cfg!(windows) {
            assert_eq!(url.as_str(), "http://nsexport.localhost/job7/page.html");
        } else {
            assert_eq!(url.as_str(), "nsexport://localhost/job7/page.html");
        }
    }

    #[test]
    fn page_setup_reads_from_the_front_end() {
        let setup: PageSetup = serde_json::from_str(
            r#"{"widthMm":210,"heightMm":297,"marginTopMm":20,"marginRightMm":22,"marginBottomMm":24,"marginLeftMm":22}"#,
        )
        .unwrap();
        assert_eq!(setup.width_mm, 210.0);
        assert_eq!(setup.margin_bottom_mm, 24.0);
    }
}
