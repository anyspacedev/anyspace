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

// ---- notes ----------------------------------------------------------------

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SaveNoteArgs {
    pub title: String,
    pub body: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub slug: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetNoteArgs {
    pub slug: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListNotesArgs {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SearchNotesArgs {
    pub query: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FindBacklinksArgs {
    pub slug: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct LinkNotesArgs {
    pub from_slug: String,
    pub to_slug: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
}

// ---- kanban ---------------------------------------------------------------

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListKanbanTasksArgs {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateKanbanTaskArgs {
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_path: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateKanbanTaskArgs {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub column: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct MoveKanbanTaskArgs {
    pub id: String,
    pub column: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ordinal: Option<i64>,
}

// ---- teams + messages -----------------------------------------------------

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ListTeamsArgs {
    /// Filter to "active" or "archived". Returns all teams if omitted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadTeamMessagesArgs {
    pub team_id: String,
    /// Only messages with ts > sinceTs are returned. ISO timestamp.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub since_ts: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    /// Recipient: label, @all, or @operator.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    /// message | status | escalation | done
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct SendTeamMessageArgs {
    pub team_id: String,
    /// Recipient: label, @all, or @operator.
    pub to: String,
    pub body: String,
    /// message | status | escalation | done. Defaults to "message".
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    /// Sender label. Defaults to "External MCP".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
}

// ---- terminal -------------------------------------------------------------

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReadPaneOutputArgs {
    pub pane_id: String,
    /// Trailing lines of the active buffer to include (default: viewport size).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_n: Option<u32>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamBroadcastArgs {
    pub team_id: String,
    pub text: String,
    /// Append \n to each pane to actually execute. Default false.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub with_newline: Option<bool>,
}

#[derive(Debug, Deserialize, Serialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamSendToPaneArgs {
    pub team_id: String,
    pub text: String,
    /// Exact paneId; takes precedence over label.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pane_id: Option<String>,
    /// Team-agent label, e.g. "Coordinator 1".
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    /// Append \n to execute. Default false.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub with_newline: Option<bool>,
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

    // ---- notes -----------------------------------------------------------

    #[tool(
        description = "Create or update a project-local knowledge note. Persists to \
                       <projectPath>/.anyspace/knowledge/<slug>.md. Use [[Title]] in body to link \
                       other notes. projectPath defaults to the caller's tab project."
    )]
    async fn save_note(
        &self,
        Parameters(args): Parameters<SaveNoteArgs>,
        Extension(parts): Extension<axum::http::request::Parts>,
    ) -> Result<CallToolResult, McpError> {
        let (pane, tab) = requester_ids(&parts);
        let payload = json!({
            "requesterPaneId": pane,
            "requesterTabId": tab,
            "title": args.title,
            "body": args.body,
            "slug": args.slug,
            "tags": args.tags,
            "projectPath": args.project_path,
        });
        let v = round_trip(&self.ctx, "notes.save", payload, Duration::from_secs(10))
            .await
            .map_err(map_err)?;
        Ok(text_result(&v))
    }

    #[tool(
        description = "Read a single note by slug. Returns title, body, tags, timestamps, plus \
                       backlinks (notes linking here) and outbound refs."
    )]
    async fn get_note(
        &self,
        Parameters(args): Parameters<GetNoteArgs>,
        Extension(parts): Extension<axum::http::request::Parts>,
    ) -> Result<CallToolResult, McpError> {
        let (pane, tab) = requester_ids(&parts);
        let payload = json!({
            "requesterPaneId": pane,
            "requesterTabId": tab,
            "slug": args.slug,
            "projectPath": args.project_path,
        });
        let v = round_trip(&self.ctx, "notes.get", payload, Duration::from_secs(5))
            .await
            .map_err(map_err)?;
        Ok(text_result(&v))
    }

    #[tool(
        description = "List notes newest-first. Returns slug, title, updated timestamp, \
                       backlinkCount, and a short preview per note."
    )]
    async fn list_notes(
        &self,
        Parameters(args): Parameters<ListNotesArgs>,
        Extension(parts): Extension<axum::http::request::Parts>,
    ) -> Result<CallToolResult, McpError> {
        let (pane, tab) = requester_ids(&parts);
        let payload = json!({
            "requesterPaneId": pane,
            "requesterTabId": tab,
            "limit": args.limit,
            "projectPath": args.project_path,
        });
        let v = round_trip(&self.ctx, "notes.list", payload, Duration::from_secs(5))
            .await
            .map_err(map_err)?;
        Ok(text_result(&v))
    }

    #[tool(
        description = "Case-insensitive substring search across note titles, bodies, and tags. \
                       Returns ranked matches (title > tag > body)."
    )]
    async fn search_notes(
        &self,
        Parameters(args): Parameters<SearchNotesArgs>,
        Extension(parts): Extension<axum::http::request::Parts>,
    ) -> Result<CallToolResult, McpError> {
        let (pane, tab) = requester_ids(&parts);
        let payload = json!({
            "requesterPaneId": pane,
            "requesterTabId": tab,
            "query": args.query,
            "limit": args.limit,
            "projectPath": args.project_path,
        });
        let v = round_trip(&self.ctx, "notes.search", payload, Duration::from_secs(5))
            .await
            .map_err(map_err)?;
        Ok(text_result(&v))
    }

    #[tool(
        description = "List notes that link to the given slug via [[wikilinks]]. Each result \
                       includes a short context snippet around the reference."
    )]
    async fn find_backlinks(
        &self,
        Parameters(args): Parameters<FindBacklinksArgs>,
        Extension(parts): Extension<axum::http::request::Parts>,
    ) -> Result<CallToolResult, McpError> {
        let (pane, tab) = requester_ids(&parts);
        let payload = json!({
            "requesterPaneId": pane,
            "requesterTabId": tab,
            "slug": args.slug,
            "projectPath": args.project_path,
        });
        let v = round_trip(
            &self.ctx,
            "notes.find_backlinks",
            payload,
            Duration::from_secs(5),
        )
        .await
        .map_err(map_err)?;
        Ok(text_result(&v))
    }

    #[tool(
        description = "Append a [[toSlug]] reference to fromSlug's body if not already present. \
                       Idempotent — no-op if the link already exists."
    )]
    async fn link_notes(
        &self,
        Parameters(args): Parameters<LinkNotesArgs>,
        Extension(parts): Extension<axum::http::request::Parts>,
    ) -> Result<CallToolResult, McpError> {
        let (pane, tab) = requester_ids(&parts);
        let payload = json!({
            "requesterPaneId": pane,
            "requesterTabId": tab,
            "fromSlug": args.from_slug,
            "toSlug": args.to_slug,
            "projectPath": args.project_path,
        });
        let v = round_trip(&self.ctx, "notes.link", payload, Duration::from_secs(10))
            .await
            .map_err(map_err)?;
        Ok(text_result(&v))
    }

    // ---- kanban ----------------------------------------------------------

    #[tool(
        description = "List kanban tasks. Optional filters: column (todo|in_progress|in_review|complete), \
                       agentId, and a numeric limit."
    )]
    async fn list_kanban_tasks(
        &self,
        Parameters(args): Parameters<ListKanbanTasksArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "column": args.column,
            "agentId": args.agent_id,
            "limit": args.limit,
        });
        let v = round_trip(&self.ctx, "kanban.list", payload, Duration::from_secs(5))
            .await
            .map_err(map_err)?;
        Ok(text_result(&v))
    }

    #[tool(
        description = "Add a task to the kanban board. column defaults to todo. projectPath \
                       defaults to the caller's tab project."
    )]
    async fn create_kanban_task(
        &self,
        Parameters(args): Parameters<CreateKanbanTaskArgs>,
        Extension(parts): Extension<axum::http::request::Parts>,
    ) -> Result<CallToolResult, McpError> {
        let (pane, tab) = requester_ids(&parts);
        let payload = json!({
            "requesterPaneId": pane,
            "requesterTabId": tab,
            "title": args.title,
            "body": args.body,
            "agentId": args.agent_id,
            "column": args.column,
            "projectPath": args.project_path,
        });
        let v = round_trip(&self.ctx, "kanban.create", payload, Duration::from_secs(10))
            .await
            .map_err(map_err)?;
        Ok(text_result(&v))
    }

    #[tool(
        description = "Patch a kanban task by id. Only provided fields are updated; omitted fields \
                       are left untouched. Pass agentId=null to clear the assignment."
    )]
    async fn update_kanban_task(
        &self,
        Parameters(args): Parameters<UpdateKanbanTaskArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "id": args.id,
            "title": args.title,
            "body": args.body,
            "column": args.column,
            "agentId": args.agent_id,
        });
        let v = round_trip(&self.ctx, "kanban.update", payload, Duration::from_secs(10))
            .await
            .map_err(map_err)?;
        Ok(text_result(&v))
    }

    #[tool(
        description = "Move a kanban task to a different column. ordinal defaults to the current \
                       timestamp (drops the task at the end of the destination column)."
    )]
    async fn move_kanban_task(
        &self,
        Parameters(args): Parameters<MoveKanbanTaskArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "id": args.id,
            "column": args.column,
            "ordinal": args.ordinal,
        });
        let v = round_trip(&self.ctx, "kanban.move", payload, Duration::from_secs(5))
            .await
            .map_err(map_err)?;
        Ok(text_result(&v))
    }

    // ---- teams + messages ------------------------------------------------

    #[tool(
        description = "List teams with status, project path, goal, tabId, and agent count. \
                       Pass status=active|archived to filter."
    )]
    async fn list_teams(
        &self,
        Parameters(args): Parameters<ListTeamsArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({ "status": args.status });
        let v = round_trip(&self.ctx, "teams.list", payload, Duration::from_secs(5))
            .await
            .map_err(map_err)?;
        Ok(text_result(&v))
    }

    #[tool(
        description = "On-demand read of a team's MESSAGES.md log (inter-agent + @operator chat). \
                       Returns parsed messages newest-first. Filter by sender/recipient/type or \
                       use sinceTs to fetch only newer messages."
    )]
    async fn read_team_messages(
        &self,
        Parameters(args): Parameters<ReadTeamMessagesArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "teamId": args.team_id,
            "sinceTs": args.since_ts,
            "from": args.from,
            "to": args.to,
            "type": args.r#type,
            "limit": args.limit,
        });
        let v = round_trip(&self.ctx, "messages.read", payload, Duration::from_secs(5))
            .await
            .map_err(map_err)?;
        Ok(text_result(&v))
    }

    #[tool(
        description = "Append a message to a team's MESSAGES.md log. Recipients can be a team-agent \
                       label, @all, or @operator. Visible to all team agents and to the operator inbox."
    )]
    async fn send_team_message(
        &self,
        Parameters(args): Parameters<SendTeamMessageArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "teamId": args.team_id,
            "to": args.to,
            "body": args.body,
            "type": args.r#type,
            "from": args.from,
        });
        let v = round_trip(&self.ctx, "messages.send", payload, Duration::from_secs(10))
            .await
            .map_err(map_err)?;
        Ok(text_result(&v))
    }

    // ---- terminal --------------------------------------------------------

    #[tool(
        description = "Return what is currently on a terminal pane's screen — including TUI apps \
                       (claude code, vim, top) that never finish a command. Reads the live xterm \
                       buffer plus metadata about the most recent finished OSC 133 command when one \
                       exists. Read-only."
    )]
    async fn read_pane_output(
        &self,
        Parameters(args): Parameters<ReadPaneOutputArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "paneId": args.pane_id,
            "lastN": args.last_n,
        });
        let v = round_trip(&self.ctx, "terminal.read", payload, Duration::from_secs(5))
            .await
            .map_err(map_err)?;
        Ok(text_result(&v))
    }

    #[tool(
        description = "Write text into every terminal pane of a team. By default does NOT press \
                       Enter — bytes sit at each prompt for the operator to review. Set \
                       withNewline=true to execute immediately in every pane."
    )]
    async fn team_broadcast(
        &self,
        Parameters(args): Parameters<TeamBroadcastArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "teamId": args.team_id,
            "text": args.text,
            "withNewline": args.with_newline.unwrap_or(false),
        });
        let v = round_trip(
            &self.ctx,
            "terminal.broadcast",
            payload,
            Duration::from_secs(5),
        )
        .await
        .map_err(map_err)?;
        Ok(text_result(&v))
    }

    #[tool(
        description = "Write text into one specific team pane, addressed by paneId or by the \
                       team-agent label (e.g. \"Coordinator 1\"). By default does NOT press Enter. \
                       Set withNewline=true to execute."
    )]
    async fn team_send_to_pane(
        &self,
        Parameters(args): Parameters<TeamSendToPaneArgs>,
    ) -> Result<CallToolResult, McpError> {
        let payload = json!({
            "teamId": args.team_id,
            "text": args.text,
            "paneId": args.pane_id,
            "label": args.label,
            "withNewline": args.with_newline.unwrap_or(false),
        });
        let v = round_trip(
            &self.ctx,
            "terminal.send_to_pane",
            payload,
            Duration::from_secs(5),
        )
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
