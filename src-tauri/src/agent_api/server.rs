use super::handlers;
use super::mcp;
use super::state::AgentApiState;
use axum::{
    extract::State,
    http::{HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Router,
};
use std::net::TcpListener as StdTcpListener;
use tauri::AppHandle;
use tokio::net::TcpListener;
use tower_http::limit::RequestBodyLimitLayer;

/// Shared context for handlers and middleware.
#[derive(Clone)]
pub struct AppCtx {
    pub api: AgentApiState,
    pub app: AppHandle,
}

/// Bind a 127.0.0.1:0 listener synchronously so the assigned port is known by
/// the time `setup` returns. The async `serve` task is spawned afterwards.
pub fn bind_local() -> std::io::Result<(StdTcpListener, u16)> {
    let listener = StdTcpListener::bind(("127.0.0.1", 0))?;
    listener.set_nonblocking(true)?;
    let port = listener.local_addr()?.port();
    Ok((listener, port))
}

pub async fn serve(api: AgentApiState, app: AppHandle, std_listener: StdTcpListener) {
    let listener = match TcpListener::from_std(std_listener) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[agent_api] from_std failed: {e:?}");
            return;
        }
    };
    let ctx = AppCtx { api, app };
    let mcp_service = mcp::build_service(ctx.clone());
    let router = Router::new()
        .route("/v1/preview/detect", get(handlers::preview_detect))
        .route("/v1/panes", get(handlers::list_panes))
        .route("/v1/preview/open", post(handlers::preview_open))
        .route("/v1/preview/screenshot", post(handlers::preview_screenshot))
        .route("/v1/preview/click", post(handlers::preview_click))
        .route("/v1/preview/fill", post(handlers::preview_fill))
        .route("/v1/preview/navigate", post(handlers::preview_navigate))
        // Streamable HTTP MCP. Tools read X-Pane-Id / X-Tab-Id from the
        // request via Extension<http::request::Parts>. Inherits require_auth
        // because Router::layer wraps every route, including nested services.
        .nest_service("/mcp", mcp_service)
        // 8 MB cap covers eval results and full-page screenshot metadata; raw
        // PNG bytes return as file paths, not bodies.
        .layer(RequestBodyLimitLayer::new(8 * 1024 * 1024))
        .layer(middleware::from_fn_with_state(ctx.clone(), require_auth))
        .with_state(ctx);

    if let Err(e) = axum::serve(listener, router).await {
        eprintln!("[agent_api] serve error: {e:?}");
    }
}

/// Bearer-token check. Loopback bind plus this is the entire auth surface
/// for now; pane-id validation is layered on per-handler in M2.
async fn require_auth(
    State(ctx): State<AppCtx>,
    headers: HeaderMap,
    req: axum::extract::Request,
    next: Next,
) -> Response {
    let expected = format!("Bearer {}", ctx.api.token);
    match headers.get("authorization").and_then(|v| v.to_str().ok()) {
        Some(v) if v == expected => next.run(req).await,
        _ => (
            StatusCode::UNAUTHORIZED,
            "missing or invalid Authorization",
        )
            .into_response(),
    }
}
