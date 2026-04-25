use anyhow::{Context, Result};
use std::path::PathBuf;

pub struct AgentInvocation {
    pub command: String,
    pub task_file: PathBuf,
}

pub fn build_invocation(
    agent_command: &str,
    task_title: &str,
    task_body: &str,
    system_prompt: &str,
) -> Result<AgentInvocation> {
    let dir = std::env::temp_dir().join("teamship-tasks");
    std::fs::create_dir_all(&dir).context("create task dir")?;
    let task_file = dir.join(format!("task-{}.md", uuid::Uuid::new_v4()));
    let contents = format!(
        "# {title}\n\n## Body\n{body}\n\n## System\n{system}\n",
        title = task_title,
        body = task_body,
        system = system_prompt,
    );
    std::fs::write(&task_file, contents).context("write task file")?;

    // Replace placeholders in the agent command template, exposing both
    // an env var and a {task_file} substitution.
    let task_file_str = task_file.to_string_lossy().to_string();
    let cmd = agent_command.replace("{task_file}", &task_file_str);
    Ok(AgentInvocation { command: cmd, task_file })
}
