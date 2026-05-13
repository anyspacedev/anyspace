use super::launcher::build_invocation;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchArgs {
    pub agent_command: String,
    #[serde(default)]
    pub task_id: String,
    pub task_title: String,
    pub task_body: String,
    #[serde(default)]
    pub task_column: String,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default)]
    pub env_json: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchPlan {
    pub command: String,
    pub task_file: String,
    pub env: HashMap<String, String>,
}

/// Pure helper: resolves an agent command + writes the task context file.
/// The frontend then passes `command` to its terminal pane (after spawning
/// a shell with `pty_spawn`) and the contents are sent as keystrokes.
#[tauri::command]
pub fn agent_launch(app: tauri::AppHandle, args: LaunchArgs) -> Result<LaunchPlan, String> {
    let inv = build_invocation(
        &app,
        &args.agent_command,
        &args.task_id,
        &args.task_title,
        &args.task_column,
        &args.task_body,
        &args.system_prompt,
    )
    .map_err(|e| format!("{e:#}"))?;

    let task_file_str = inv.task_file.to_string_lossy().to_string();
    let mut env: HashMap<String, String> = HashMap::new();

    // Agent's persisted envJson wins for nothing — ANYSPACE_* are sourced from
    // the task and overwrite any same-named keys the user put in envJson.
    if !args.env_json.trim().is_empty() {
        if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&args.env_json) {
            env.extend(map);
        }
    }

    env.insert("ANYSPACE_TASK_FILE".to_string(), task_file_str.clone());
    env.insert("ANYSPACE_TASK_ID".to_string(), args.task_id);
    env.insert("ANYSPACE_TASK_TITLE".to_string(), args.task_title);
    env.insert("ANYSPACE_TASK_COLUMN".to_string(), args.task_column);

    Ok(LaunchPlan {
        command: inv.command,
        task_file: task_file_str,
        env,
    })
}
