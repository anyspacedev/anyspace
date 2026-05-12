//! Curated Whisper model catalog + downloader for the local STT preset.
//!
//! Model files are stored under `app_data_dir/models/whisper/ggml-<id>.bin`.
//! Downloads stream through `crate::net::http_client` (proxy-aware) into a
//! `.part` sibling, then atomically rename on success — so a half-finished
//! download never poisons the catalog. Progress is reported through a
//! `tauri::ipc::Channel`, matching the pattern PTY already uses.

use futures_util::StreamExt;
use serde::Serialize;
use std::path::PathBuf;
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;
use tokio::sync::oneshot;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDescriptor {
    pub id: &'static str,
    pub label: &'static str,
    pub size_mb: u32,
    pub url: &'static str,
    /// Default-selected entry in the UI. Exactly one in the catalog.
    pub default: bool,
}

/// The four entries the Settings UI exposes. URLs point at the canonical
/// ggml weights on Hugging Face. Adding a model = one entry here.
pub const CURATED_MODELS: &[ModelDescriptor] = &[
    ModelDescriptor {
        id: "tiny",
        label: "Tiny (multilingual)",
        size_mb: 75,
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
        default: false,
    },
    ModelDescriptor {
        id: "base",
        label: "Base (multilingual)",
        size_mb: 142,
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
        default: false,
    },
    ModelDescriptor {
        id: "small",
        label: "Small (multilingual)",
        size_mb: 466,
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
        default: true,
    },
    ModelDescriptor {
        id: "large-v3-turbo-q8",
        label: "Large v3 Turbo (Q8)",
        size_mb: 874,
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q8_0.bin",
        default: false,
    },
];

pub fn find(id: &str) -> Option<&'static ModelDescriptor> {
    CURATED_MODELS.iter().find(|m| m.id == id)
}

pub fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("app_data_dir: {e}"))?;
    Ok(dir.join("models").join("whisper"))
}

pub fn model_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(models_dir(app)?.join(format!("ggml-{id}.bin")))
}

fn ensure_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = models_dir(app)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("create models dir: {e}"))?;
    Ok(dir)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    pub id: &'static str,
    pub label: &'static str,
    pub size_mb: u32,
    pub url: &'static str,
    pub default: bool,
    pub installed: bool,
    pub path: Option<String>,
    /// Bytes on disk (only meaningful when `installed`).
    pub installed_bytes: Option<u64>,
}

pub fn list(app: &AppHandle) -> Vec<ModelStatus> {
    CURATED_MODELS
        .iter()
        .map(|m| {
            let path = model_path(app, m.id).ok();
            let (installed, installed_bytes, path_s) = match path.as_ref() {
                Some(p) => match std::fs::metadata(p) {
                    Ok(meta) if meta.is_file() => {
                        (true, Some(meta.len()), Some(p.to_string_lossy().to_string()))
                    }
                    _ => (false, None, None),
                },
                None => (false, None, None),
            };
            ModelStatus {
                id: m.id,
                label: m.label,
                size_mb: m.size_mb,
                url: m.url,
                default: m.default,
                installed,
                installed_bytes,
                path: path_s,
            }
        })
        .collect()
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub downloaded: u64,
    pub total: u64,
    pub done: bool,
}

