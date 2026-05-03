// Streaming AI completions over SSE — wraps OpenAI-compatible /chat/completions
// with `stream: true`, parses `data: {…}` chunks, and emits typed StreamEvent
// frames through a Channel so the frontend can render tokens live and dispatch
// tool calls as they finalize.
//
// Falls back to one-shot non-streaming when the endpoint rejects `stream: true`
// (some Ollama and OpenRouter setups). The fallback synthesizes a single delta
// then a done so the runner code path doesn't branch.
//
// Cancellation: we hand out a stream_id; the caller can fire abort_ai_chat_stream
// to drop the oneshot channel registered in AiStreamManager, which races against
// the bytes_stream poll.

use super::AiStreamManager;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{ipc::Channel, AppHandle, State};
use tokio::sync::oneshot;
use uuid::Uuid;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatStreamArgs {
    pub endpoint: String,
    pub api_key: String,
    pub model: String,
    /// Whole conversation as OpenAI message objects. Roles: system / user /
    /// assistant / tool. The runner is responsible for the sliding window.
    pub messages: Vec<Value>,
    /// Optional `tools: [...]` array — OpenAI function-calling schema.
    #[serde(default)]
    pub tools: Option<Vec<Value>>,
    /// Optional `tool_choice` value, e.g. "auto" / "none" / { "type": "function", … }.
    #[serde(default)]
    pub tool_choice: Option<Value>,
    /// When true (default), set stream=true on the upstream request.
    #[serde(default = "default_streaming")]
    pub streaming: bool,
}

fn default_streaming() -> bool {
    true
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    /// A chunk of plain assistant content. Frontend appends to the in-progress bubble.
    Delta { content: String },
    /// A chunk of `reasoning_content` (DeepSeek hybrid thinking, Anthropic-via-OpenRouter
    /// thinking, etc.). DeepSeek REQUIRES this round-tripped to subsequent calls or
    /// it errors with `reasoning_content ... must be passed back to the API`. The
    /// frontend accumulates these and stores them on the assistant message so
    /// future history sends them back.
    ReasoningDelta { content: String },
    /// A chunk of a tool call. The frontend accumulates by `id` and `index`.
    /// `name` is sent on the first chunk for a given index; `arguments_partial`
    /// arrives in pieces and must be concatenated as plain text (it's a JSON
    /// string slice, not a structured value).
    ToolCallDelta {
        index: u32,
        id: Option<String>,
        name: Option<String>,
        arguments_partial: Option<String>,
    },
    /// `finish_reason` is whatever the provider returned: stop / tool_calls / length.
    Done { finish_reason: Option<String> },
    Error { message: String },
}

#[tauri::command]
pub async fn ai_chat_stream(
    app: AppHandle,
    args: ChatStreamArgs,
    on_event: Channel<StreamEvent>,
    manager: State<'_, AiStreamManager>,
) -> Result<String, String> {
    let stream_id = Uuid::new_v4().to_string();
    let (abort_tx, abort_rx) = oneshot::channel::<()>();
    manager.aborts.insert(stream_id.clone(), abort_tx);

    let stream_id_for_task = stream_id.clone();
    let manager_aborts = manager.aborts.clone();

    // Drive the request on a tokio task so the command returns the stream_id
    // immediately (the frontend needs it to register the abort handler).
    tauri::async_runtime::spawn(async move {
        let result = run_stream(&app, args, &on_event, abort_rx).await;
        if let Err(e) = result {
            let _ = on_event.send(StreamEvent::Error { message: e });
        }
        manager_aborts.remove(&stream_id_for_task);
    });

    Ok(stream_id)
}

#[tauri::command]
pub fn abort_ai_chat_stream(
    stream_id: String,
    manager: State<'_, AiStreamManager>,
) -> Result<(), String> {
    if let Some((_, tx)) = manager.aborts.remove(&stream_id) {
        let _ = tx.send(());
    }
    Ok(())
}

async fn run_stream(
    app: &AppHandle,
    args: ChatStreamArgs,
    on_event: &Channel<StreamEvent>,
    mut abort_rx: oneshot::Receiver<()>,
) -> Result<(), String> {
    let url = format!(
        "{}/chat/completions",
        args.endpoint.trim_end_matches('/')
    );

    let client = crate::net::http_client(app).map_err(|e| format!("client: {e}"))?;

    // Try streaming first. If the provider rejects with 4xx (e.g., model
    // doesn't support streaming), retry once without `stream: true` and
    // synthesize a delta+done so the frontend code path doesn't branch.
    let try_streaming = args.streaming;

    let mut body = serde_json::json!({
        "model": args.model,
        "messages": args.messages,
    });
    if let Some(tools) = &args.tools {
        body["tools"] = serde_json::Value::Array(tools.clone());
    }
    if let Some(tc) = &args.tool_choice {
        body["tool_choice"] = tc.clone();
    }

    if try_streaming {
        let mut streaming_body = body.clone();
        streaming_body["stream"] = serde_json::Value::Bool(true);

        let resp = client
            .post(&url)
            .bearer_auth(&args.api_key)
            .json(&streaming_body)
            .send()
            .await
            .map_err(|e| format!("network: {e}"))?;

        let status = resp.status();
        if status.is_success() {
            return drive_sse(resp, on_event, &mut abort_rx).await;
        }
        // Not 2xx — fall through to one-shot. We need to drain the body for
        // the error message in case one-shot also fails.
        let _err_body = resp.text().await.unwrap_or_default();
        // If the upstream rejected specifically because of `stream: true`,
        // the one-shot retry below should succeed. If it's a hard auth/model
        // error the one-shot will surface the same status with a clearer
        // body shape.
    }

    // One-shot path (or fallback).
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
        return Err(format!("HTTP {} from {url}: {text}", status.as_u16()));
    }
    let v: Value = serde_json::from_str(&text)
        .map_err(|e| format!("parse json: {e} (body: {text})"))?;
    let choice = v
        .get("choices")
        .and_then(|c| c.get(0))
        .ok_or_else(|| format!("response missing choices[0]: {text}"))?;
    let message = choice
        .get("message")
        .ok_or_else(|| format!("response missing choices[0].message: {text}"))?;

    if let Some(reasoning) = message
        .get("reasoning_content")
        .and_then(|r| r.as_str())
    {
        if !reasoning.is_empty() {
            let _ = on_event.send(StreamEvent::ReasoningDelta { content: reasoning.to_string() });
        }
    }
    if let Some(content) = message.get("content").and_then(|c| c.as_str()) {
        if !content.is_empty() {
            let _ = on_event.send(StreamEvent::Delta { content: content.to_string() });
        }
    }
    if let Some(tool_calls) = message.get("tool_calls").and_then(|tc| tc.as_array()) {
        for (idx, call) in tool_calls.iter().enumerate() {
            let id = call.get("id").and_then(|v| v.as_str()).map(|s| s.to_string());
            let name = call
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|n| n.as_str())
                .map(|s| s.to_string());
            let args_partial = call
                .get("function")
                .and_then(|f| f.get("arguments"))
                .and_then(|a| a.as_str())
                .map(|s| s.to_string());
            let _ = on_event.send(StreamEvent::ToolCallDelta {
                index: idx as u32,
                id,
                name,
                arguments_partial: args_partial,
            });
        }
    }
    let finish_reason = choice
        .get("finish_reason")
        .and_then(|f| f.as_str())
        .map(|s| s.to_string());
    let _ = on_event.send(StreamEvent::Done { finish_reason });
    Ok(())
}

