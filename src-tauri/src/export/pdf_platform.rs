//! The one step of PDF export that differs by OS: asking the platform webview
//! to print the loaded page to a file. Each takes the same paper and margins
//! and reports through `done` once the file is written.

use std::path::{Path, PathBuf};

use tauri::{Runtime, Webview};
use tokio::sync::oneshot;

use super::pdf::PageSetup;

pub type Done = oneshot::Sender<Result<(), String>>;

pub fn print_to_pdf<R: Runtime>(
    webview: &Webview<R>,
    output: &Path,
    page: PageSetup,
    done: Done,
) -> Result<(), String> {
    let output: PathBuf = output.to_path_buf();
    webview
        .with_webview(move |platform_webview| platform::print(platform_webview, output, page, done))
        .map_err(|error| format!("Could not reach the PDF window: {error}"))
}

#[cfg(windows)]
mod platform {
    use std::path::PathBuf;

    use tauri::webview::PlatformWebview;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT, ICoreWebView2_7, ICoreWebView2Environment6,
    };
    use webview2_com::PrintToPdfCompletedHandler;
    use windows_core::{HSTRING, Interface};

    use super::super::pdf::PageSetup;
    use super::Done;

    pub fn print(platform_webview: PlatformWebview, output: PathBuf, page: PageSetup, done: Done) {
        let inches = |millimetres: f64| millimetres / 25.4;

        let started = unsafe {
            (|| -> windows_core::Result<(ICoreWebView2_7, _)> {
                let webview: ICoreWebView2_7 = platform_webview.controller().CoreWebView2()?.cast()?;
                let environment: ICoreWebView2Environment6 = platform_webview.environment().cast()?;
                let settings = environment.CreatePrintSettings()?;
                settings.SetOrientation(COREWEBVIEW2_PRINT_ORIENTATION_PORTRAIT)?;
                settings.SetPageWidth(inches(page.width_mm))?;
                settings.SetPageHeight(inches(page.height_mm))?;
                settings.SetMarginTop(inches(page.margin_top_mm))?;
                settings.SetMarginRight(inches(page.margin_right_mm))?;
                settings.SetMarginBottom(inches(page.margin_bottom_mm))?;
                settings.SetMarginLeft(inches(page.margin_left_mm))?;
                settings.SetScaleFactor(1.0)?;
                settings.SetShouldPrintBackgrounds(true)?;
                settings.SetShouldPrintHeaderAndFooter(false)?;
                Ok((webview, settings))
            })()
        };

        let (webview, settings) = match started {
            Ok(parts) => parts,
            Err(error) => {
                let _ = done.send(Err(format!("This version of Windows can't save PDFs from the app: {error}")));
                return;
            }
        };

        // The handler runs once; the sender travels with it.
        let done = std::sync::Mutex::new(Some(done));
        let finish = move |outcome: Result<(), String>| {
            if let Some(done) = done.lock().unwrap().take() {
                let _ = done.send(outcome);
            }
        };
        let finish = std::sync::Arc::new(finish);
        let on_complete = finish.clone();

        let handler = PrintToPdfCompletedHandler::create(Box::new(move |result, succeeded| {
            on_complete(match result {
                Ok(()) if succeeded => Ok(()),
                Ok(()) => Err("The PDF could not be written.".to_string()),
                Err(error) => Err(format!("The PDF could not be written: {error}")),
            });
            Ok(())
        }));

        let path = HSTRING::from(output.as_os_str());
        if let Err(error) = unsafe { webview.PrintToPdf(&path, &settings, &handler) } {
            finish(Err(format!("The PDF could not be written: {error}")));
        }
    }
}

#[cfg(target_os = "macos")]
mod platform {
    use std::cell::RefCell;
    use std::ffi::c_void;
    use std::path::PathBuf;
    use std::sync::Mutex;

    use objc2::rc::Retained;
    use objc2::runtime::{Bool, NSObject, ProtocolObject};
    use objc2::{DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send, sel};
    use objc2_app_kit::{
        NSPrintInfo, NSPrintJobSavingURL, NSPrintOperation, NSPrintSaveJob, NSPrintingPaginationMode, NSWindow,
    };
    use objc2_foundation::{NSSize, NSString, NSURL};
    use objc2_web_kit::WKWebView;
    use tauri::webview::PlatformWebview;

    use super::super::pdf::PageSetup;
    use super::Done;

    const POINTS_PER_MM: f64 = 72.0 / 25.4;

    define_class!(
        // WebKit prints out of process, so the operation reports back here
        // instead of blocking the main thread.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "NetherstonePdfPrintDelegate"]
        #[ivars = Mutex<Option<Done>>]
        struct PrintDelegate;

        impl PrintDelegate {
            #[unsafe(method(printOperationDidRun:success:contextInfo:))]
            fn print_operation_did_run(&self, _operation: &NSPrintOperation, success: Bool, _context: *mut c_void) {
                if let Some(done) = self.ivars().lock().unwrap().take() {
                    let _ = done.send(if success.as_bool() {
                        Ok(())
                    } else {
                        Err("The PDF could not be written.".to_string())
                    });
                }
            }
        }
    );

