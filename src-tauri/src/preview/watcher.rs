use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, Debouncer};
use notify_debouncer_mini::notify::RecommendedWatcher;
use std::path::PathBuf;
use std::time::Duration;
use tauri::Emitter;

const IGNORE: &[&str] = &["node_modules", ".git", "dist", ".next", "target", ".turbo", ".svelte-kit", ".astro"];

pub fn start_watcher(
    pane_id: String,
    project_path: PathBuf,
    app: tauri::AppHandle,
) -> Result<Debouncer<RecommendedWatcher>, String> {
    let pane_id_clone = pane_id.clone();
    let mut debouncer = new_debouncer(Duration::from_millis(150), move |res| {
        match res {
            Ok(events) => {
                let events: Vec<notify_debouncer_mini::DebouncedEvent> = events;
                let interesting = events.iter().any(|e| {
                    let path = &e.path;
                    let s = path.to_string_lossy();
                    !IGNORE.iter().any(|ig| s.contains(ig))
                });
                if interesting {
                    let _ = app.emit(&format!("preview:reload:{pane_id_clone}"), ());
                }
            }
            Err(e) => eprintln!("watch error: {e:?}"),
        }
    })
    .map_err(|e| e.to_string())?;

    debouncer
        .watcher()
        .watch(&project_path, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    Ok(debouncer)
}
