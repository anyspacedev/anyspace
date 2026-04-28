// iOS log streaming via `xcrun simctl spawn <udid> log stream --style ndjson`.
//
// `log stream` emits one JSON object per line in `--style ndjson` mode, with
// a fairly stable schema across recent macOS releases. We extract the
// fields that match our cross-platform LogLine type and surface them to the
// frontend through the same Channel<LogLine> as Android logcat.

use super::logs::LogLine;
use anyhow::{anyhow, Context, Result};
use std::process::Stdio;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::task::JoinHandle;

pub struct IosLogStream {
    child: Child,
    pump: JoinHandle<()>,
}

impl IosLogStream {
    pub async fn spawn(udid: &str, on_line: Channel<LogLine>) -> Result<Self> {
        let mut child = Command::new("xcrun")
            .args([
                "simctl", "spawn", udid, "log", "stream",
                "--style", "ndjson",
                "--level=debug",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .context("spawning xcrun simctl spawn log stream")?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("simctl log stream stdout was None"))?;
        let pump = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let parsed = parse_ndjson_line(&line);
                if on_line.send(parsed).is_err() {
                    break;
                }
            }
        });
        Ok(Self { child, pump })
    }

    pub async fn stop(mut self) {
        self.pump.abort();
        let _ = self.child.start_kill();
        let _ = self.child.wait().await;
    }
}

// Convert os_log's ndjson schema into our cross-platform LogLine.
//
// Sample (truncated):
//   {"timestamp":"2026-04-28 14:23:45.123-0700",
//    "messageType":"Default",
//    "processImagePath":"/usr/bin/SomeProcess",
//    "category":"network",
//    "subsystem":"com.apple.network",
//    "processID":1234,
//    "threadID":5678,
//    "eventMessage":"hello"}
//
// Lines that don't parse (transient daemon noise, headers, etc.) are
// surfaced verbatim under tag="raw" so they're still visible.
fn parse_ndjson_line(line: &str) -> LogLine {
    let raw_fallback = || LogLine {
        ts: String::new(),
        pid: 0,
        tid: 0,
        level: 'I',
        tag: "raw".into(),
        message: line.to_string(),
    };

    let v: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return raw_fallback(),
    };
    let obj = match v.as_object() {
        Some(o) => o,
        None => return raw_fallback(),
    };

    let ts = obj
        .get("timestamp")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let level_str = obj
        .get("messageType")
        .and_then(|x| x.as_str())
        .or_else(|| obj.get("logType").and_then(|x| x.as_str()))
        .unwrap_or("Default");
    let level = match level_str {
        "Debug" => 'D',
        "Info" => 'I',
        "Notice" | "Default" => 'I',
        "Error" => 'E',
        "Fault" => 'F',
        _ => 'I',
    };
    let process = obj
        .get("processImagePath")
        .and_then(|x| x.as_str())
        .map(|p| p.rsplit('/').next().unwrap_or(p).to_string())
        .or_else(|| {
            obj.get("process")
                .and_then(|x| x.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_default();
    let category = obj
        .get("category")
        .and_then(|x| x.as_str())
        .unwrap_or("");
    let tag = if category.is_empty() {
        process
    } else if process.is_empty() {
        category.to_string()
    } else {
        format!("{process}/{category}")
    };
    let message = obj
        .get("eventMessage")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .to_string();
    let pid = obj.get("processID").and_then(|x| x.as_i64()).unwrap_or(0) as i32;
    let tid = obj.get("threadID").and_then(|x| x.as_i64()).unwrap_or(0) as i32;

    LogLine {
        ts,
        pid,
        tid,
        level,
        tag,
        message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_typical_ndjson() {
        let line = r#"{"timestamp":"2026-04-28 14:23:45.123-0700","messageType":"Default","processImagePath":"/usr/bin/foo","category":"net","processID":1234,"threadID":5678,"eventMessage":"hello"}"#;
        let l = parse_ndjson_line(line);
        assert_eq!(l.ts, "2026-04-28 14:23:45.123-0700");
        assert_eq!(l.pid, 1234);
        assert_eq!(l.tid, 5678);
        assert_eq!(l.level, 'I');
        assert_eq!(l.tag, "foo/net");
        assert_eq!(l.message, "hello");
    }

    #[test]
    fn unknown_line_falls_back_to_raw() {
        let l = parse_ndjson_line("not json at all");
        assert_eq!(l.tag, "raw");
        assert_eq!(l.message, "not json at all");
    }

    #[test]
    fn maps_error_level() {
        let line = r#"{"messageType":"Error","eventMessage":"oops"}"#;
        let l = parse_ndjson_line(line);
        assert_eq!(l.level, 'E');
    }
}
