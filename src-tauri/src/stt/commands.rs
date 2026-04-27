use serde::Deserialize;
use std::error::Error as _;

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

/// Update which key the macOS NSEvent monitor intercepts. No-op on other
/// platforms — non-Mac targets drive the hotkey purely through the JS
/// keydown listener, which doesn't trigger the IMK log spam this monitor was
/// added to suppress.
#[tauri::command]
pub fn stt_hotkey_set(code: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    crate::stt::hotkey_monitor::set_hotkey(&code);
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
    let text = v
        .get("text")
        .and_then(|t| t.as_str())
        .map(|s| s.trim().to_string())
        .ok_or_else(|| {
            eprintln!("[stt_transcribe] response missing 'text' provider={provider_tag}: {body}");
            format!("response missing 'text': {body}")
        })?;
    eprintln!(
        "[stt_transcribe] ok provider={provider_tag} chars={} elapsed={elapsed:?}",
        text.chars().count()
    );
    Ok(text)
}
