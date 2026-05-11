pub mod commands;

use dashmap::DashMap;
use std::sync::Arc;
use tauri::WebviewWindow;

/// Holds the live browser-pane window handles keyed by frontend `paneId`.
///
/// Implementation note: on Linux, Tauri's `Window::add_child` adds the new
/// webview to a `GtkBox` container, in which wry's `set_bounds()` is a
/// no-op — the child webview ends up stacked with the main webview in
/// vertical-box layout instead of positioned over the pane host. We work
/// around this by allocating a separate, decoration-less, transient
/// `WebviewWindow` per pane and positioning it in screen coords above
/// the host div. The trade-off is one OS-level window per browser pane
/// (taskbar-skipped, parented to main) instead of a true in-window
/// composited child. macOS / Windows could in principle use
/// `Window::add_child` instead, but for cross-platform consistency we
/// keep the same path everywhere — the WebviewWindow is parented and
/// transient so it visually integrates.
pub struct BrowserManager {
    pub webviews: Arc<DashMap<String, WebviewWindow>>,
}

impl BrowserManager {
    pub fn new() -> Self {
        Self { webviews: Arc::new(DashMap::new()) }
    }
}

impl Default for BrowserManager {
    fn default() -> Self {
        Self::new()
    }
}
