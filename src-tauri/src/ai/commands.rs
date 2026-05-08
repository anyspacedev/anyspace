use serde::Deserialize;
use std::error::Error as _;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatArgs {
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
    pub system_prompt: String,
    pub user_message: String,
}

// reqwest::Error's Display only prints the top-level message ("error sending
// request for url (…)") and hides the underlying io/dns/tls cause. Walk the
// source chain so the frontend log actually tells us *why* the request failed.
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

fn preview(s: &str, max: usize) -> String {
    let one_line: String = s.chars().map(|c| if c == '\n' { '⏎' } else { c }).collect();
    if one_line.chars().count() <= max {
        one_line
    } else {
        let head: String = one_line.chars().take(max).collect();
        format!("{head}… ({} chars total)", s.chars().count())
    }
}

#[tauri::command]
pub async fn ai_chat(app: tauri::AppHandle, args: AiChatArgs) -> Result<String, String> {
    let url = format!(
        "{}/chat/completions",
        args.endpoint.trim_end_matches('/')
    );
    eprintln!("[ai_chat] POST {url} model={} msglen={}", args.model, args.user_message.len());
    eprintln!("[ai_chat]   system: {}", preview(&args.system_prompt, 400));
    eprintln!("[ai_chat]   user:   {}", preview(&args.user_message, 400));

    let body = serde_json::json!({
        "model": args.model,
        "messages": [
            { "role": "system", "content": args.system_prompt },
            { "role": "user",   "content": args.user_message },
        ],
    });

    let client = crate::net::http_client(&app).map_err(|e| format!("client: {e}"))?;
    let started = std::time::Instant::now();
    let resp = client
        .post(&url)
        .bearer_auth(&args.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| {
            let detail = format_reqwest_err(&e);
            eprintln!("[ai_chat] network error after {:?} url={url}: {detail}", started.elapsed());
            format!("network ({url}): {detail}")
        })?;

    let status = resp.status();
    let elapsed = started.elapsed();
    let text = resp
        .text()
        .await
        .map_err(|e| format!("read body ({url}, {elapsed:?}): {}", format_reqwest_err(&e)))?;
    eprintln!("[ai_chat] response status={} bytes={} elapsed={:?}", status, text.len(), elapsed);

    if !status.is_success() {
        return Err(format!("HTTP {} from {url}: {text}", status.as_u16()));
    }

    let v: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| format!("parse json: {e} (body: {text})"))?;
    v.get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.trim().to_string())
        .ok_or_else(|| format!("response missing choices[0].message.content: {text}"))
}
