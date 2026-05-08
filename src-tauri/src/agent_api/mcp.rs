// In-process MCP server for AnySpace preview tools, served over Streamable
// HTTP at /mcp. Replaces the standalone `anyspace-mcp` stdio binary — same
// `#[tool_router]` ergonomics, same tool surface, but each tool calls the
// frontend bridge (`round_trip`) directly instead of self-looping HTTP.
//
// Pane / tab identity flows in via `X-Pane-Id` / `X-Tab-Id` request headers.
// rmcp injects `axum::http::request::Parts` into per-request extensions in both
// stateful and stateless modes (rmcp/src/transport/streamable_http_server/
// tower.rs:1036-1180), so tools can read them via `Extension<Parts>`.

use super::bridge::round_trip;
use super::server::AppCtx;
use base64::Engine;
use rmcp::{
    handler::server::{router::tool::ToolRouter, tool::Extension, wrapper::Parameters},
    model::{CallToolResult, Content, ServerCapabilities, ServerInfo},
    schemars,
    tool, tool_handler, tool_router,
    transport::streamable_http_server::{
        session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
    },
    ErrorData as McpError, ServerHandler,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use std::time::Duration;

#[derive(Clone)]
pub struct AnySpace {
    ctx: AppCtx,
    // Read by the #[tool_handler] macro at dispatch time; rustc's dead-code
    // analysis can't see through the macro expansion.
    #[allow(dead_code)]
    tool_router: ToolRouter<AnySpace>,
}

impl AnySpace {
    pub fn new(ctx: AppCtx) -> Self {
        Self {
            ctx,
            tool_router: AnySpace::tool_router(),
        }
    }
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct OpenArgs {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub engine: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotArgs {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pane_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub full_page: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ClickArgs {
    pub selector: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pane_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FillArgs {
    pub selector: String,
    pub value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub submit: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pane_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct NavigateArgs {
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pane_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct DetectArgs {
    pub project_path: String,
}

fn header_str(parts: &axum::http::request::Parts, name: &str) -> Option<String> {
    parts
        .headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
}

fn requester_ids(parts: &axum::http::request::Parts) -> (Option<String>, Option<String>) {
    (
        header_str(parts, "x-pane-id"),
        header_str(parts, "x-tab-id"),
    )
}

fn text_result(v: &Value) -> CallToolResult {
    let s = serde_json::to_string_pretty(v).unwrap_or_else(|_| v.to_string());
    CallToolResult::success(vec![Content::text(s)])
}

fn map_err(err: (axum::http::StatusCode, String)) -> McpError {
    let (code, msg) = err;
    McpError::internal_error(format!("{code}: {msg}"), None)
}

#[tool_router]
impl AnySpace {
    #[tool(
        description = "Open or refocus the live preview pane next to this terminal. \
                       Pass projectPath to auto-detect a dev server, or url for a specific page."
    )]
    async fn preview_open(
        &self,
        Parameters(args): Parameters<OpenArgs>,
        Extension(parts): Extension<axum::http::request::Parts>,
    ) -> Result<CallToolResult, McpError> {
        let (pane, tab) = requester_ids(&parts);
        let payload = json!({
            "requesterPaneId": pane,
            "requesterTabId": tab,
            "url": args.url,
            "projectPath": args.project_path,
            "direction": args.direction.unwrap_or_else(|| "h".into()),
            "engine": args.engine.unwrap_or_else(|| "iframe".into()),
        });
        let v = round_trip(&self.ctx, "preview.open", payload, Duration::from_secs(30))
            .await
            .map_err(map_err)?;
        Ok(text_result(&v))
    }

    #[tool(
        description = "Capture the live preview pane to a PNG file. Returns both an inline image \
                       (for vision-capable clients) and the on-disk path."
    )]
    async fn preview_screenshot(
        &self,
        Parameters(args): Parameters<ScreenshotArgs>,
        Extension(parts): Extension<axum::http::request::Parts>,
    ) -> Result<CallToolResult, McpError> {
        let (pane, tab) = requester_ids(&parts);
        let target = args.pane_id.clone().or_else(|| pane.clone());
        let payload = json!({
            "requesterPaneId": pane,
            "requesterTabId": tab,
            "targetPaneId": target,
            "fullPage": args.full_page.unwrap_or(false),
        });
        let resp = round_trip(
            &self.ctx,
            "preview.screenshot",
            payload,
            Duration::from_secs(10),
        )
        .await
        .map_err(map_err)?;
        let mut blocks = vec![Content::text(
            serde_json::to_string_pretty(&resp).unwrap_or_else(|_| resp.to_string()),
        )];
        if let Some(path) = resp.get("path").and_then(|p| p.as_str()) {
            match tokio::fs::read(path).await {
                Ok(bytes) => {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                    blocks.push(Content::image(b64, "image/png"));
                }
                Err(e) => {
                    eprintln!("[mcp] screenshot read failed for {path}: {e}");
                }
            }
        }
        Ok(CallToolResult::success(blocks))
    }

    #[tool(description = "Click an element in the live preview by CSS selector.")]
    async fn preview_click(
        &self,
        Parameters(args): Parameters<ClickArgs>,
        Extension(parts): Extension<axum::http::request::Parts>,
    ) -> Result<CallToolResult, McpError> {
        let (pane, tab) = requester_ids(&parts);
        let target = args.pane_id.clone().or_else(|| pane.clone());
        let payload = json!({
            "requesterPaneId": pane,
            "requesterTabId": tab,
            "targetPaneId": target,
            "selector": args.selector,
        });
        let v = round_trip(&self.ctx, "preview.click", payload, Duration::from_secs(5))
            .await
            .map_err(map_err)?;
        Ok(text_result(&v))
    }

    #[tool(
        description = "Fill an input/textarea by CSS selector and dispatch input + change events. \
                       Set submit=true to also requestSubmit() the enclosing form."
    )]
    async fn preview_fill(
        &self,
        Parameters(args): Parameters<FillArgs>,
        Extension(parts): Extension<axum::http::request::Parts>,
    ) -> Result<CallToolResult, McpError> {
        let (pane, tab) = requester_ids(&parts);
        let target = args.pane_id.clone().or_else(|| pane.clone());
        let payload = json!({
            "requesterPaneId": pane,
            "requesterTabId": tab,
            "targetPaneId": target,
            "selector": args.selector,
            "value": args.value,
            "submit": args.submit.unwrap_or(false),
        });
        let v = round_trip(&self.ctx, "preview.fill", payload, Duration::from_secs(5))
            .await
            .map_err(map_err)?;
        Ok(text_result(&v))
    }

    #[tool(description = "Navigate the live preview to a different URL.")]
    async fn preview_navigate(
        &self,
        Parameters(args): Parameters<NavigateArgs>,
        Extension(parts): Extension<axum::http::request::Parts>,
    ) -> Result<CallToolResult, McpError> {
        let (pane, tab) = requester_ids(&parts);
        let target = args.pane_id.clone().or_else(|| pane.clone());
        let payload = json!({
            "requesterPaneId": pane,
            "requesterTabId": tab,
            "targetPaneId": target,
            "url": args.url,
        });
        let v = round_trip(
            &self.ctx,
            "preview.navigate",
            payload,
            Duration::from_secs(5),
        )
        .await
        .map_err(map_err)?;
        Ok(text_result(&v))
    }

    #[tool(
        description = "Detect the dev-server framework + URL for a project (probes localhost ports)."
    )]
    async fn preview_detect(
        &self,
        Parameters(args): Parameters<DetectArgs>,
    ) -> Result<CallToolResult, McpError> {
        match crate::preview::detector::detect(&self.ctx.app, args.project_path).await {
            Ok(Some(p)) => Ok(text_result(
                &serde_json::to_value(p).unwrap_or(Value::Null),
            )),
            Ok(None) => Ok(text_result(&json!({ "error": "no dev server detected" }))),
            Err(e) => Err(McpError::internal_error(e, None)),
        }
    }

    #[tool(description = "List panes in the caller's tab (or the active tab).")]
    async fn list_panes(
        &self,
        Extension(parts): Extension<axum::http::request::Parts>,
    ) -> Result<CallToolResult, McpError> {
        let (pane, tab) = requester_ids(&parts);
        let payload = json!({
            "requesterPaneId": pane,
            "requesterTabId": tab,
        });
        let v = round_trip(&self.ctx, "panes.list", payload, Duration::from_secs(5))
            .await
            .map_err(map_err)?;
        Ok(text_result(&v))
    }
}

#[tool_handler]
impl ServerHandler for AnySpace {
    fn get_info(&self) -> ServerInfo {
        // ServerInfo / Implementation are #[non_exhaustive]; mutate defaults.
        let mut info = ServerInfo::default();
        info.server_info.name = "anyspace".into();
        info.server_info.version = env!("CARGO_PKG_VERSION").into();
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        info
    }
}

/// Build the Streamable HTTP MCP service. Mounted via `nest_service("/mcp", _)`
/// onto the existing axum router so it inherits the `require_auth` middleware
/// (`Authorization: Bearer <token>`). `StreamableHttpService` enforces its own
/// `allowed_hosts` default `["localhost", "127.0.0.1", "::1"]`, which matches
/// our 127.0.0.1 bind.
pub fn build_service(ctx: AppCtx) -> StreamableHttpService<AnySpace, LocalSessionManager> {
    StreamableHttpService::new(
        move || Ok(AnySpace::new(ctx.clone())),
        Arc::new(LocalSessionManager::default()),
        StreamableHttpServerConfig::default(),
    )
}
