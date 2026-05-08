use super::session::{PtySession, SessionId};
use super::PtyManager;
use crate::agent_api::AgentApiState;
use serde::Deserialize;
use std::collections::HashMap;
use tauri::{ipc::Channel, AppHandle, Manager, State};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnArgs {
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub cols: u16,
    pub rows: u16,
    /// Frontend-supplied pane id; surfaced to children as `ANYSPACE_PANE_ID`
    /// so the bundled MCP server can identify its caller.
    pub pane_id: Option<String>,
    pub tab_id: Option<String>,
}

#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    args: SpawnArgs,
    on_data: Channel<Vec<u8>>,
    manager: State<'_, PtyManager>,
) -> Result<SessionId, String> {
    let id = Uuid::new_v4().to_string();

    // Default-inject the loopback API env so any MCP-aware tool (Claude Code,
    // Codex, …) launched from any terminal pane can reach the Code-Agent
    // Preview API. Caller-supplied env still wins — agentLauncher /
    // teamLauncher's per-pane stamping continues to override these.
    let mut env = args.env;
    if let Some(api) = app.try_state::<AgentApiState>() {
        env.entry("ANYSPACE_API_URL".into())
            .or_insert_with(|| format!("http://127.0.0.1:{}", api.port));
        env.entry("ANYSPACE_API_TOKEN".into())
            .or_insert_with(|| api.token.clone());
    }
    if let Some(pane_id) = args.pane_id {
        env.entry("ANYSPACE_PANE_ID".into()).or_insert(pane_id);
    }
    if let Some(tab_id) = args.tab_id {
        env.entry("ANYSPACE_TAB_ID".into()).or_insert(tab_id);
    }

    let session = PtySession::spawn(app, &id, args.cwd, env, args.cols, args.rows, on_data)
        .map_err(|e| format!("{e:#}"))?;
    manager.sessions.insert(id.clone(), session);
    Ok(id)
}

#[tauri::command]
pub fn pty_write(
    session_id: SessionId,
    data: Vec<u8>,
    manager: State<'_, PtyManager>,
) -> Result<(), String> {
    let session = manager
        .sessions
        .get(&session_id)
        .ok_or_else(|| format!("no pty session {session_id}"))?;
    session.write(&data).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn pty_resize(
    session_id: SessionId,
    cols: u16,
    rows: u16,
    manager: State<'_, PtyManager>,
) -> Result<(), String> {
    let session = manager
        .sessions
        .get(&session_id)
        .ok_or_else(|| format!("no pty session {session_id}"))?;
    session.resize(cols, rows).map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub fn pty_kill(session_id: SessionId, manager: State<'_, PtyManager>) -> Result<(), String> {
    if let Some((_, session)) = manager.sessions.remove(&session_id) {
        session.kill();
    }
    Ok(())
}
