use super::bridge::round_trip;
use super::server::AppCtx;
use axum::{
    extract::{Query, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::time::Duration;

fn pane_id_from_headers(headers: &HeaderMap) -> Option<String> {
    headers
        .get("x-pane-id")
        .and_then(|v| v.to_str().ok())
        .map(String::from)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectQuery {
    pub project_path: String,
}

/// Read-only — defers to the existing detector. No round-trip needed.
pub async fn preview_detect(
    State(ctx): State<AppCtx>,
    Query(q): Query<DetectQuery>,
) -> Response {
    match crate::preview::detector::detect(&ctx.app, q.project_path).await {
        Ok(Some(preview)) => {
            Json(serde_json::to_value(preview).unwrap_or(Value::Null)).into_response()
        }
        Ok(None) => (
            StatusCode::NOT_FOUND,
            Json(json!({"error":"no dev server detected"})),
        )
            .into_response(),
        Err(e) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(json!({"error":e})),
        )
            .into_response(),
    }
}

pub async fn list_panes(State(ctx): State<AppCtx>, headers: HeaderMap) -> Response {
    let pane_id = pane_id_from_headers(&headers);
    let payload = json!({"requesterPaneId": pane_id});
    finalize(round_trip(&ctx, "panes.list", payload, Duration::from_secs(5)).await)
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PreviewOpenBody {
    pub url: Option<String>,
    pub project_path: Option<String>,
    pub direction: Option<String>,
    pub engine: Option<String>,
}

pub async fn preview_open(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(body): Json<PreviewOpenBody>,
) -> Response {
    let requester = pane_id_from_headers(&headers);
    let payload = json!({
        "requesterPaneId": requester,
        "url": body.url,
        "projectPath": body.project_path,
        "direction": body.direction.unwrap_or_else(|| "h".into()),
        "engine": body.engine.unwrap_or_else(|| "iframe".into()),
    });
    finalize(round_trip(&ctx, "preview.open", payload, Duration::from_secs(30)).await)
}

#[derive(Debug, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PreviewScreenshotBody {
    pub pane_id: Option<String>,
    pub full_page: Option<bool>,
}

pub async fn preview_screenshot(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(body): Json<PreviewScreenshotBody>,
) -> Response {
    let requester = pane_id_from_headers(&headers);
    let target = body.pane_id.clone().or_else(|| requester.clone());
    let payload = json!({
        "requesterPaneId": requester,
        "targetPaneId": target,
        "fullPage": body.full_page.unwrap_or(false),
    });
    finalize(round_trip(&ctx, "preview.screenshot", payload, Duration::from_secs(10)).await)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewClickBody {
    pub pane_id: Option<String>,
    pub selector: String,
}

pub async fn preview_click(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(body): Json<PreviewClickBody>,
) -> Response {
    let requester = pane_id_from_headers(&headers);
    let target = body.pane_id.clone().or_else(|| requester.clone());
    let payload = json!({
        "requesterPaneId": requester,
        "targetPaneId": target,
        "selector": body.selector,
    });
    finalize(round_trip(&ctx, "preview.click", payload, Duration::from_secs(5)).await)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFillBody {
    pub pane_id: Option<String>,
    pub selector: String,
    pub value: String,
    pub submit: Option<bool>,
}

pub async fn preview_fill(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(body): Json<PreviewFillBody>,
) -> Response {
    let requester = pane_id_from_headers(&headers);
    let target = body.pane_id.clone().or_else(|| requester.clone());
    let payload = json!({
        "requesterPaneId": requester,
        "targetPaneId": target,
        "selector": body.selector,
        "value": body.value,
        "submit": body.submit.unwrap_or(false),
    });
    finalize(round_trip(&ctx, "preview.fill", payload, Duration::from_secs(5)).await)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewNavigateBody {
    pub pane_id: Option<String>,
    pub url: String,
}

pub async fn preview_navigate(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    Json(body): Json<PreviewNavigateBody>,
) -> Response {
    let requester = pane_id_from_headers(&headers);
    let target = body.pane_id.clone().or_else(|| requester.clone());
    let payload = json!({
        "requesterPaneId": requester,
        "targetPaneId": target,
        "url": body.url,
    });
    finalize(round_trip(&ctx, "preview.navigate", payload, Duration::from_secs(5)).await)
}

fn finalize(r: Result<Value, (StatusCode, String)>) -> Response {
    match r {
        Ok(v) => Json(v).into_response(),
        Err((code, msg)) => (code, Json(json!({ "error": msg }))).into_response(),
    }
}
