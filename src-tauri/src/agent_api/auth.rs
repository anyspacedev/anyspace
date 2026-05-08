use anyhow::Context;
use rand::{rngs::OsRng, RngCore};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, Manager};

/// 32 random bytes hex-encoded (256-bit entropy).
pub fn mint_token() -> String {
    let mut buf = [0u8; 32];
    OsRng.fill_bytes(&mut buf);
    hex::encode(buf)
}

#[derive(Debug, Serialize, Deserialize)]
struct PersistedToken {
    token: String,
    /// Unix epoch seconds — surfaced to Settings so users can see when the
    /// current token was minted before deciding to rotate.
    created_at: u64,
}

fn token_file(app: &AppHandle) -> anyhow::Result<std::path::PathBuf> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| anyhow::anyhow!("app_config_dir: {e}"))?;
    std::fs::create_dir_all(&dir).context("create config dir")?;
    Ok(dir.join("agent_api.json"))
}

#[cfg(unix)]
fn restrict_perms(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
}
#[cfg(not(unix))]
fn restrict_perms(_path: &Path) {}

/// Read the persisted token from disk, or mint and write a fresh one. Same
/// token is reused across restarts so long-lived agent shells don't need to
/// re-export ANYSPACE_API_TOKEN every session.
pub fn load_or_mint(app: &AppHandle) -> String {
    match load_or_mint_inner(app) {
        Ok(tok) => tok,
        Err(e) => {
            eprintln!("[agent_api] persistent token unavailable ({e:#}) — using ephemeral");
            mint_token()
        }
    }
}

fn load_or_mint_inner(app: &AppHandle) -> anyhow::Result<String> {
    let path = token_file(app)?;
    if path.exists() {
        let body = std::fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
        if let Ok(p) = serde_json::from_str::<PersistedToken>(&body) {
            if !p.token.is_empty() {
                return Ok(p.token);
            }
        }
    }
    let token = mint_token();
    let payload = PersistedToken {
        token: token.clone(),
        created_at: now_secs(),
    };
    let json = serde_json::to_string_pretty(&payload)?;
    std::fs::write(&path, json).with_context(|| format!("write {}", path.display()))?;
    restrict_perms(&path);
    Ok(token)
}

/// Mint a new token and persist it, returning the new value. Invalidates any
/// previously-issued bearer token — long-lived agent shells need to re-import
/// ANYSPACE_API_TOKEN after a rotation.
pub fn rotate(app: &AppHandle) -> anyhow::Result<String> {
    let path = token_file(app)?;
    let token = mint_token();
    let payload = PersistedToken {
        token: token.clone(),
        created_at: now_secs(),
    };
    let json = serde_json::to_string_pretty(&payload)?;
    std::fs::write(&path, json).with_context(|| format!("write {}", path.display()))?;
    restrict_perms(&path);
    Ok(token)
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}
