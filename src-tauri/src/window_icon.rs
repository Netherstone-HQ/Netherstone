//! Gives Windows the app icon at the size the window's DPI calls for.
//!
//! Tauri sets the window icon from one decoded bitmap, so Windows rescales
//! it for the taskbar and Alt+Tab at every scale other than 100%. Loading the
//! icon from the exe's resource instead lets Windows use the icon.ico entry
//! drawn for that size.

use tauri::Window;

#[cfg(windows)]
pub fn apply(window: &Window) {
    use std::sync::Mutex;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{HINSTANCE, LPARAM, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
    use windows::Win32::UI::WindowsAndMessaging::{
        DestroyIcon, LoadImageW, SendMessageW, HICON, ICON_BIG, ICON_SMALL, IMAGE_ICON,
        LR_DEFAULTCOLOR, SM_CXICON, SM_CXSMICON, WM_SETICON,
    };

    // tauri-build embeds icon.ico under the IDI_APPLICATION resource id.
    const ICON_RESOURCE: u16 = 32512;
    // The icons this module set last, so a DPI change can free them. The
    // icon Tauri set first belongs to Tauri and is left alone.
    static OURS: Mutex<Vec<isize>> = Mutex::new(Vec::new());

    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    unsafe {
        let Ok(module) = GetModuleHandleW(PCWSTR::null()) else {
            return;
        };
        let dpi = GetDpiForWindow(hwnd);
        let mut ours = OURS.lock().unwrap_or_else(|e| e.into_inner());
        for (kind, metric) in [(ICON_BIG, SM_CXICON), (ICON_SMALL, SM_CXSMICON)] {
            let size = GetSystemMetricsForDpi(metric, dpi);
            let Ok(icon) = LoadImageW(
                Some(HINSTANCE(module.0)),
                PCWSTR(ICON_RESOURCE as usize as *const u16),
                IMAGE_ICON,
                size,
                size,
                LR_DEFAULTCOLOR,
            ) else {
                continue;
            };
            let previous = SendMessageW(
                hwnd,
                WM_SETICON,
                Some(WPARAM(kind as usize)),
                Some(LPARAM(icon.0 as isize)),
            );
            if let Some(i) = ours.iter().position(|&h| h == previous.0) {
                ours.swap_remove(i);
                let _ = DestroyIcon(HICON(previous.0 as _));
            }
            ours.push(icon.0 as isize);
        }
    }
}

#[cfg(not(windows))]
pub fn apply(_window: &Window) {}