/// Streams the model from Hugging Face, emitting progress every ~100ms.
/// Writes into `<dest>.part` and renames on success. Honours `abort_rx`:
/// if the sender is dropped (cancel) the `.part` file is removed and the
/// function returns `Err("aborted")`.
pub async fn download(
    app: AppHandle,
    id: String,
    on_progress: Channel<DownloadProgress>,
    mut abort_rx: oneshot::Receiver<()>,
) -> Result<String, String> {
    let entry = find(&id).ok_or_else(|| format!("unknown model id: {id}"))?;
    let dest = model_path(&app, &id)?;
    let tmp = {
        let mut t = dest.clone();
        let name = format!(
            "{}.part",
            t.file_name().and_then(|n| n.to_str()).unwrap_or("model.bin")
        );
        t.set_file_name(name);
        t
    };
    ensure_dir(&app)?;

    eprintln!(
        "[stt.models] download id={} url={} dest={}",
        id,
        entry.url,
        dest.display()
    );

    // Helper: best-effort cleanup of the partial file. Called on every
    // error path so a cancelled download doesn't leave megabytes of
    // garbage on disk.
    let cleanup_tmp = |path: &PathBuf| {
        let p = path.clone();
        tokio::spawn(async move {
            let _ = tokio::fs::remove_file(&p).await;
        });
    };

    let client = crate::net::http_client(&app).map_err(|e| format!("client: {e}"))?;

    // Race the initial request against the abort signal too — without this,
    // hitting Cancel before TCP/TLS completes would hang until the request
    // finishes.
    let resp = tokio::select! {
        biased;
        _ = &mut abort_rx => return Err("aborted".into()),
        r = client.get(entry.url).send() => r.map_err(|e| format!("request: {e}"))?,
    };
    if !resp.status().is_success() {
        return Err(format!("HTTP {} from {}", resp.status(), entry.url));
    }
    let total = resp.content_length().unwrap_or(0);

    let mut file = tokio::fs::File::create(&tmp)
        .await
        .map_err(|e| format!("create tmp: {e}"))?;
    let mut downloaded: u64 = 0;
    let _ = on_progress.send(DownloadProgress {
        downloaded: 0,
        total,
        done: false,
    });
    let mut last_emit = std::time::Instant::now();
    let mut stream = resp.bytes_stream();
    loop {
        let next = tokio::select! {
            biased;
            _ = &mut abort_rx => {
                eprintln!("[stt.models] aborted id={} after {} bytes", id, downloaded);
                drop(file);
                cleanup_tmp(&tmp);
                return Err("aborted".into());
            }
            n = stream.next() => n,
        };
        let Some(chunk) = next else { break };
        let chunk = match chunk {
            Ok(c) => c,
            Err(e) => {
                drop(file);
                cleanup_tmp(&tmp);
                return Err(format!("stream: {e}"));
            }
        };
        if let Err(e) = file.write_all(&chunk).await {
            drop(file);
            cleanup_tmp(&tmp);
            return Err(format!("write: {e}"));
        }
        downloaded += chunk.len() as u64;
        if last_emit.elapsed() >= std::time::Duration::from_millis(100) {
            let _ = on_progress.send(DownloadProgress {
                downloaded,
                total,
                done: false,
            });
            last_emit = std::time::Instant::now();
        }
    }
    if let Err(e) = file.flush().await {
        drop(file);
        cleanup_tmp(&tmp);
        return Err(format!("flush: {e}"));
    }
    drop(file);

    // Sanity check: huggingface served a body that's plausibly the right
    // model. ggml weight files are megabytes; anything under a few MB is
    // an HTML error page or a redirect that slipped through.
    let actual_bytes = tokio::fs::metadata(&tmp)
        .await
        .map_err(|e| format!("stat tmp: {e}"))?
        .len();
    let expected_bytes = (entry.size_mb as u64) * 1_000_000;
    let too_small = actual_bytes < expected_bytes / 2;
    if too_small {
        cleanup_tmp(&tmp);
        return Err(format!(
            "downloaded {} bytes — expected ~{} MB; likely an error page",
            actual_bytes, entry.size_mb
        ));
    }

    tokio::fs::rename(&tmp, &dest)
        .await
        .map_err(|e| format!("rename: {e}"))?;
    let _ = on_progress.send(DownloadProgress {
        downloaded: actual_bytes,
        total: actual_bytes,
        done: true,
    });
    eprintln!("[stt.models] ok id={} bytes={}", id, actual_bytes);
    Ok(dest.to_string_lossy().to_string())
}

pub fn delete(app: &AppHandle, id: &str) -> Result<(), String> {
    let _ = find(id).ok_or_else(|| format!("unknown model id: {id}"))?;
    let path = model_path(app, id)?;
    match std::fs::remove_file(&path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("delete: {e}")),
    }
}
