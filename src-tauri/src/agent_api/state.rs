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
}

impl AgentApiState {
    pub fn new(port: u16, token: String) -> Self {
        Self {
            port,
            token,
            bridge: Arc::new(DashMap::new()),
        }
    }
}
