use super::server::AppCtx;
use axum::http::StatusCode;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::Emitter;
use tokio::sync::oneshot;
use uuid::Uuid;

/// Mint a request id, register a oneshot, emit `agent_api:request`, and wait
/// for the frontend bridge in `src/lib/agentApiBridge.ts` to call
/// `agent_api_reply`. Used by both REST handlers (legacy) and the in-process
/// MCP tool router.
pub async fn round_trip(
    ctx: &AppCtx,
    action: &str,
    payload: Value,
    timeout: Duration,
) -> Result<Value, (StatusCode, String)> {
    let req_id = Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel::<Value>();
    ctx.api.bridge.insert(req_id.clone(), tx);

    let event = json!({
        "reqId": req_id,
        "action": action,
        "payload": payload,
    });
    if let Err(e) = ctx.app.emit("agent_api:request", event) {
        ctx.api.bridge.remove(&req_id);
        return Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("emit failed: {e}"),
        ));
    }

    match tokio::time::timeout(timeout, rx).await {
        Ok(Ok(v)) => Ok(v),
        Ok(Err(_)) => {
            ctx.api.bridge.remove(&req_id);
            Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                "bridge channel dropped".into(),
            ))
        }
        Err(_) => {
            ctx.api.bridge.remove(&req_id);
            Err((
                StatusCode::REQUEST_TIMEOUT,
                format!("timeout waiting for {action}"),
            ))
        }
    }
}
