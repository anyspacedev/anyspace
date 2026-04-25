use serde_json::Value;
use std::path::PathBuf;
use tauri::Manager;

fn workspace_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let dir = dir.join("workspaces");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

#[tauri::command]
pub fn workspace_save(app: tauri::AppHandle, id: String, layout: Value) -> Result<(), String> {
    let path = workspace_dir(&app)?.join(format!("{id}.json"));
    let text = serde_json::to_string_pretty(&layout).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn workspace_load(app: tauri::AppHandle, id: String) -> Result<Option<Value>, String> {
    let path = workspace_dir(&app)?.join(format!("{id}.json"));
    if !path.exists() { return Ok(None); }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    Ok(Some(v))
}
