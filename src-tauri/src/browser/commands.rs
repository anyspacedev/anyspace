use super::BrowserManager;
use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, State, Url, WebviewUrl};

const WEBVIEW_LABEL_PREFIX: &str = "browser-";
const DATA_DIR_PREFIX: &str = "browser-panes";

fn label_for(pane_id: &str) -> String {
    format!("{}{}", WEBVIEW_LABEL_PREFIX, pane_id)
}

fn data_dir_for(app: &AppHandle, pane_id: &str) -> Result<std::path::PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    Ok(base.join(DATA_DIR_PREFIX).join(pane_id))
}

fn parse_url(url: &str) -> Result<Url, String> {
    Url::parse(url).map_err(|e| format!("invalid url: {e}"))
}

/// Compute the screen-absolute logical (CSS-pixel) position for a host
/// rect described in main-window-local viewport coordinates. Adds the
/// main window's inner-position (top-left of the content area on the OS
/// screen) so the popup window lands directly over the host div.
fn screen_pos(app: &AppHandle, vp_x: f64, vp_y: f64) -> Result<LogicalPosition<f64>, String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let scale = main.scale_factor().map_err(|e| e.to_string())?;
    let inner = main
        .inner_position()
        .map_err(|e| format!("inner_position: {e}"))?;
    let logical = inner.to_logical::<f64>(scale);
    Ok(LogicalPosition::new(logical.x + vp_x, logical.y + vp_y))
}

#[tauri::command]
pub async fn browser_create(
    app: AppHandle,
    pane_id: String,
    url: String,
    manager: State<'_, BrowserManager>,
) -> Result<(), String> {
    let label = label_for(&pane_id);
    if manager.webviews.contains_key(&pane_id) {
        return Ok(()); // idempotent — create-once is the contract
    }
    // React StrictMode (and any rapid mount/unmount/mount cycle) can fire
    // browser_create after browser_destroy has dropped our DashMap entry
    // but before Tauri's webview registry has finalized the close. Reuse
    // the still-live window if so.
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.hide();
        manager.webviews.insert(pane_id, existing);
        return Ok(());
    }
    let parsed = parse_url(&url)?;
    let data_dir = data_dir_for(&app, &pane_id)?;
    if let Err(e) = std::fs::create_dir_all(&data_dir) {
        return Err(format!("create data dir: {e}"));
    }
    // Build a standalone popup. Skip transient_for / parent on Linux —
    // they map to set_transient_for() which on some WMs can make the
    // window invisible until the parent regains focus. We rely on
    // skip_taskbar + a low-z visible mapping; if the user wants the
    // popup hidden when the main window minimizes, that's a follow-up.
    let builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::External(parsed))
        .decorations(false)
        .skip_taskbar(true)
        .resizable(true)
        .inner_size(1024.0, 768.0)
        .visible(true)
        .data_directory(data_dir);
    let popup = builder.build().map_err(|e| e.to_string())?;
    let _ = popup.hide();
    manager.webviews.insert(pane_id, popup);
    Ok(())
}

#[tauri::command]
pub async fn browser_navigate(
    pane_id: String,
    url: String,
    manager: State<'_, BrowserManager>,
) -> Result<(), String> {
    let parsed = parse_url(&url)?;
    let view = manager
        .webviews
        .get(&pane_id)
        .ok_or_else(|| format!("no browser window {pane_id}"))?;
    view.navigate(parsed).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_back(
    pane_id: String,
    manager: State<'_, BrowserManager>,
) -> Result<(), String> {
    let view = manager
        .webviews
        .get(&pane_id)
        .ok_or_else(|| format!("no browser window {pane_id}"))?;
    view.eval("history.back()").map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_forward(
    pane_id: String,
    manager: State<'_, BrowserManager>,
) -> Result<(), String> {
    let view = manager
        .webviews
        .get(&pane_id)
        .ok_or_else(|| format!("no browser window {pane_id}"))?;
    view.eval("history.forward()").map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_reload(
    pane_id: String,
    manager: State<'_, BrowserManager>,
) -> Result<(), String> {
    let view = manager
        .webviews
        .get(&pane_id)
        .ok_or_else(|| format!("no browser window {pane_id}"))?;
    view.eval("location.reload()").map_err(|e| e.to_string())
}

/// Reposition + resize the popup to lie over the pane host div. Inputs
/// are in main-window-local viewport CSS pixels; Rust adds the main
/// window's inner-position to compute screen coords.
#[tauri::command]
pub async fn browser_resize(
    app: AppHandle,
    pane_id: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    manager: State<'_, BrowserManager>,
) -> Result<(), String> {
    let view = manager
        .webviews
        .get(&pane_id)
        .ok_or_else(|| format!("no browser window {pane_id}"))?;
    let pos = screen_pos(&app, x, y)?;
    let width = w.max(1.0);
    let height = h.max(1.0);
    view.set_size(LogicalSize::new(width, height))
        .map_err(|e| e.to_string())?;
    view.set_position(pos).map_err(|e| e.to_string())?;
    view.show().map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn browser_show(
    pane_id: String,
    manager: State<'_, BrowserManager>,
) -> Result<(), String> {
    let view = manager
        .webviews
        .get(&pane_id)
        .ok_or_else(|| format!("no browser window {pane_id}"))?;
    view.show().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn browser_hide(
    pane_id: String,
    manager: State<'_, BrowserManager>,
) -> Result<(), String> {
    let view = manager
        .webviews
        .get(&pane_id)
        .ok_or_else(|| format!("no browser window {pane_id}"))?;
    view.hide().map_err(|e| e.to_string())
}

/// Close the popup and best-effort wipe its on-disk profile (cookies,
/// localStorage, IndexedDB).
#[tauri::command]
pub async fn browser_destroy(
    app: AppHandle,
    pane_id: String,
    manager: State<'_, BrowserManager>,
) -> Result<(), String> {
    if let Some((_, view)) = manager.webviews.remove(&pane_id) {
        let _ = view.close();
    }
    if let Ok(dir) = data_dir_for(&app, &pane_id) {
        let _ = std::fs::remove_dir_all(dir);
    }
    Ok(())
}
