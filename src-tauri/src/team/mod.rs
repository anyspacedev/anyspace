pub mod commands;
pub mod watcher;

use dashmap::DashMap;
use notify_debouncer_mini::{notify::RecommendedWatcher, Debouncer};
use std::sync::Arc;

/// Per-team set of watchers. We keep two debouncers per active team — one
/// for MESSAGES.md (chat panel refresh) and one for the .rpc/ dir
/// (frontend pane-control bridge). Stored as a Vec so they all drop
/// together when the team is closed.
pub struct TeamManager {
    pub watchers: Arc<DashMap<String, Vec<Debouncer<RecommendedWatcher>>>>,
}

impl TeamManager {
    pub fn new() -> Self {
        Self {
            watchers: Arc::new(DashMap::new()),
        }
    }
}

impl Default for TeamManager {
    fn default() -> Self {
        Self::new()
    }
}

/// tmsg shell helper, sourced by the OSC 133 integration when
/// $TEAMSHIP_TEAM_TMSG points at a copy of this script on disk.
pub const TMSG_SCRIPT: &str = include_str!("tmsg.sh");

/// Sentinel directory under each team's project_path.
pub const TEAM_DIR_PREFIX: &str = ".teamship/teams";
