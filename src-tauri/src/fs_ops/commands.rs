use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

const HIDE: &[&str] = &["node_modules", ".git", "target", ".next", "dist", ".turbo"];

#[tauri::command]
pub fn fs_list_dir_recursive(path: String, max_depth: usize) -> Result<Vec<FileEntry>, String> {
    let root = PathBuf::from(&path);
    if !root.is_dir() {
        return Err(format!("not a directory: {path}"));
    }
    let mut out = Vec::new();
    walk(&root, &root, 0, max_depth, &mut out);
    Ok(out)
}

fn walk(
    root: &std::path::Path,
    dir: &std::path::Path,
    depth: usize,
    max_depth: usize,
    out: &mut Vec<FileEntry>,
) {
    if depth > max_depth { return; }
    let Ok(entries) = std::fs::read_dir(dir) else { return; };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') && depth > 0 { continue; }
        if HIDE.iter().any(|h| name == *h) { continue; }
        let path = entry.path();
        let is_dir = path.is_dir();
        let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
        let rel = path.strip_prefix(root).unwrap_or(&path);
        out.push(FileEntry {
            name,
            path: path.to_string_lossy().to_string(),
            is_dir,
            size,
        });
        if is_dir && depth < max_depth {
            // Don't blow up on huge trees.
            if out.len() > 5000 { return; }
            walk(root, &path, depth + 1, max_depth, out);
        }
        let _ = rel;
    }
}
