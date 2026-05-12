pub mod commands;
pub mod local;
pub mod models;

#[cfg(target_os = "macos")]
pub mod hotkey_monitor;

#[cfg(target_os = "linux")]
pub mod hotkey_monitor_linux;

use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::oneshot;

/// Tracks in-flight model downloads so the frontend can cancel mid-stream.
/// Keyed by model id (`tiny`, `base`, …) — only one download per model at a
/// time is allowed; starting a second one drops the previous sender, which
/// aborts the prior download.
pub struct ModelDownloadManager {
    pub aborts: Arc<DashMap<String, oneshot::Sender<()>>>,
}

impl ModelDownloadManager {
    pub fn new() -> Self {
        Self {
            aborts: Arc::new(DashMap::new()),
        }
    }
}

impl Default for ModelDownloadManager {
    fn default() -> Self {
        Self::new()
    }
}
