use super::session::{PtySession, SessionId};
use super::PtyManager;
use serde::Deserialize;
use std::collections::HashMap;
use tauri::{ipc::Channel, AppHandle, State};
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SpawnArgs {
    pub cwd: Option<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub cols: u16,
    pub rows: u16,
}

#[tauri::command]
pub async fn pty_spawn(
    app: AppHandle,
    args: SpawnArgs,
    on_data: Channel<Vec<u8>>,
    manager: State<'_, PtyManager>,
) -> Result<SessionId, String> {
    let id = Uuid::new_v4().to_string();
    let session = PtySession::spawn(app, &id, args.cwd, args.env, args.cols, args.rows, on_data)
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
