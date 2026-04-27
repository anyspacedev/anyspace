use serde::Deserialize;

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
    let endpoint = args.endpoint.trim_end_matches('/');
    let url = if is_elevenlabs {
        format!("{}/speech-to-text", endpoint)
    } else {
        format!("{}/audio/transcriptions", endpoint)
    };
    let mime = args.mime.unwrap_or_else(|| "audio/webm".to_string());
    let filename = args.filename.unwrap_or_else(|| "audio.webm".to_string());

    let part = reqwest::multipart::Part::bytes(args.audio)
        .file_name(filename)
        .mime_str(&mime)
        .map_err(|e| format!("invalid mime: {e}"))?;

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

    let client = crate::net::http_client(&app).map_err(|e| format!("client: {e}"))?;
    let mut req = client.post(&url);
    if is_elevenlabs {
        req = req.header("xi-api-key", &args.api_key);
    } else {
        req = req.bearer_auth(&args.api_key);
    }
    let resp = req
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("network: {e}"))?;

    let status = resp.status();
    let body = resp.text().await.map_err(|e| format!("read body: {e}"))?;

    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), body));
    }

    let v: serde_json::Value =
        serde_json::from_str(&body).map_err(|e| format!("parse json: {e} ({body})"))?;
    v.get("text")
        .and_then(|t| t.as_str())
        .map(|s| s.trim().to_string())
        .ok_or_else(|| format!("response missing 'text': {body}"))
}
