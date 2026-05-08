use std::fs;
use std::io::Cursor;
use std::path::PathBuf;

use base64::Engine;
use image::{codecs::png::PngEncoder, ImageEncoder, RgbaImage};
use image::imageops;
use serde::Serialize;

// Captured PNGs land in /tmp/anyspace-screenshots so the screenshot stack
// and the clipboard's blob dir stay separate (easier ops debugging, simpler
// per-feature cleanup if we ever add reaping).
fn screenshots_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("anyspace-screenshots");
    fs::create_dir_all(&dir).map_err(|e| format!("create screenshots dir: {e}"))?;
    Ok(dir)
}

fn encode_png(img: &RgbaImage) -> Result<Vec<u8>, String> {
    let mut buf = Vec::with_capacity((img.width() * img.height() * 4) as usize);
    PngEncoder::new(Cursor::new(&mut buf))
        .write_image(img, img.width(), img.height(), image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("png encode: {e}"))?;
    Ok(buf)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotResult {
    pub path: String,
    pub data_url: String,
}

/// Capture a window-local pixel rectangle from THIS process's main window
/// and persist it as PNG. Works even when AnySpace is occluded, behind
/// another app, or on a different desktop/Space — xcap pulls from the
/// window's compositor surface, not the screen.
///
/// The frontend computes the rect by combining
/// `iframe.getBoundingClientRect()` (CSS px) with `scaleFactor()` and the
/// chrome offset (`innerPosition - outerPosition`) so the rect is relative
/// to the OS window's top-left corner — same coordinate system xcap returns
/// from `Window::capture_image()`.
///
/// Replaces the old `screenshot_capture_region` (monitor-based) which was
/// only correct when AnySpace was the foreground app. The agent-driven
/// preview-screenshot path can fire at any time, including while the
/// operator is in another app, so monitor-based capture is no longer safe.
///
/// Returns both the file path (for terminal drop) and a base64 data URL (for
/// the floating thumbnail) so the frontend never has to re-read the file.
#[tauri::command]
pub async fn screenshot_capture_window_region(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<ScreenshotResult, String> {
    if width == 0 || height == 0 {
        return Err("invalid-region".into());
    }

    let pid = std::process::id();
    let mut candidates: Vec<xcap::Window> = xcap::Window::all()
        .map_err(|e| format!("window enumerate: {e}"))?
        .into_iter()
        .filter(|w| w.pid() == pid && !w.is_minimized())
        .collect();
    // Prefer the largest window matching our PID (Tauri's main, not any
    // hidden helper / inspector window the OS may report).
    candidates.sort_by_key(|w| std::cmp::Reverse(w.width() as u64 * w.height() as u64));
    let win = candidates
        .into_iter()
        .next()
        .ok_or_else(|| "no AnySpace window found (minimised or no compositor surface)".to_string())?;

    let full: RgbaImage = win.capture_image().map_err(|e| format!("capture: {e}"))?;

    // Window-local crop. Clamp so a request that bleeds outside the captured
    // surface returns the visible slice rather than erroring.
    let lx = x.max(0) as u32;
    let ly = y.max(0) as u32;
    let max_w = full.width().saturating_sub(lx);
    let max_h = full.height().saturating_sub(ly);
    let cw = width.min(max_w);
    let ch = height.min(max_h);
    if cw == 0 || ch == 0 {
        return Err("region-out-of-bounds".into());
    }
    let img: RgbaImage = imageops::crop_imm(&full, lx, ly, cw, ch).to_image();

    // macOS without Screen Recording permission silently returns a black image
    // rather than erroring. Sample a strided grid; if every sample is opaque
    // black we treat it as a permission denial so the UI can show a one-time
    // toast linking to System Settings.
    if looks_like_black(&img) {
        return Err("permission-denied".into());
    }

    let bytes = encode_png(&img)?;

    let dir = screenshots_dir()?;
    let path = dir.join(format!("preview-{}.png", uuid::Uuid::new_v4()));
    fs::write(&path, &bytes).map_err(|e| format!("write png: {e}"))?;

    let data_url = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&bytes)
    );

    Ok(ScreenshotResult {
        path: path.to_string_lossy().to_string(),
        data_url,
    })
}

/// Save PNG bytes the frontend already produced (mobile canvas via toBlob).
/// We don't reuse `clipboard_save_blob` because we want a stable filename
/// prefix (`mobile-`) and a separate temp directory.
#[tauri::command]
pub fn screenshot_save_png_bytes(bytes: Vec<u8>) -> Result<String, String> {
    let dir = screenshots_dir()?;
    let path = dir.join(format!("mobile-{}.png", uuid::Uuid::new_v4()));
    fs::write(&path, &bytes).map_err(|e| format!("write png: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}

fn looks_like_black(img: &RgbaImage) -> bool {
    let (w, h) = (img.width(), img.height());
    if w == 0 || h == 0 {
        return true;
    }
    let step_x = (w / 16).max(1);
    let step_y = (h / 16).max(1);
    let mut x = 0u32;
    while x < w {
        let mut y = 0u32;
        while y < h {
            let p = img.get_pixel(x, y);
            if p[0] != 0 || p[1] != 0 || p[2] != 0 {
                return false;
            }
            y += step_y;
        }
        x += step_x;
    }
    true
}
