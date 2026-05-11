pub mod commands;
pub mod watcher;

use dashmap::DashMap;
use notify_debouncer_mini::{notify::RecommendedWatcher, Debouncer};
use std::sync::Arc;

/// Per-project knowledge watcher. One debouncer per active project_path
/// (the file watcher on `.anyspace/knowledge/`). Stored on the same shape
/// as TeamManager so the registration + lookup story is uniform.
pub struct KnowledgeManager {
    pub watchers: Arc<DashMap<String, Debouncer<RecommendedWatcher>>>,
}

impl KnowledgeManager {
    pub fn new() -> Self {
        Self {
            watchers: Arc::new(DashMap::new()),
        }
    }
}

impl Default for KnowledgeManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Sentinel directory under each project's working tree.
pub const KNOWLEDGE_DIR_PREFIX: &str = ".anyspace/knowledge";

/// Stable short hash of the project path for use in event names.
/// We can't put `/` in a Tauri event channel name, so this gives us a
/// deterministic id derivable on both sides.
pub fn project_hash(project_path: &str) -> String {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    let mut h = DefaultHasher::new();
    project_path.hash(&mut h);
    format!("{:016x}", h.finish())
}
