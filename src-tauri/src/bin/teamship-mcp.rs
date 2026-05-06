// Teamship MCP stdio server. Spawned by Claude Code (or any MCP-aware client)
// and proxies a curated set of tools to the loopback Code-Agent Preview API
// running inside the main Teamship app.
//
// Required env (set automatically when run from a Code-Agent terminal in
// Teamship; pass through manually if you launch this binary outside the app):
//   TEAMSHIP_API_URL    — e.g. http://127.0.0.1:NNNN
//   TEAMSHIP_API_TOKEN  — bearer token
//   TEAMSHIP_PANE_ID    — caller's pane id
//
// Stdio JSON-RPC framing is handled entirely by rmcp.

use std::sync::Arc;

use anyhow::Result;
use base64::Engine;
use rmcp::{
    ErrorData as McpError, ServerHandler, ServiceExt,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, Content, ServerCapabilities, ServerInfo},
    schemars,
    tool, tool_handler, tool_router,
    transport::stdio,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone)]
struct Teamship {
    http: Arc<reqwest::Client>,
    base: String,
    token: String,
    pane: String,
    // Read by the #[tool_handler] macro at dispatch time; rustc's dead-code
    // analysis can't see through the macro expansion.
    #[allow(dead_code)]
    tool_router: ToolRouter<Teamship>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct OpenArgs {
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    project_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    direction: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    engine: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ScreenshotArgs {
    #[serde(skip_serializing_if = "Option::is_none")]
    pane_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    full_page: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct ClickArgs {
    selector: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pane_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct FillArgs {
    selector: String,
    value: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    submit: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pane_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct NavigateArgs {
    url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pane_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
struct DetectArgs {
    project_path: String,
}

#[tool_router]
impl Teamship {
    #[tool(
        description = "Open or refocus the live preview pane next to this terminal. \
                       Pass projectPath to auto-detect a dev server, or url for a specific page."
    )]
    async fn preview_open(
        &self,
        Parameters(args): Parameters<OpenArgs>,
    ) -> Result<CallToolResult, McpError> {
        let v = self.post("/v1/preview/open", &args).await?;
        Ok(text_result(&v))
    }

    #[tool(
        description = "Capture the live preview pane to a PNG file. Returns both an inline image \
                       (for vision-capable clients) and the on-disk path."
    )]
    async fn preview_screenshot(
        &self,
        Parameters(args): Parameters<ScreenshotArgs>,
    ) -> Result<CallToolResult, McpError> {
        let resp = self.post("/v1/preview/screenshot", &args).await?;
        let mut blocks = vec![text_block(&resp)];
        if let Some(path) = resp.get("path").and_then(|p| p.as_str()) {
            match tokio::fs::read(path).await {
                Ok(bytes) => {
                    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);
                    blocks.push(Content::image(b64, "image/png"));
                }
                Err(e) => {
                    eprintln!("[teamship-mcp] screenshot read failed for {path}: {e}");
                }
            }
        }
        Ok(CallToolResult::success(blocks))
    }

    #[tool(description = "Click an element in the live preview by CSS selector.")]
    async fn preview_click(
        &self,
        Parameters(args): Parameters<ClickArgs>,
    ) -> Result<CallToolResult, McpError> {
        let v = self.post("/v1/preview/click", &args).await?;
        Ok(text_result(&v))
    }

    #[tool(
        description = "Fill an input/textarea by CSS selector and dispatch input + change events. \
                       Set submit=true to also requestSubmit() the enclosing form."
    )]
    async fn preview_fill(
        &self,
        Parameters(args): Parameters<FillArgs>,
    ) -> Result<CallToolResult, McpError> {
        let v = self.post("/v1/preview/fill", &args).await?;
        Ok(text_result(&v))
    }

    #[tool(description = "Navigate the live preview to a different URL.")]
    async fn preview_navigate(
        &self,
        Parameters(args): Parameters<NavigateArgs>,
    ) -> Result<CallToolResult, McpError> {
        let v = self.post("/v1/preview/navigate", &args).await?;
        Ok(text_result(&v))
    }

    #[tool(description = "Detect the dev-server framework + URL for a project (probes localhost ports).")]
    async fn preview_detect(
        &self,
        Parameters(args): Parameters<DetectArgs>,
    ) -> Result<CallToolResult, McpError> {
        let path = format!(
            "/v1/preview/detect?projectPath={}",
            urlencode(&args.project_path)
        );
        let v = self.get(&path).await?;
        Ok(text_result(&v))
    }

    #[tool(description = "List panes in the caller's tab (or the active tab).")]
    async fn list_panes(&self) -> Result<CallToolResult, McpError> {
        let v = self.get("/v1/panes").await?;
        Ok(text_result(&v))
    }
}

