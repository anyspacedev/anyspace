use super::detector::{detect, DetectedPreview};
use super::watcher::start_watcher;
use super::PreviewManager;
use std::path::PathBuf;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn preview_detect(project_path: String) -> Result<Option<DetectedPreview>, String> {
    detect(project_path).await
}

#[tauri::command]
pub fn preview_watch_start(
    pane_id: String,
    project_path: String,
    manager: State<'_, PreviewManager>,
    app: AppHandle,
) -> Result<(), String> {
    if manager.watchers.contains_key(&pane_id) {
        return Ok(());
    }
    let path = PathBuf::from(project_path);
    if !path.exists() {
        return Err(format!("path does not exist: {}", path.display()));
    }
    let debouncer = start_watcher(pane_id.clone(), path, app)?;
    manager.watchers.insert(pane_id, debouncer);
    Ok(())
}

#[tauri::command]
pub fn preview_watch_stop(
    pane_id: String,
    manager: State<'_, PreviewManager>,
) -> Result<(), String> {
    manager.watchers.remove(&pane_id);
    Ok(())
}
