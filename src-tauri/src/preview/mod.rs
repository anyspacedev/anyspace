pub mod commands;
pub mod detector;
pub mod watcher;

use dashmap::DashMap;
use notify_debouncer_mini::{notify::RecommendedWatcher, Debouncer};
use std::sync::Arc;

pub struct PreviewManager {
    pub watchers: Arc<DashMap<String, Debouncer<RecommendedWatcher>>>,
}

impl PreviewManager {
    pub fn new() -> Self {
        Self { watchers: Arc::new(DashMap::new()) }
    }
}

impl Default for PreviewManager {
    fn default() -> Self { Self::new() }
}
