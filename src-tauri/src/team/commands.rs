use super::watcher::{start_messages_watcher, start_rpc_watcher};
use super::{TeamManager, TEAM_DIR_PREFIX, TMSG_SCRIPT};
use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamPaths {
    pub team_dir: String,
    pub board_path: String,
    pub messages_path: String,
    pub prompts_dir: String,
    pub rpc_dir: String,
    pub tmsg_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TeamInitArgs {
    pub team_id: String,
    pub project_path: String,
    pub board_markdown: String,
}

/// Materialize `<projectPath>/.teamship/teams/<teamId>/` with empty BOARD/MESSAGES files
/// and the shared tmsg.sh script. Idempotent: existing BOARD content is preserved.
#[tauri::command]
pub fn team_init(args: TeamInitArgs) -> Result<TeamPaths, String> {
    init_team_dir(&args.team_id, &args.project_path, &args.board_markdown).map_err(|e| format!("{e:#}"))
}

fn init_team_dir(team_id: &str, project_path: &str, board_markdown: &str) -> anyhow::Result<TeamPaths> {
    let project = PathBuf::from(project_path);
    if !project.is_dir() {
        anyhow::bail!("project path is not a directory: {}", project.display());
    }
    let team_dir = project.join(TEAM_DIR_PREFIX).join(team_id);
    let prompts_dir = team_dir.join(".prompts");
    let rpc_dir = team_dir.join(".rpc");
    let consumed_dir = team_dir.join(".consumed");

    for d in [&team_dir, &prompts_dir, &rpc_dir, &consumed_dir] {
        std::fs::create_dir_all(d).with_context(|| format!("create {}", d.display()))?;
    }

    let board_path = team_dir.join("BOARD.md");
    let messages_path = team_dir.join("MESSAGES.md");
    if !board_path.exists() {
        std::fs::write(&board_path, board_markdown).context("write BOARD.md")?;
    }
    if !messages_path.exists() {
        std::fs::write(&messages_path, "").context("write MESSAGES.md")?;
    }

    // tmsg.sh is identical for every team; write it once to a shared
    // integration root so updates between releases propagate cleanly.
    let tmsg_path = shared_tmsg_path()?;
    std::fs::write(&tmsg_path, TMSG_SCRIPT).context("write tmsg.sh")?;

    Ok(TeamPaths {
        team_dir: team_dir.to_string_lossy().into_owned(),
        board_path: board_path.to_string_lossy().into_owned(),
        messages_path: messages_path.to_string_lossy().into_owned(),
        prompts_dir: prompts_dir.to_string_lossy().into_owned(),
        rpc_dir: rpc_dir.to_string_lossy().into_owned(),
        tmsg_path: tmsg_path.to_string_lossy().into_owned(),
    })
}

fn shared_tmsg_path() -> anyhow::Result<PathBuf> {
    let dir = std::env::temp_dir().join("teamship-shell-integration");
    std::fs::create_dir_all(&dir).context("create integration dir")?;
    Ok(dir.join("tmsg.sh"))
}

#[tauri::command]
pub fn team_watch_start(
    app: AppHandle,
    team_id: String,
    team_dir: String,
    manager: State<'_, TeamManager>,
) -> Result<(), String> {
    if manager.watchers.contains_key(&team_id) {
        return Ok(());
    }
    let dir = PathBuf::from(&team_dir);
    if !dir.is_dir() {
        return Err(format!("team dir does not exist: {team_dir}"));
    }
    let messages_path = dir.join("MESSAGES.md");
    let rpc_dir = dir.join(".rpc");
    let messages_watcher = start_messages_watcher(team_id.clone(), messages_path, app.clone())?;
    let rpc_watcher = start_rpc_watcher(team_id.clone(), rpc_dir, app)?;
    manager
        .watchers
        .insert(team_id, vec![messages_watcher, rpc_watcher]);
    Ok(())
}

#[tauri::command]
pub fn team_watch_stop(team_id: String, manager: State<'_, TeamManager>) -> Result<(), String> {
    manager.watchers.remove(&team_id);
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcReplyArgs {
    pub team_dir: String,
    pub request_id: String,
    pub response: String,
}

/// Frontend writes the `<uuid>.res` file that unblocks the agent's `tmsg pane …` call.
#[tauri::command]
pub fn team_rpc_reply(args: RpcReplyArgs) -> Result<(), String> {
    let dir = Path::new(&args.team_dir).join(".rpc");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let res_path = dir.join(format!("{}.res", args.request_id));
    let tmp = dir.join(format!("{}.res.tmp", args.request_id));
    std::fs::write(&tmp, &args.response).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &res_path).map_err(|e| e.to_string())?;
    // Best-effort: clear the corresponding .req now so we don't refire on resume.
    let req_path = dir.join(format!("{}.req", args.request_id));
    let _ = std::fs::remove_file(&req_path);
    Ok(())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingRpc {
    pub request_id: String,
    pub req_path: String,
    pub payload: String,
}

/// On app start (or team resume), surface any leftover .req files that the
/// frontend hasn't responded to yet so we don't drop in-flight requests.
#[tauri::command]
pub fn team_rpc_drain(team_dir: String) -> Result<Vec<PendingRpc>, String> {
    let dir = Path::new(&team_dir).join(".rpc");
    if !dir.is_dir() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("req") {
            continue;
        }
        let id = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        // Skip if the .res already exists.
        if dir.join(format!("{id}.res")).exists() {
            continue;
        }
        let payload = std::fs::read_to_string(&path).unwrap_or_default();
        out.push(PendingRpc {
            request_id: id,
            req_path: path.to_string_lossy().into_owned(),
            payload,
        });
    }
    Ok(out)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WritePromptArgs {
    pub team_dir: String,
    pub label: String,
    pub body: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WritePromptResult {
    pub path: String,
}

/// Write a per-agent prompt file under `<teamDir>/.prompts/<labelSlug>.md`.
/// The team launcher passes this path to `agent_launch` as the {task_file}
/// substitution target so each agent reads its own role+goal+skills bundle.
#[tauri::command]
pub fn team_write_prompt(args: WritePromptArgs) -> Result<WritePromptResult, String> {
    let dir = Path::new(&args.team_dir).join(".prompts");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let slug = label_slug(&args.label);
    let path = dir.join(format!("{slug}.md"));
    std::fs::write(&path, args.body).map_err(|e| e.to_string())?;
    Ok(WritePromptResult {
        path: path.to_string_lossy().into_owned(),
    })
}

fn label_slug(label: &str) -> String {
    let mut out = String::with_capacity(label.len());
    for ch in label.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            out.push(ch);
        } else if ch == ' ' {
            out.push('_');
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        out.push_str("agent");
    }
    out
}
