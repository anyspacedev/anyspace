use serde_json::Value;
use std::path::PathBuf;
use tauri::Manager;

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("settings.json"))
}

fn load(app: &tauri::AppHandle) -> Result<Value, String> {
    let path = settings_path(app)?;
    if !path.exists() {
        return Ok(Value::Object(Default::default()));
    }
    let text = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| e.to_string())
}

fn save(app: &tauri::AppHandle, value: &Value) -> Result<(), String> {
    let path = settings_path(app)?;
    let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(&path, text).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn settings_get(app: tauri::AppHandle, key: String) -> Result<Option<Value>, String> {
    let v = load(&app)?;
    Ok(v.get(&key).cloned())
}

#[tauri::command]
pub fn settings_set(app: tauri::AppHandle, key: String, value: Value) -> Result<(), String> {
    let mut v = load(&app)?;
    if let Value::Object(map) = &mut v {
        map.insert(key, value);
    } else {
        let mut map = serde_json::Map::new();
        map.insert(key, value);
        v = Value::Object(map);
    }
    save(&app, &v)
}
