pub mod commands;
pub mod stream;

use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::oneshot;

/// Tracks in-flight streaming requests so the frontend can cancel mid-stream.
pub struct AiStreamManager {
    pub aborts: Arc<DashMap<String, oneshot::Sender<()>>>,
}

impl AiStreamManager {
    pub fn new() -> Self {
        Self { aborts: Arc::new(DashMap::new()) }
    }
}

impl Default for AiStreamManager {
    fn default() -> Self { Self::new() }
}
