use serde::Deserialize;
use std::error::Error as _;
use std::path::PathBuf;
use tauri::ipc::Channel;

// Mirrors the helper in ai/commands.rs: reqwest::Error's Display only prints
// the top-level message and hides the underlying io/dns/tls cause. Walk the
// source chain so terminal logs actually tell us why a request failed.
fn format_reqwest_err(err: &reqwest::Error) -> String {
    let mut parts: Vec<String> = vec![err.to_string()];
    let mut src: Option<&(dyn std::error::Error + 'static)> = err.source();
    while let Some(s) = src {
        parts.push(s.to_string());
        src = s.source();
    }
    let mut flags: Vec<&'static str> = Vec::new();
    if err.is_timeout() { flags.push("timeout"); }
    if err.is_connect() { flags.push("connect"); }
    if err.is_request() { flags.push("request"); }
    if err.is_redirect() { flags.push("redirect"); }
    if err.is_decode() { flags.push("decode"); }
    if err.is_body() { flags.push("body"); }
    if err.is_status() { flags.push("status"); }
    if !flags.is_empty() {
        parts.push(format!("flags={}", flags.join(",")));
    }
    if let Some(status) = err.status() {
        parts.push(format!("status={status}"));
    }
    parts.join(" → ")
}

/// Update which key the OS-level hotkey monitor intercepts. macOS uses an
/// NSEvent local monitor (suppresses IMK log spam); Linux uses an X11
/// keyboard poll (works around WebKitGTK dropping modifier keyup events).
/// Other platforms drive the hotkey purely through the JS keydown listener.
#[tauri::command]
pub fn stt_hotkey_set(code: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    crate::stt::hotkey_monitor::set_hotkey(&code);
    #[cfg(target_os = "linux")]
    crate::stt::hotkey_monitor_linux::set_hotkey(&code);
    let _ = code;
    Ok(())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeArgs {
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
    pub audio: Vec<u8>,
    pub mime: Option<String>,
    pub filename: Option<String>,
    pub language: Option<String>,
    pub provider: Option<String>,
}

#[tauri::command]
pub async fn stt_transcribe(
    app: tauri::AppHandle,
    args: TranscribeArgs,
) -> Result<String, String> {
    let is_elevenlabs = args.provider.as_deref() == Some("elevenlabs");
    let provider_tag = if is_elevenlabs { "elevenlabs" } else { "openai" };
    let endpoint = args.endpoint.trim_end_matches('/');
    let url = if is_elevenlabs {
        format!("{}/speech-to-text", endpoint)
    } else {
        format!("{}/audio/transcriptions", endpoint)
    };
    let mime = args.mime.unwrap_or_else(|| "audio/webm".to_string());
    let filename = args.filename.unwrap_or_else(|| "audio.webm".to_string());
    let audio_len = args.audio.len();
    let lang_tag = args.language.as_deref().unwrap_or("");
    eprintln!(
        "[stt_transcribe] POST {url} provider={provider_tag} model={} lang={} bytes={} mime={mime} filename={filename}",
        args.model, lang_tag, audio_len
    );

    let part = reqwest::multipart::Part::bytes(args.audio)
        .file_name(filename)
        .mime_str(&mime)
        .map_err(|e| {
            eprintln!("[stt_transcribe] invalid mime={mime}: {e}");
            format!("invalid mime: {e}")
        })?;

    let (model_field, language_field) = if is_elevenlabs {
        ("model_id", "language_code")
    } else {
        ("model", "language")
    };
    let mut form = reqwest::multipart::Form::new()
        .text(model_field, args.model)
        .part("file", part);
    if let Some(lang) = args.language {
        if !lang.is_empty() {
            form = form.text(language_field, lang);
        }
    }

    let client = crate::net::http_client(&app).map_err(|e| {
        eprintln!("[stt_transcribe] client build failed: {e}");
        format!("client: {e}")
    })?;
    let mut req = client.post(&url);
    if is_elevenlabs {
        req = req.header("xi-api-key", &args.api_key);
    } else {
        req = req.bearer_auth(&args.api_key);
    }
    let started = std::time::Instant::now();
    let resp = req
        .multipart(form)
        .send()
        .await
        .map_err(|e| {
            let detail = format_reqwest_err(&e);
            eprintln!(
                "[stt_transcribe] network error after {:?} url={url} provider={provider_tag}: {detail}",
                started.elapsed()
            );
            format!("network ({url}): {detail}")
        })?;

    let status = resp.status();
    let elapsed = started.elapsed();
    let body = resp.text().await.map_err(|e| {
        let detail = format_reqwest_err(&e);
        eprintln!("[stt_transcribe] read body failed url={url} elapsed={elapsed:?}: {detail}");
        format!("read body ({url}, {elapsed:?}): {detail}")
    })?;
    eprintln!(
        "[stt_transcribe] response status={} bytes={} elapsed={:?} provider={provider_tag}",
        status,
        body.len(),
        elapsed
    );

    if !status.is_success() {
        eprintln!(
            "[stt_transcribe] HTTP {} from {url} provider={provider_tag}: {body}",
            status.as_u16()
        );
        return Err(format!("HTTP {} from {url}: {body}", status.as_u16()));
    }

    let v: serde_json::Value = serde_json::from_str(&body).map_err(|e| {
        eprintln!("[stt_transcribe] parse json failed: {e} (body: {body})");
        format!("parse json: {e} ({body})")
    })?;
    let raw_text = v
        .get("text")
        .and_then(|t| t.as_str())
        .map(|s| s.trim().to_string())
        .ok_or_else(|| {
            eprintln!("[stt_transcribe] response missing 'text' provider={provider_tag}: {body}");
            format!("response missing 'text': {body}")
        })?;
    // ElevenLabs Scribe inlines non-speech audio events as bracketed/parenthesized
    // tags (e.g. `[tapping]`, `(Background noise and people speaking)`) inside the
    // transcript. They're noise once the text is being injected into a terminal /
    // editor, so drop them here before returning.
    let text = if is_elevenlabs {
        strip_bracketed_annotations(&raw_text)
    } else {
        raw_text
    };
    eprintln!(
        "[stt_transcribe] ok provider={provider_tag} chars={} elapsed={elapsed:?}",
        text.chars().count()
    );
    Ok(text)
}

// ---------------------------------------------------------------------------
// Local (on-device) Whisper preset
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribeLocalArgs {
    /// 16-bit PCM mono WAV blob produced by the recorder's `forceWav` path.
    pub audio: Vec<u8>,
    /// Absolute path to a `ggml-<id>.bin` Whisper model file.
    pub model_path: String,
    /// Optional ISO language code ("en", "zh", …). Empty/None = auto-detect.
    pub language: Option<String>,
}

#[tauri::command]
pub async fn stt_transcribe_local(args: TranscribeLocalArgs) -> Result<String, String> {
    let model_path = PathBuf::from(&args.model_path);
    if !model_path.is_file() {
        return Err(format!(
            "model file not found: {} — download it first via Settings",
            args.model_path
        ));
    }
    let bytes_len = args.audio.len();
    let lang_tag = args.language.clone().unwrap_or_default();
    eprintln!(
        "[stt_transcribe_local] model={} lang={} bytes={}",
        args.model_path, lang_tag, bytes_len
    );
    let started = std::time::Instant::now();

    // Whisper inference is CPU-bound and can take seconds; run on the
    // blocking pool so the async runtime keeps serving UI events.
    let result = tokio::task::spawn_blocking(move || {
        crate::stt::local::transcribe(&args.audio, &model_path, args.language.as_deref())
    })
    .await
    .map_err(|e| format!("join: {e}"))?;

    match result {
        Ok(text) => {
            eprintln!(
                "[stt_transcribe_local] ok chars={} elapsed={:?}",
                text.chars().count(),
                started.elapsed()
            );
            Ok(text)
        }
        Err(e) => {
            eprintln!(
                "[stt_transcribe_local] error elapsed={:?}: {e:#}",
                started.elapsed()
            );
            Err(format!("{e:#}"))
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelListResponse {
    pub models: Vec<crate::stt::models::ModelStatus>,
    pub gpu: Option<crate::stt::local::GpuStatus>,
    pub models_dir: Option<String>,
}

#[tauri::command]
pub fn stt_model_list(app: tauri::AppHandle) -> Result<ModelListResponse, String> {
    let models = crate::stt::models::list(&app);
    let dir = crate::stt::models::models_dir(&app)
        .ok()
        .map(|p| p.to_string_lossy().to_string());
    Ok(ModelListResponse {
        models,
        gpu: crate::stt::local::current_gpu_status(),
        models_dir: dir,
    })
}

#[tauri::command]
pub async fn stt_model_download(
    app: tauri::AppHandle,
    id: String,
    on_progress: Channel<crate::stt::models::DownloadProgress>,
    manager: tauri::State<'_, crate::stt::ModelDownloadManager>,
) -> Result<String, String> {
    // Register an abort handle keyed by model id. Inserting drops any
    // previous sender for the same id, which aborts an in-flight download
    // — the user clicked Download twice in a row, only the latest wins.
    let (abort_tx, abort_rx) = tokio::sync::oneshot::channel::<()>();
    manager.aborts.insert(id.clone(), abort_tx);
    let result = crate::stt::models::download(app, id.clone(), on_progress, abort_rx).await;
    // Only remove if WE still own the entry — a concurrent download for the
    // same id may have already replaced it.
    manager
        .aborts
        .remove_if(&id, |_, _| true /* unconditional best-effort */);
    result
}

/// Cancels an in-flight download for `id`. Dropping the oneshot sender
/// races against the `bytes_stream` poll in `models::download`, which
/// detects the abort, removes the `.part` file, and returns `Err("aborted")`.
#[tauri::command]
pub fn stt_model_download_abort(
    id: String,
    manager: tauri::State<'_, crate::stt::ModelDownloadManager>,
) {
    if let Some((_, _tx)) = manager.aborts.remove(&id) {
        // _tx is dropped here → receiver future resolves → download aborts.
        eprintln!("[stt_model_download_abort] cancelled id={id}");
    }
}

#[tauri::command]
pub fn stt_model_delete(app: tauri::AppHandle, id: String) -> Result<(), String> {
    crate::stt::models::delete(&app, &id)
}

fn strip_bracketed_annotations(text: &str) -> String {
    let mut stripped = String::with_capacity(text.len());
    let mut bracket_depth: u32 = 0;
    let mut paren_depth: u32 = 0;
    for ch in text.chars() {
        match ch {
            '[' => bracket_depth += 1,
            ']' if bracket_depth > 0 => bracket_depth -= 1,
            '(' => paren_depth += 1,
            ')' if paren_depth > 0 => paren_depth -= 1,
            _ if bracket_depth == 0 && paren_depth == 0 => stripped.push(ch),
            _ => {}
        }
    }
    let mut out = String::with_capacity(stripped.len());
    let mut prev_space = true;
    for ch in stripped.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                out.push(' ');
                prev_space = true;
            }
        } else {
            out.push(ch);
            prev_space = false;
        }
    }
    while out.ends_with(' ') {
        out.pop();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::strip_bracketed_annotations;

    #[test]
    fn strips_bracketed_audio_events() {
        assert_eq!(
            strip_bracketed_annotations("Hello [tapping] world"),
            "Hello world"
        );
    }

    #[test]
    fn strips_parenthesized_audio_events() {
        assert_eq!(
            strip_bracketed_annotations("Hello (Background noise and people speaking) world"),
            "Hello world"
        );
    }

    #[test]
    fn strips_mixed_and_collapses_whitespace() {
        assert_eq!(
            strip_bracketed_annotations("[music]  Let's begin (laughter), shall we?  [end]"),
            "Let's begin , shall we?"
        );
    }

    #[test]
    fn leaves_plain_text_untouched() {
        assert_eq!(
            strip_bracketed_annotations("Just a normal sentence."),
            "Just a normal sentence."
        );
    }

    #[test]
    fn handles_unmatched_brackets_gracefully() {
        // Unmatched openers swallow the rest of the string — that's fine for
        // ASR output, where stray openers are themselves noise.
        assert_eq!(
            strip_bracketed_annotations("Hello [unclosed annotation"),
            "Hello"
        );
    }
}
