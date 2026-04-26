use anyhow::{Context, Result};
use std::path::PathBuf;

pub struct AgentInvocation {
    pub command: String,
    pub task_file: PathBuf,
}

pub fn build_invocation(
    agent_command: &str,
    task_id: &str,
    task_title: &str,
    task_column: &str,
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

    // {task_file} is a path we control — it's safe to splice unquoted so users
    // can compose it inside `"$(cat {task_file})"`. Everything else is arbitrary
    // user-supplied text; single-quote-escape it before substitution so titles
    // with spaces / quotes can't break out of the command line.
    let task_file_str = task_file.to_string_lossy().to_string();
    let cmd = agent_command
        .replace("{task_file}", &task_file_str)
        .replace("{task_id}", &shell_single_quote(task_id))
        .replace("{task_title}", &shell_single_quote(task_title))
        .replace("{task_column}", &shell_single_quote(task_column));
    Ok(AgentInvocation { command: cmd, task_file })
}

/// POSIX-safe single-quoting: wrap in `'…'` and replace any embedded `'` with
/// `'\''` (close, escape, reopen). Works in bash/zsh/sh.
fn shell_single_quote(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    out.push('\'');
    for ch in value.chars() {
        if ch == '\'' {
            out.push_str("'\\''");
        } else {
            out.push(ch);
        }
    }
    out.push('\'');
    out
}
