use anyhow::{Context, Result};
use serde::Deserialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Appended to every agent task file. Tells the model how to reach the
/// loopback HTTP server that drives the live preview pane and returns
/// screenshot paths suitable for the agent's native image Read.
const AGENT_API_HINT: &str = r#"## Code Agent Preview API

A loopback HTTP server lets you drive the live preview pane and capture
screenshots without operator clicks. These env vars are set automatically
when running inside AnySpace:

- `$ANYSPACE_API_URL`   — base URL (e.g. http://127.0.0.1:NNNN)
- `$ANYSPACE_API_TOKEN` — bearer token, send as `Authorization: Bearer <token>`
- `$ANYSPACE_PANE_ID`   — your own pane id, send as `X-Pane-Id: <pane-id>`

If `$ANYSPACE_API_URL` is unset, the API is unavailable and you should
fall back to operator-assisted workflows.

### Common operations

Open / refocus the live preview alongside this terminal:

```sh
curl -sX POST \
  -H "Authorization: Bearer $ANYSPACE_API_TOKEN" \
  -H "X-Pane-Id: $ANYSPACE_PANE_ID" \
  -H "content-type: application/json" \
  -d "{\"projectPath\":\"$PWD\"}" \
  "$ANYSPACE_API_URL/v1/preview/open"
```

Screenshot the preview after making UI changes; the response's `path`
points at a PNG you can feed to your own image-Read tool to inspect:

```sh
curl -sX POST \
  -H "Authorization: Bearer $ANYSPACE_API_TOKEN" \
  -H "X-Pane-Id: $ANYSPACE_PANE_ID" \
  -H "content-type: application/json" \
  -d '{}' \
  "$ANYSPACE_API_URL/v1/preview/screenshot"
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

/// Subset of `settings.prompts.overrides` that this module honors at task-file
/// assembly time. Keys are camelCase to match the TS-side `PromptId` strings.
#[derive(Default, Debug, Deserialize)]
struct PromptOverrides {
    #[serde(default, rename = "agentApiHint")]
    agent_api_hint: Option<String>,
}

fn load_prompt_overrides(app: &AppHandle) -> PromptOverrides {
    let Some(dir) = app.path().app_config_dir().ok() else {
        return PromptOverrides::default();
    };
    let path = dir.join("settings.json");
    let Ok(text) = std::fs::read_to_string(&path) else {
        return PromptOverrides::default();
    };
    let Ok(root) = serde_json::from_str::<serde_json::Value>(&text) else {
        return PromptOverrides::default();
    };
    let Some(overrides) = root
        .get("prompts")
        .and_then(|p| p.get("overrides"))
    else {
        return PromptOverrides::default();
    };
    serde_json::from_value::<PromptOverrides>(overrides.clone()).unwrap_or_default()
}

pub fn build_invocation(
    app: &AppHandle,
    agent_command: &str,
    task_id: &str,
    task_title: &str,
    task_column: &str,
    task_body: &str,
    system_prompt: &str,
) -> Result<AgentInvocation> {
    let overrides = load_prompt_overrides(app);
    let api_hint = overrides
        .agent_api_hint
        .as_deref()
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(AGENT_API_HINT);

    let dir = std::env::temp_dir().join("anyspace-tasks");
    std::fs::create_dir_all(&dir).context("create task dir")?;
    let task_file = dir.join(format!("task-{}.md", uuid::Uuid::new_v4()));
    let contents = format!(
        "# {title}\n\n## Body\n{body}\n\n## System\n{system}\n\n{api}",
        title = task_title,
        body = task_body,
        system = system_prompt,
        api = api_hint,
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
