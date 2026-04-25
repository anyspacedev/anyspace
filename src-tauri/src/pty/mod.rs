pub mod commands;
pub mod session;

use dashmap::DashMap;
use std::sync::Arc;

pub use session::{PtySession, SessionId};

pub struct PtyManager {
    pub sessions: Arc<DashMap<SessionId, PtySession>>,
}

impl PtyManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
        }
    }
}

impl Default for PtyManager {
    fn default() -> Self {
        Self::new()
    }
}
