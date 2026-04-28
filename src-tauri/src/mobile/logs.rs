// Logcat streaming.
//
// Spawns `adb -s <serial> logcat -v threadtime`, line-buffers stdout, parses
// each line into a typed LogLine, and pushes onto a tauri Channel. One
// LogStream per MobileSession. The threadtime format emits one line per log
// entry with: "MM-DD HH:MM:SS.mmm  PID  TID L TAG    : MESSAGE".

use anyhow::{anyhow, Context, Result};
use serde::Serialize;
use std::path::Path;
use std::process::Stdio;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use tokio::task::JoinHandle;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    /// "MM-DD HH:MM:SS.mmm" (the year isn't in the threadtime format), or
    /// empty for header / unparseable lines.
    pub ts: String,
    pub pid: i32,
    pub tid: i32,
    /// V/D/I/W/E/F — single ASCII char.
    pub level: char,
    pub tag: String,
    pub message: String,
}

pub struct LogStream {
    child: Child,
    pump: JoinHandle<()>,
}

impl LogStream {
    pub async fn spawn(adb: &Path, serial: &str, on_line: Channel<LogLine>) -> Result<Self> {
        let mut child = Command::new(adb)
            .args(["-s", serial, "logcat", "-v", "threadtime"])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .stdin(Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .context("spawning adb logcat")?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("adb logcat stdout was None"))?;
        let pump = tokio::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let parsed = parse_threadtime_line(&line);
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

fn parse_threadtime_line(line: &str) -> LogLine {
    // "--------- beginning of system" / blank lines — surface as info-level
    // messages with the original text so they don't get lost.
    if line.is_empty() || line.starts_with("---") {
        return LogLine {
            ts: String::new(),
            pid: 0,
            tid: 0,
            level: 'I',
            tag: String::new(),
            message: line.to_string(),
        };
    }

    let mut iter = line.split_ascii_whitespace();
    let date = iter.next().unwrap_or("");
    let time = iter.next().unwrap_or("");
    let pid_str = iter.next().unwrap_or("");
    let tid_str = iter.next().unwrap_or("");
    let level_str = iter.next().unwrap_or("");

    if date.len() != 5 || level_str.len() != 1 {
        return LogLine {
            ts: String::new(),
            pid: 0,
            tid: 0,
            level: 'I',
            tag: String::new(),
            message: line.to_string(),
        };
    }

    // Find the byte offset just past the 5th token to recover the
    // "TAG    : MESSAGE" remainder verbatim (split_ascii_whitespace eats
    // run-of-spaces, which destroys tag padding and the colon delimiter).
    let mut rest_start: usize = 0;
    let mut tok_count = 0;
    let mut in_token = false;
    for (i, b) in line.bytes().enumerate() {
        if b.is_ascii_whitespace() {
            if in_token {
                in_token = false;
                tok_count += 1;
                if tok_count == 5 {
                    rest_start = i;
                    break;
                }
            }
        } else {
            in_token = true;
        }
    }
    let rest = line[rest_start..].trim_start();

    let (tag, message) = match rest.find(": ") {
        Some(idx) => (rest[..idx].trim().to_string(), rest[idx + 2..].to_string()),
        None => (String::new(), rest.to_string()),
    };

    LogLine {
        ts: format!("{date} {time}"),
        pid: pid_str.parse().unwrap_or(0),
        tid: tid_str.parse().unwrap_or(0),
        level: level_str.chars().next().unwrap_or('I'),
        tag,
        message,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_typical_line() {
        let l =
            parse_threadtime_line("04-28 14:23:45.123  1234  5678 D MyTag   : Hello world");
        assert_eq!(l.ts, "04-28 14:23:45.123");
        assert_eq!(l.pid, 1234);
        assert_eq!(l.tid, 5678);
        assert_eq!(l.level, 'D');
        assert_eq!(l.tag, "MyTag");
        assert_eq!(l.message, "Hello world");
    }

    #[test]
    fn handles_header_line() {
        let l = parse_threadtime_line("--------- beginning of system");
        assert_eq!(l.ts, "");
        assert_eq!(l.message, "--------- beginning of system");
    }

    #[test]
    fn handles_message_with_colons() {
        let l = parse_threadtime_line(
            "04-28 14:23:45.123  1234  5678 I Foo     : key: value, count: 5",
        );
        assert_eq!(l.tag, "Foo");
        assert_eq!(l.message, "key: value, count: 5");
    }

    #[test]
    fn handles_garbage_line() {
        let l = parse_threadtime_line("nonsense without enough tokens");
        assert_eq!(l.ts, "");
        assert_eq!(l.message, "nonsense without enough tokens");
    }
}