    impl PrintDelegate {
        fn new(done: Done, mtm: MainThreadMarker) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(Mutex::new(Some(done)));
            unsafe { msg_send![super(this), init] }
        }
    }

    thread_local! {
        // The operation doesn't keep its delegate alive; this does, until
        // the next export replaces it.
        static DELEGATE: RefCell<Option<Retained<PrintDelegate>>> = const { RefCell::new(None) };
    }

    pub fn print(platform_webview: PlatformWebview, output: PathBuf, page: PageSetup, done: Done) {
        let Some(mtm) = MainThreadMarker::new() else {
            let _ = done.send(Err("The PDF must be printed on the main thread.".to_string()));
            return;
        };

        unsafe {
            let view = &*platform_webview.inner().cast::<WKWebView>();
            let window = &*platform_webview.ns_window().cast::<NSWindow>();

            let info = NSPrintInfo::new();
            info.setPaperSize(NSSize::new(page.width_mm * POINTS_PER_MM, page.height_mm * POINTS_PER_MM));
            info.setTopMargin(page.margin_top_mm * POINTS_PER_MM);
            info.setRightMargin(page.margin_right_mm * POINTS_PER_MM);
            info.setBottomMargin(page.margin_bottom_mm * POINTS_PER_MM);
            info.setLeftMargin(page.margin_left_mm * POINTS_PER_MM);
            info.setHorizontalPagination(NSPrintingPaginationMode::Fit);
            info.setVerticalPagination(NSPrintingPaginationMode::Automatic);
            info.setHorizontallyCentered(false);
            info.setVerticallyCentered(false);
            info.setJobDisposition(NSPrintSaveJob);
            let url = NSURL::fileURLWithPath(&NSString::from_str(&output.to_string_lossy()));
            info.dictionary().setObject_forKey(&url, ProtocolObject::from_ref(NSPrintJobSavingURL));

            let operation = view.printOperationWithPrintInfo(&info);
            operation.setShowsPrintPanel(false);
            operation.setShowsProgressPanel(false);

            let delegate = PrintDelegate::new(done, mtm);
            operation.runOperationModalForWindow_delegate_didRunSelector_contextInfo(
                window,
                Some(&delegate),
                Some(sel!(printOperationDidRun:success:contextInfo:)),
                std::ptr::null_mut(),
            );
            DELEGATE.with(|slot| *slot.borrow_mut() = Some(delegate));
        }
    }
}

#[cfg(any(
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
))]
mod platform {
    use std::cell::RefCell;
    use std::path::PathBuf;
    use std::rc::Rc;

    use gtk::{PageSetup as GtkPageSetup, PaperSize, PrintSettings, Unit};
    use tauri::webview::PlatformWebview;
    use webkit2gtk::{PrintOperation, PrintOperationExt};

    use super::super::pdf::PageSetup;
    use super::Done;

    thread_local! {
        // Kept alive until the next export; WebKit prints asynchronously.
        static OPERATION: RefCell<Option<PrintOperation>> = const { RefCell::new(None) };
    }

    pub fn print(platform_webview: PlatformWebview, output: PathBuf, page: PageSetup, done: Done) {
        let Ok(uri) = tauri::Url::from_file_path(&output) else {
            let _ = done.send(Err("The PDF destination is not a valid path.".to_string()));
            return;
        };

        let paper = PaperSize::new_custom("netherstone", "Netherstone", page.width_mm, page.height_mm, Unit::Mm);
        let setup = GtkPageSetup::new();
        setup.set_paper_size(&paper);
        setup.set_top_margin(page.margin_top_mm, Unit::Mm);
        setup.set_right_margin(page.margin_right_mm, Unit::Mm);
        setup.set_bottom_margin(page.margin_bottom_mm, Unit::Mm);
        setup.set_left_margin(page.margin_left_mm, Unit::Mm);

        let settings = PrintSettings::new();
        settings.set_printer("Print to File");
        settings.set_paper_size(&paper);
        settings.set("output-file-format", Some("pdf"));
        settings.set("output-uri", Some(uri.as_str()));

        let operation = PrintOperation::new(&platform_webview.inner());
        operation.set_print_settings(&settings);
        operation.set_page_setup(&setup);

        let done = Rc::new(RefCell::new(Some(done)));
        let finished = done.clone();
        operation.connect_finished(move |_| {
            if let Some(done) = finished.borrow_mut().take() {
                let _ = done.send(Ok(()));
            }
        });
        operation.connect_failed(move |_, error| {
            if let Some(done) = done.borrow_mut().take() {
                let _ = done.send(Err(format!("The PDF could not be written: {error}")));
            }
        });

        operation.print();
        OPERATION.with(|slot| *slot.borrow_mut() = Some(operation));
    }
}

#[cfg(not(any(
    windows,
    target_os = "macos",
    target_os = "linux",
    target_os = "dragonfly",
    target_os = "freebsd",
    target_os = "netbsd",
    target_os = "openbsd"
)))]
mod platform {
    use std::path::PathBuf;

    use tauri::webview::PlatformWebview;

    use super::super::pdf::PageSetup;
    use super::Done;

    pub fn print(_platform_webview: PlatformWebview, _output: PathBuf, _page: PageSetup, done: Done) {
        let _ = done.send(Err("PDF export isn't available on this system.".to_string()));
    }
}
