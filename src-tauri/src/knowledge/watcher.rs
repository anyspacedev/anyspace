use notify_debouncer_mini::notify::RecommendedWatcher;
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, Debouncer};
use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use super::project_hash;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeChanged {
    pub project_path: String,
    pub project_hash: String,
}

/// Watch `<projectPath>/.anyspace/knowledge/` and emit
/// `knowledge:changed:<hash>` whenever any file in it changes. Frontend
/// re-reads the directory listing + graph (both cheap) and updates its UI.
pub fn start_knowledge_watcher(
    project_path: String,
    knowledge_dir: PathBuf,
    app: AppHandle,
) -> Result<Debouncer<RecommendedWatcher>, String> {
    std::fs::create_dir_all(&knowledge_dir).map_err(|e| e.to_string())?;
    let hash = project_hash(&project_path);
    let project_path_clone = project_path.clone();
    let hash_clone = hash.clone();
    let mut debouncer = new_debouncer(Duration::from_millis(150), move |res| match res {
        Ok(_events) => {
            let _ = app.emit(
                &format!("knowledge:changed:{hash_clone}"),
                KnowledgeChanged {
                    project_path: project_path_clone.clone(),
                    project_hash: hash_clone.clone(),
                },
            );
        }
        Err(e) => eprintln!("knowledge watch error: {e:?}"),
    })
    .map_err(|e| e.to_string())?;

    debouncer
        .watcher()
        .watch(&knowledge_dir, RecursiveMode::NonRecursive)
        .map_err(|e| e.to_string())?;

    Ok(debouncer)
}
