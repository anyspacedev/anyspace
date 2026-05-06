use anyhow::{Context, Result};
use std::path::PathBuf;

/// Appended to every agent task file. Tells the model how to reach the
/// loopback HTTP server that drives the live preview pane and returns
/// screenshot paths suitable for the agent's native image Read.
const AGENT_API_HINT: &str = r#"## Code Agent Preview API

A loopback HTTP server lets you drive the live preview pane and capture
screenshots without operator clicks. These env vars are set automatically
when running inside Teamship:

- `$TEAMSHIP_API_URL`   — base URL (e.g. http://127.0.0.1:NNNN)
- `$TEAMSHIP_API_TOKEN` — bearer token, send as `Authorization: Bearer <token>`
- `$TEAMSHIP_PANE_ID`   — your own pane id, send as `X-Pane-Id: <pane-id>`

If `$TEAMSHIP_API_URL` is unset, the API is unavailable and you should
fall back to operator-assisted workflows.

### Common operations

Open / refocus the live preview alongside this terminal:

```sh
curl -sX POST \
  -H "Authorization: Bearer $TEAMSHIP_API_TOKEN" \
  -H "X-Pane-Id: $TEAMSHIP_PANE_ID" \
  -H "content-type: application/json" \
  -d "{\"projectPath\":\"$PWD\"}" \
  "$TEAMSHIP_API_URL/v1/preview/open"
```

Screenshot the preview after making UI changes; the response's `path`
points at a PNG you can feed to your own image-Read tool to inspect:

```sh
curl -sX POST \
  -H "Authorization: Bearer $TEAMSHIP_API_TOKEN" \
  -H "X-Pane-Id: $TEAMSHIP_PANE_ID" \
  -H "content-type: application/json" \
  -d '{}' \
  "$TEAMSHIP_API_URL/v1/preview/screenshot"
```

Drive the preview programmatically (same auth headers):

```
POST /v1/preview/click     {"selector":"button.submit"}
POST /v1/preview/fill      {"selector":"input[name=email]","value":"x@y.z","submit":true}
POST /v1/preview/navigate  {"url":"http://localhost:5173/about"}
GET  /v1/preview/detect?projectPath=$PWD
GET  /v1/panes
```

Recommended loop after editing UI source: edit → wait for HMR → screenshot
→ Read the screenshot path → reason about the result → iterate.
"#;

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
        "# {title}\n\n## Body\n{body}\n\n## System\n{system}\n\n{api}",
        title = task_title,
        body = task_body,
        system = system_prompt,
        api = AGENT_API_HINT,
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
