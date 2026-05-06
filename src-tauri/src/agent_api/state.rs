use dashmap::DashMap;
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::oneshot;

pub type BridgeMap = Arc<DashMap<String, oneshot::Sender<Value>>>;

#[derive(Clone)]
pub struct AgentApiState {
    pub port: u16,
    pub token: String,
    pub bridge: BridgeMap,
    /// Filesystem path of the bundled `teamship-mcp` Rust binary (a sibling of
    /// the main app executable). Surfaced to the frontend so Settings can
    /// offer a copy-to-clipboard `claude mcp add teamship -- "<path>"`
    /// command. `None` if the binary wasn't found at boot (typical for
    /// release bundles until externalBin wiring lands).
    pub mcp_binary_path: Option<String>,
}

impl AgentApiState {
    pub fn new(port: u16, token: String, mcp_binary_path: Option<String>) -> Self {
        Self {
            port,
            token,
            bridge: Arc::new(DashMap::new()),
            mcp_binary_path,
        }
    }
}
