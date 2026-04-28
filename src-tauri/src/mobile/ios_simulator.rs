// iOS Simulator session — spawns the bundled `iossimstream` Swift helper
// (compiled by build.rs on macOS), pipes its stdout (H.264 Annex-B) onto
// the frontend video Channel. Input flows via stdin (newline-delimited
// JSON) — the helper re-encodes each event as a CGEvent and posts it to
// the Simulator process. Logs come from `xcrun simctl spawn UDID log
// stream --style ndjson` parsed via super::ios_logs.

use super::commands::InputEvent;
use super::ios_logs::IosLogStream;
use super::logs::LogLine;
use anyhow::{anyhow, bail, Context, Result};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;
use tokio::time::timeout;

const VIDEO_READ_CHUNK: usize = 64 * 1024;

#[derive(Debug, Clone)]
pub struct IosSimOpts {
    pub device_id: String,
    pub device_name: String,
    pub bitrate: u32,
}

pub struct IosSimSession {
    pub pane_id: String,
    pub width: u32,
    pub height: u32,
    /// Booted simulator UDID — needed at log-stream-spawn time.
    udid: String,
    /// Inbox for the helper's stdin (newline-delimited JSON input commands).
    stdin_tx: mpsc::UnboundedSender<Vec<u8>>,
    log_stream: Mutex<Option<IosLogStream>>,
    inner: Mutex<Option<Inner>>,
}

struct Inner {
    helper: Child,
    video_pump: JoinHandle<()>,
    stderr_collector: JoinHandle<()>,
    stdin_pump: JoinHandle<()>,
}

#[cfg(target_os = "macos")]
fn helper_path() -> Option<PathBuf> {
    option_env!("IOSSIMSTREAM_PATH").map(PathBuf::from)
}

#[cfg(not(target_os = "macos"))]
fn helper_path() -> Option<PathBuf> {
    None
}

