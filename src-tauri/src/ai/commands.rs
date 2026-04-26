use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatArgs {
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
    pub system_prompt: String,
    pub user_message: String,
}

#[tauri::command]
pub async fn ai_chat(app: tauri::AppHandle, args: AiChatArgs) -> Result<String, String> {
    let url = format!(
        "{}/chat/completions",
        args.endpoint.trim_end_matches('/')
    );

    let body = serde_json::json!({
        "model": args.model,
        "messages": [
            { "role": "system", "content": args.system_prompt },
            { "role": "user",   "content": args.user_message },
        ],
    });

    let client = crate::net::http_client(&app).map_err(|e| format!("client: {e}"))?;
    let resp = client
        .post(&url)
        .bearer_auth(&args.api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("network: {e}"))?;

    let status = resp.status();
    let text = resp.text().await.map_err(|e| format!("read body: {e}"))?;

    if !status.is_success() {
        return Err(format!("HTTP {}: {}", status.as_u16(), text));
    }

    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("parse json: {e} ({text})"))?;
    v.get("choices")
        .and_then(|c| c.get(0))
        .and_then(|c| c.get("message"))
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_str())
        .map(|s| s.trim().to_string())
        .ok_or_else(|| format!("response missing choices[0].message.content: {text}"))
}
