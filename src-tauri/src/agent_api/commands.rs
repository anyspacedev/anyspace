use super::state::AgentApiState;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, State};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApiInfo {
    pub url: String,
    pub token: String,
    pub port: u16,
}

/// Frontend reads this once at boot to inject ANYSPACE_API_URL/TOKEN into
/// every Code-Agent terminal it spawns (solo + team).
#[tauri::command]
pub fn agent_api_info(state: State<'_, AgentApiState>) -> AgentApiInfo {
    AgentApiInfo {
        url: format!("http://127.0.0.1:{}", state.port),
        token: state.token.clone(),
        port: state.port,
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApiReplyArgs {
    pub request_id: String,
    pub response: Value,
}

/// Resolves a pending HTTP request that was emitted as `agent_api:request`.
/// Idempotent: a stale reply (request already timed out) returns Ok with no
/// effect rather than erroring, since the HTTP client is long gone.
#[tauri::command]
pub fn agent_api_reply(
    state: State<'_, AgentApiState>,
    args: AgentApiReplyArgs,
) -> Result<(), String> {
    if let Some((_, tx)) = state.bridge.remove(&args.request_id) {
        let _ = tx.send(args.response);
    }
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RotateResult {
    /// The new token. Persisted to disk; takes effect on next app launch
    /// because the running server still holds the previous value.
    pub token: String,
    pub requires_restart: bool,
}

/// Rotate the persisted bearer token. The current session keeps working with
/// the in-memory token until the app restarts; after restart the new token
/// is loaded by `auth::load_or_mint`.
#[tauri::command]
pub fn agent_api_rotate_token(app: AppHandle) -> Result<RotateResult, String> {
    super::auth::rotate(&app)
        .map(|token| RotateResult {
            token,
            requires_restart: true,
        })
        .map_err(|e| format!("{e:#}"))
}