impl IosSimSession {
    pub async fn connect(
        pane_id: String,
        opts: IosSimOpts,
        on_video: Channel<Vec<u8>>,
    ) -> Result<Self> {
        let helper = helper_path().ok_or_else(|| {
            anyhow!(
                "iOS Simulator streaming requires the iossimstream helper, which is built by \
                 swiftc on macOS. Install Xcode Command Line Tools (`xcode-select --install`) \
                 and rebuild the app."
            )
        })?;
        if !helper.exists() {
            bail!(
                "iossimstream helper not found at {}. Rebuild the app on macOS to compile it.",
                helper.display()
            );
        }

        let mut child = Command::new(&helper)
            .args(["--device-name", &opts.device_name])
            .args(["--bitrate", &opts.bitrate.to_string()])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .with_context(|| format!("spawning iossimstream at {}", helper.display()))?;

        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| anyhow!("iossimstream stderr was None"))?;
        let mut stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow!("iossimstream stdout was None"))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("iossimstream stdin was None"))?;

        // Buffer all stderr lines during startup so a timeout surfaces them
        // back to the user. After the first stdout byte arrives, we flip
        // `collecting` off and lines are only echoed to the host stderr.
        let stderr_buffer: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let collecting = Arc::new(AtomicBool::new(true));
        let stderr_collector = {
            let buf = Arc::clone(&stderr_buffer);
            let flag = Arc::clone(&collecting);
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = reader.next_line().await {
                    eprintln!("[iossimstream] {line}");
                    if flag.load(Ordering::Relaxed) {
                        buf.lock().await.push(line);
                    }
                }
            })
        };

        let probe = async {
            let mut buf = [0u8; 1];
            stdout
                .read_exact(&mut buf)
                .await
                .context("reading first byte from iossimstream stdout")?;
            Ok::<u8, anyhow::Error>(buf[0])
        };
        let probe_result = timeout(Duration::from_secs(30), probe).await;
        tokio::time::sleep(Duration::from_millis(150)).await;
        let stderr_snapshot: Vec<String> = stderr_buffer.lock().await.clone();

        let first_byte = match probe_result {
            Ok(Ok(b)) => {
                collecting.store(false, Ordering::Relaxed);
                stderr_buffer.lock().await.clear();
                b
            }
            Ok(Err(e)) => {
                stderr_collector.abort();
                let _ = child.start_kill();
                return Err(format_helper_error(
                    &format!("iossimstream stdout error: {e}"),
                    &stderr_snapshot,
                ));
            }
            Err(_) => {
                stderr_collector.abort();
                let _ = child.start_kill();
                let hint = diagnose_timeout(&stderr_snapshot);
                return Err(format_helper_error(
                    &format!("iossimstream timed out before first frame.\n{hint}"),
                    &stderr_snapshot,
                ));
            }
        };

        let video_pump = tokio::spawn(async move {
            if on_video.send(vec![first_byte]).is_err() {
                return;
            }
            let mut buf = vec![0u8; VIDEO_READ_CHUNK];
            loop {
                match stdout.read(&mut buf).await {
                    Ok(0) => break,
                    Ok(n) => {
                        if on_video.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
        });

        // Stdin pump: drain the mpsc, write each chunk to the helper's stdin.
        // Input events are tiny (< 200 B each) so an unbounded queue is fine.
        let (stdin_tx, mut stdin_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let stdin_pump = tokio::spawn(async move {
            let mut writer = stdin;
            while let Some(bytes) = stdin_rx.recv().await {
                if writer.write_all(&bytes).await.is_err() {
                    while stdin_rx.recv().await.is_some() {}
                    break;
                }
                // The helper reads line-by-line; flush so events propagate
                // promptly rather than getting stuck in tokio's pipe buffer.
                if writer.flush().await.is_err() {
                    while stdin_rx.recv().await.is_some() {}
                    break;
                }
            }
        });

        Ok(Self {
            pane_id,
            width: 0,
            height: 0,
            udid: opts.device_id,
            stdin_tx,
            log_stream: Mutex::new(None),
            inner: Mutex::new(Some(Inner {
                helper: child,
                video_pump,
                stderr_collector,
                stdin_pump,
            })),
        })
    }

    pub fn send_input(&self, event: &InputEvent) -> Result<()> {
        let line = serde_json::to_string(event)
            .map_err(|e| anyhow!("encoding iOS input event: {e}"))?;
        let mut bytes = line.into_bytes();
        bytes.push(b'\n');
        self.stdin_tx
            .send(bytes)
            .map_err(|_| anyhow!("iossimstream stdin pump closed (helper died?)"))
    }

    pub async fn start_logs(&self, on_line: Channel<LogLine>) -> Result<()> {
        let mut guard = self.log_stream.lock().await;
        if let Some(old) = guard.take() {
            old.stop().await;
        }
        let stream = IosLogStream::spawn(&self.udid, on_line).await?;
        *guard = Some(stream);
        Ok(())
    }

    pub async fn stop_logs(&self) {
        let mut guard = self.log_stream.lock().await;
        if let Some(stream) = guard.take() {
            stream.stop().await;
        }
    }

    pub async fn disconnect(&self) {
        self.stop_logs().await;
        let mut guard = self.inner.lock().await;
        let Some(mut inner) = guard.take() else {
            return;
        };
        inner.video_pump.abort();
        inner.stderr_collector.abort();
        inner.stdin_pump.abort();
        let _ = inner.helper.start_kill();
        let _ = inner.helper.wait().await;
    }
}

impl Drop for IosSimSession {
    fn drop(&mut self) {
        if let Ok(mut log_guard) = self.log_stream.try_lock() {
            if let Some(stream) = log_guard.take() {
                tokio::spawn(async move { stream.stop().await });
            }
        }
        if let Ok(mut guard) = self.inner.try_lock() {
            if let Some(inner) = guard.take() {
                inner.video_pump.abort();
                inner.stderr_collector.abort();
                inner.stdin_pump.abort();
                drop(inner.helper);
            }
        }
    }
}

fn format_helper_error(prefix: &str, stderr_lines: &[String]) -> anyhow::Error {
    if stderr_lines.is_empty() {
        anyhow!("{prefix}\n(no stderr output captured)")
    } else {
        let trail = stderr_lines.join("\n  ");
        anyhow!("{prefix}\n--- iossimstream stderr ---\n  {trail}")
    }
}

fn diagnose_timeout(stderr_lines: &[String]) -> &'static str {
    let saw = |needle: &str| stderr_lines.iter().any(|l| l.contains(needle));

    if saw("startCapture failed") {
        return "Screen Recording permission was rejected.";
    }
    if saw("capture started") {
        return "Capture started but no frames arrived. \
                Likely a VideoToolbox/encoder issue; try restarting Simulator.app.";
    }
    if saw("encoder ready") {
        return "Encoder set up but capture never started — usually means the Screen \
                Recording permission prompt is waiting for your click. Grant it in \
                System Settings → Privacy & Security → Screen Recording, then quit \
                & restart this app.";
    }
    if saw("window found") {
        return "Window located but encoder never came up. Likely VideoToolbox \
                init failure — try a smaller bitrate or different device.";
    }
    if saw("starting") {
        return "Helper started but couldn't find a Simulator window. Open \
                Simulator.app and confirm your device is showing, then retry.";
    }
    "Helper produced no output before timeout. Likely Screen Recording permission \
     was never prompted (helper hung very early). Check System Settings → Privacy \
     & Security → Screen Recording and grant the app permission, then quit & \
     restart it."
}
