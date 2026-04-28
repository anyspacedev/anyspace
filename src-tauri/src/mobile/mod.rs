pub mod commands;
mod adb;
mod control;
mod ios_logs;
mod ios_simulator;
mod logs;
mod scrcpy;
mod session;
mod simctl;

use dashmap::DashMap;
use std::sync::Arc;

pub use session::MobileSession;

// Live mobile streaming sessions, keyed by `connectionId` (a UUID minted in
// `mobile_connect`). Sessions are removed only when `mobile_disconnect` runs
// — closing the frontend Channel just stops the byte pump, leaving the
// underlying scrcpy server up so the user can reconnect without reinstalling
// the JAR (cheap on-screen "reconnect" flow comes in a later commit).
//
// `connect_locks` is a per-paneId tokio mutex held for the duration of
// `mobile_connect`. React StrictMode + the cleanup's fire-and-forget
// disconnect can fire two parallel connects for the same pane; without
// serialisation the dedup-by-paneId logic checks the manager *before*
// either has inserted, so both helpers spawn. The mutex ensures the
// second connect waits, sees the first session, and disconnects it
// cleanly before spawning its own.
pub struct MobileManager {
    pub sessions: Arc<DashMap<String, Arc<MobileSession>>>,
    pub connect_locks: Arc<DashMap<String, Arc<tokio::sync::Mutex<()>>>>,
}

impl MobileManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(DashMap::new()),
            connect_locks: Arc::new(DashMap::new()),
        }
    }
}

impl Default for MobileManager {
    fn default() -> Self {
        Self::new()
    }
}
