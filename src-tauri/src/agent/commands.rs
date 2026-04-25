use super::launcher::build_invocation;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchArgs {
    pub agent_command: String,
    pub task_title: String,
    pub task_body: String,
    #[serde(default)]
    pub system_prompt: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchPlan {
    pub command: String,
    pub task_file: String,
    pub env: std::collections::HashMap<String, String>,
}

/// Pure helper: resolves an agent command + writes the task context file.
/// The frontend then passes `command` to its terminal pane (after spawning
/// a shell with `pty_spawn`) and the contents are sent as keystrokes.
#[tauri::command]
pub fn agent_launch(args: LaunchArgs) -> Result<LaunchPlan, String> {
    let inv = build_invocation(
        &args.agent_command,
        &args.task_title,
        &args.task_body,
        &args.system_prompt,
    )
    .map_err(|e| format!("{e:#}"))?;

    let mut env = std::collections::HashMap::new();
    env.insert(
        "TEAMSHIP_TASK_FILE".to_string(),
        inv.task_file.to_string_lossy().to_string(),
    );
    Ok(LaunchPlan {
        command: inv.command,
        task_file: inv.task_file.to_string_lossy().to_string(),
        env,
    })
}
