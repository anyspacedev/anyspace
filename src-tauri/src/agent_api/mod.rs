pub mod auth;
pub mod commands;
pub mod handlers;
pub mod server;
pub mod state;

pub use state::AgentApiState;

use std::path::PathBuf;

/// Locate the bundled `teamship-mcp` binary that ships next to the main app
/// executable. Built by Cargo into the same `target/<profile>/` directory as
/// the main binary in development; placed alongside the main binary in
/// release bundles via Tauri's externalBin (TODO — see comment in
/// `src/lib/agentLauncher.ts`).
///
/// Returns `Ok(path)` if the file exists; returns an error otherwise so the
/// caller can degrade gracefully (the Settings UI shows "(building…)" rather
/// than crashing).
pub fn resolve_mcp_binary() -> anyhow::Result<PathBuf> {
    let exe = std::env::current_exe()?;
    let dir = exe
        .parent()
        .ok_or_else(|| anyhow::anyhow!("current_exe has no parent: {}", exe.display()))?;
    let name = if cfg!(windows) {
        "teamship-mcp.exe"
    } else {
        "teamship-mcp"
    };
    let path = dir.join(name);
    if !path.exists() {
        anyhow::bail!("teamship-mcp binary not found at {}", path.display());
    }
    Ok(path)
}
