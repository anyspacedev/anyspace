use std::fs;
use std::io::Cursor;
use std::path::PathBuf;

use base64::Engine;
use image::{codecs::png::PngEncoder, ImageEncoder, RgbaImage};
use image::imageops;
use serde::Serialize;

// Captured PNGs land in /tmp/teamship-screenshots so the screenshot stack
// and the clipboard's blob dir stay separate (easier ops debugging, simpler
// per-feature cleanup if we ever add reaping).
fn screenshots_dir() -> Result<PathBuf, String> {
    let dir = std::env::temp_dir().join("teamship-screenshots");
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

/// Capture a screen-pixel rectangle and persist it as PNG.
///
/// The frontend computes the rect by combining `iframe.getBoundingClientRect()`
/// (CSS px) with the Tauri window's `outerPosition()` (physical px) and the
/// `scaleFactor()`. We pick the monitor that contains `(x, y)` so multi-monitor
/// setups capture from the correct display.
///
/// Returns both the file path (for terminal drop) and a base64 data URL (for
/// the floating thumbnail) so the frontend never has to re-read the file —
/// which would otherwise need an asset-protocol or fs-binary-read capability.
#[tauri::command]
pub async fn screenshot_capture_region(
    x: i32,
    y: i32,
    width: u32,
    height: u32,
) -> Result<ScreenshotResult, String> {
    if width == 0 || height == 0 {
        return Err("invalid-region".into());
    }

    let monitor = xcap::Monitor::from_point(x, y).map_err(|e| format!("monitor lookup: {e}"))?;

    // xcap 0.3 has no capture_region — grab the full monitor and crop.
    let full: RgbaImage = monitor.capture_image().map_err(|e| format!("capture: {e}"))?;

    // Translate to monitor-local pixels and clamp to the captured frame so a
    // request that bleeds off-screen returns the visible slice rather than
    // erroring.
    let local_x = (x - monitor.x()).max(0) as u32;
    let local_y = (y - monitor.y()).max(0) as u32;
    let max_w = full.width().saturating_sub(local_x);
    let max_h = full.height().saturating_sub(local_y);
    let cw = width.min(max_w);
    let ch = height.min(max_h);
    if cw == 0 || ch == 0 {
        return Err("region-out-of-bounds".into());
    }
    let img: RgbaImage = imageops::crop_imm(&full, local_x, local_y, cw, ch).to_image();

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