async fn drive_sse(
    resp: reqwest::Response,
    on_event: &Channel<StreamEvent>,
    abort_rx: &mut oneshot::Receiver<()>,
) -> Result<(), String> {
    let mut stream = resp.bytes_stream();
    let mut buf: Vec<u8> = Vec::new();
    let mut finish_reason: Option<String> = None;

    loop {
        tokio::select! {
            biased;
            _ = &mut *abort_rx => {
                let _ = on_event.send(StreamEvent::Error { message: "aborted".into() });
                return Ok(());
            }
            chunk = stream.next() => {
                match chunk {
                    Some(Ok(bytes)) => {
                        buf.extend_from_slice(&bytes);
                        // Process complete lines; SSE frames are LF-terminated, separated by blank lines.
                        loop {
                            let nl = buf.iter().position(|&b| b == b'\n');
                            let nl = match nl { Some(p) => p, None => break };
                            let line = buf.drain(..=nl).collect::<Vec<u8>>();
                            let line = String::from_utf8_lossy(&line).trim().to_string();
                            if line.is_empty() { continue; }
                            // SSE: each event is "data: <json>" (or "data: [DONE]").
                            let payload = match line.strip_prefix("data:") {
                                Some(p) => p.trim(),
                                None => continue, // skip event:, id:, etc.
                            };
                            if payload == "[DONE]" {
                                let _ = on_event.send(StreamEvent::Done { finish_reason: finish_reason.clone() });
                                return Ok(());
                            }
                            let v: Value = match serde_json::from_str(payload) {
                                Ok(v) => v,
                                Err(_) => continue,
                            };
                            handle_chunk(&v, on_event, &mut finish_reason);
                        }
                    }
                    Some(Err(e)) => {
                        return Err(format!("stream read: {e}"));
                    }
                    None => {
                        // EOF without [DONE] — emit done anyway.
                        let _ = on_event.send(StreamEvent::Done { finish_reason });
                        return Ok(());
                    }
                }
            }
        }
    }
}

fn handle_chunk(v: &Value, on_event: &Channel<StreamEvent>, finish_reason: &mut Option<String>) {
    let choice = match v.get("choices").and_then(|c| c.get(0)) {
        Some(c) => c,
        None => return,
    };
    if let Some(reason) = choice.get("finish_reason").and_then(|r| r.as_str()) {
        *finish_reason = Some(reason.to_string());
    }
    let delta = match choice.get("delta") {
        Some(d) => d,
        None => return,
    };
    if let Some(reasoning) = delta.get("reasoning_content").and_then(|r| r.as_str()) {
        if !reasoning.is_empty() {
            let _ = on_event.send(StreamEvent::ReasoningDelta { content: reasoning.to_string() });
        }
    }
    if let Some(content) = delta.get("content").and_then(|c| c.as_str()) {
        if !content.is_empty() {
            let _ = on_event.send(StreamEvent::Delta { content: content.to_string() });
        }
    }
    if let Some(tool_calls) = delta.get("tool_calls").and_then(|tc| tc.as_array()) {
        for call in tool_calls {
            let index = call
                .get("index")
                .and_then(|i| i.as_u64())
                .unwrap_or(0) as u32;
            let id = call.get("id").and_then(|v| v.as_str()).map(|s| s.to_string());
            let name = call
                .get("function")
                .and_then(|f| f.get("name"))
                .and_then(|n| n.as_str())
                .map(|s| s.to_string());
            let args_partial = call
                .get("function")
                .and_then(|f| f.get("arguments"))
                .and_then(|a| a.as_str())
                .map(|s| s.to_string());
            // Skip empty deltas where every field is None — some providers
            // emit a header chunk before any tool data.
            if id.is_none() && name.is_none() && args_partial.is_none() {
                continue;
            }
            let _ = on_event.send(StreamEvent::ToolCallDelta {
                index,
                id,
                name,
                arguments_partial: args_partial,
            });
        }
    }
}