#[tool_handler]
impl ServerHandler for Teamship {
    fn get_info(&self) -> ServerInfo {
        // Both ServerInfo and Implementation are #[non_exhaustive], so we
        // build them by mutating defaults rather than struct-update syntax.
        let mut info = ServerInfo::default();
        info.server_info.name = "teamship".into();
        info.server_info.version = env!("CARGO_PKG_VERSION").into();
        info.capabilities = ServerCapabilities::builder().enable_tools().build();
        info
    }
}

impl Teamship {
    async fn post<T: Serialize>(&self, path: &str, body: &T) -> Result<Value, McpError> {
        if self.base.is_empty() {
            return Err(McpError::internal_error(
                "TEAMSHIP_API_URL is not set",
                None,
            ));
        }
        let resp = self
            .http
            .post(format!("{}{}", self.base, path))
            .bearer_auth(&self.token)
            .header("X-Pane-Id", &self.pane)
            .json(body)
            .send()
            .await
            .map_err(|e| McpError::internal_error(format!("POST {path}: {e}"), None))?;
        deserialize_or_error("POST", path, resp).await
    }

    async fn get(&self, path: &str) -> Result<Value, McpError> {
        if self.base.is_empty() {
            return Err(McpError::internal_error(
                "TEAMSHIP_API_URL is not set",
                None,
            ));
        }
        let resp = self
            .http
            .get(format!("{}{}", self.base, path))
            .bearer_auth(&self.token)
            .header("X-Pane-Id", &self.pane)
            .send()
            .await
            .map_err(|e| McpError::internal_error(format!("GET {path}: {e}"), None))?;
        deserialize_or_error("GET", path, resp).await
    }
}

async fn deserialize_or_error(
    method: &str,
    path: &str,
    resp: reqwest::Response,
) -> Result<Value, McpError> {
    let status = resp.status();
    let text = resp
        .text()
        .await
        .map_err(|e| McpError::internal_error(format!("{method} {path}: read body: {e}"), None))?;
    let parsed: Value = if text.is_empty() {
        Value::Null
    } else {
        serde_json::from_str(&text).unwrap_or_else(|_| Value::String(text.clone()))
    };
    if !status.is_success() {
        return Err(McpError::internal_error(
            format!("{method} {path} -> {status}: {parsed}"),
            None,
        ));
    }
    Ok(parsed)
}

fn text_block(v: &Value) -> Content {
    let s = serde_json::to_string_pretty(v)
        .unwrap_or_else(|_| v.to_string());
    Content::text(s)
}

fn text_result(v: &Value) -> CallToolResult {
    CallToolResult::success(vec![text_block(v)])
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[tokio::main]
async fn main() -> Result<()> {
    let base = std::env::var("TEAMSHIP_API_URL").unwrap_or_default();
    let token = std::env::var("TEAMSHIP_API_TOKEN").unwrap_or_default();
    let pane = std::env::var("TEAMSHIP_PANE_ID").unwrap_or_default();
    if base.is_empty() || token.is_empty() {
        eprintln!(
            "[teamship-mcp] missing TEAMSHIP_API_URL / TEAMSHIP_API_TOKEN — preview tools will fail."
        );
    }
    let svc = Teamship {
        http: Arc::new(reqwest::Client::new()),
        base,
        token,
        pane,
        tool_router: Teamship::tool_router(),
    };
    let server = svc.serve(stdio()).await?;
    server.waiting().await?;
    Ok(())
}
