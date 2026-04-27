use std::fs;

fn sanitize_ext(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(8)
        .collect();
    if cleaned.is_empty() {
        "bin".to_string()
    } else {
        cleaned.to_ascii_lowercase()
    }
}

#[tauri::command]
pub fn clipboard_save_blob(bytes: Vec<u8>, ext: String) -> Result<String, String> {
    let dir = std::env::temp_dir().join("teamship-clipboard");
    fs::create_dir_all(&dir).map_err(|e| format!("create clipboard dir: {e}"))?;
    let path = dir.join(format!(
        "paste-{}.{}",
        uuid::Uuid::new_v4(),
        sanitize_ext(&ext)
    ));
    fs::write(&path, &bytes).map_err(|e| format!("write clipboard blob: {e}"))?;
    Ok(path.to_string_lossy().to_string())
}
