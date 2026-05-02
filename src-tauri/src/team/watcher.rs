use notify_debouncer_mini::notify::RecommendedWatcher;
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, Debouncer};
use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessagesChanged {
    pub team_id: String,
    pub messages_path: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcRequestEvent {
    pub team_id: String,
    pub request_id: String,
    pub req_path: String,
    pub payload: String,
}

/// Watch MESSAGES.md and emit `team:messages:<teamId>` whenever it changes.
/// The frontend re-reads the whole file (cheap; markdown) and updates its UI.
pub fn start_messages_watcher(
    team_id: String,
    messages_path: PathBuf,
    app: AppHandle,
) -> Result<Debouncer<RecommendedWatcher>, String> {
    let team_id_clone = team_id.clone();
    let messages_str = messages_path.to_string_lossy().to_string();
    let mut debouncer = new_debouncer(Duration::from_millis(150), move |res| match res {
        Ok(_events) => {
            let _ = app.emit(
                &format!("team:messages:{team_id_clone}"),
                MessagesChanged {
                    team_id: team_id_clone.clone(),
                    messages_path: messages_str.clone(),
                },
            );
        }
        Err(e) => eprintln!("team messages watch error: {e:?}"),
    })
    .map_err(|e| e.to_string())?;

    // Watch the parent dir non-recursively so the file's creation also fires.
    let parent = messages_path
        .parent()
        .ok_or_else(|| "messages_path has no parent".to_string())?;
    debouncer
        .watcher()
        .watch(parent, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    Ok(debouncer)
}

/// Watch .rpc/ for new `<uuid>.req` files. Emit `team:rpc:<teamId>` per
/// request so the frontend can dispatch the action and call team_rpc_reply
/// to write the corresponding `<uuid>.res`.
pub fn start_rpc_watcher(
    team_id: String,
    rpc_dir: PathBuf,
    app: AppHandle,
) -> Result<Debouncer<RecommendedWatcher>, String> {
    std::fs::create_dir_all(&rpc_dir).map_err(|e| e.to_string())?;
    let team_id_clone = team_id.clone();
    let mut debouncer = new_debouncer(Duration::from_millis(50), move |res| match res {
        Ok(events) => {
            let events: Vec<notify_debouncer_mini::DebouncedEvent> = events;
            for ev in events {
                let path = ev.path;
                if path.extension().and_then(|s| s.to_str()) != Some("req") {
                    continue;
                }
                let req_id = match path.file_stem().and_then(|s| s.to_str()) {
                    Some(s) => s.to_string(),
                    None => continue,
                };
                let payload = match std::fs::read_to_string(&path) {
                    Ok(s) => s,
                    Err(_) => continue,
                };
                let _ = app.emit(
                    &format!("team:rpc:{team_id_clone}"),
                    RpcRequestEvent {
                        team_id: team_id_clone.clone(),
                        request_id: req_id,
                        req_path: path.to_string_lossy().to_string(),
                        payload,
                    },
                );
            }
        }
        Err(e) => eprintln!("team rpc watch error: {e:?}"),
    })
    .map_err(|e| e.to_string())?;

    debouncer
        .watcher()
        .watch(&rpc_dir, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    Ok(debouncer)
}
