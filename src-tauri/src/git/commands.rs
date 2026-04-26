use serde::Deserialize;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitStatusArgs {
    pub dir: String,
}

/// Returns `{ <absolute path>: <status letter> }` for files in the repo
/// containing `dir`. Status letter is one of M / A / D / R / C / ? / U.
/// Returns an empty map silently when `dir` isn't a git repo or git
/// isn't installed — UI treats this as "no decorations available".
#[tauri::command]
pub async fn git_status(args: GitStatusArgs) -> Result<HashMap<String, String>, String> {
    tokio::task::spawn_blocking(move || run_git_status(&args.dir))
        .await
        .map_err(|e| format!("join: {e}"))?
}

fn run_git_status(dir: &str) -> Result<HashMap<String, String>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(dir)
        .arg("status")
        .arg("--porcelain=v1")
        .arg("-z")
        .output();

    let output = match output {
        Ok(o) => o,
        Err(_) => return Ok(HashMap::new()), // git not on PATH
    };

    if !output.status.success() {
        // Most common: dir isn't inside a git repo. Treat as empty.
        return Ok(HashMap::new());
    }

    // Resolve dir to the repo's working tree root so absolute paths in
    // the result line up with what callers (which know absolute paths)
    // can look up directly.
    let toplevel = Command::new("git")
        .arg("-C")
        .arg(dir)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .output()
        .ok()
        .and_then(|o| {
            if o.status.success() {
                String::from_utf8(o.stdout).ok().map(|s| s.trim().to_string())
            } else {
                None
            }
        })
        .unwrap_or_else(|| dir.to_string());

    let root = PathBuf::from(toplevel);
    let mut result: HashMap<String, String> = HashMap::new();
    let mut iter = output.stdout.split(|&b| b == 0).peekable();

    while let Some(entry) = iter.next() {
        if entry.len() < 3 {
            continue;
        }
        let xy = &entry[0..2];
        let filename = match std::str::from_utf8(&entry[3..]) {
            Ok(s) => s,
            Err(_) => continue,
        };
        if filename.is_empty() {
            continue;
        }

        // Renames / copies have a second NUL-delimited filename (the old
        // name) following the entry — consume it without mapping.
        if xy[0] == b'R' || xy[0] == b'C' {
            iter.next();
        }

        let letter = if xy[0] != b' ' && xy[0] != b'?' {
            xy[0]
        } else if xy[1] != b' ' {
            xy[1]
        } else {
            xy[0]
        };
        let status = match letter {
            b'M' => "M",
            b'A' => "A",
            b'D' => "D",
            b'R' => "R",
            b'C' => "C",
            b'?' => "?",
            b'U' => "U",
            _ => continue,
        };

        let abs = root.join(filename);
        if let Some(s) = abs.to_str() {
            result.insert(s.to_string(), status.to_string());
        }
    }

    Ok(result)
}
