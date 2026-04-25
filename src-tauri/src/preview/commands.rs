use super::detector::{detect, DetectedPreview};
use super::watcher::start_watcher;
use super::PreviewManager;
use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn preview_detect(project_path: String) -> Result<Option<DetectedPreview>, String> {
    detect(project_path).await
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameabilityReport {
    pub reachable: bool,
    pub framable: bool,
    /// One of: "ok", "x-frame-options", "csp-frame-ancestors", "unreachable", "non-2xx".
    pub reason: String,
    pub status: Option<u16>,
}

/// Probe a URL to determine whether it is reachable and whether it can be embedded in an iframe.
/// We GET (rather than HEAD) because some dev servers don't implement HEAD and return 404 — and
/// we need the response headers anyway.
#[tauri::command]
pub async fn preview_can_frame(url: String) -> Result<FrameabilityReport, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .redirect(reqwest::redirect::Policy::limited(3))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = match client.get(&url).send().await {
        Ok(r) => r,
        Err(_) => {
            return Ok(FrameabilityReport {
                reachable: false,
                framable: false,
                reason: "unreachable".into(),
                status: None,
            });
        }
    };

    let status = resp.status();
    let headers = resp.headers().clone();

    if !status.is_success() && !status.is_redirection() {
        return Ok(FrameabilityReport {
            reachable: true,
            framable: false,
            reason: "non-2xx".into(),
            status: Some(status.as_u16()),
        });
    }

    if let Some(xfo) = headers.get("x-frame-options").and_then(|v| v.to_str().ok()) {
        let v = xfo.to_ascii_lowercase();
        if v.contains("deny") || v.contains("sameorigin") {
            return Ok(FrameabilityReport {
                reachable: true,
                framable: false,
                reason: "x-frame-options".into(),
                status: Some(status.as_u16()),
            });
        }
    }

    if let Some(csp) = headers.get("content-security-policy").and_then(|v| v.to_str().ok()) {
        let lower = csp.to_ascii_lowercase();
        if let Some(idx) = lower.find("frame-ancestors") {
            let after = &lower[idx + "frame-ancestors".len()..];
            // Read up to next ';' as the directive value.
            let directive: &str = after.split(';').next().unwrap_or("");
            // Framable if directive allows '*', 'http:' / 'https:' wildcards, or our origin.
            // Tauri WebViews load over the `tauri://localhost` (or `http://tauri.localhost`)
            // origin on Windows; conservatively require '*' for permissive.
            let permissive = directive.contains('*');
            if !permissive {
                return Ok(FrameabilityReport {
                    reachable: true,
                    framable: false,
                    reason: "csp-frame-ancestors".into(),
                    status: Some(status.as_u16()),
                });
            }
        }
    }

    Ok(FrameabilityReport {
        reachable: true,
        framable: true,
        reason: "ok".into(),
        status: Some(status.as_u16()),
    })
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
