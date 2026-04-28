// MobileSession — owns one live device connection. Created by
// `mobile_connect`, dropped by `mobile_disconnect`.
//
// MobileSession is an enum dispatching to per-target implementations:
//   - Android via scrcpy (PTY child, video TCP, control TCP, optional logcat),
//   - IosSimulator via the bundled iossimstream Swift helper (Phase 2a:
//     view-only; input + logs land in follow-up commits).
//
// Keeping the dispatch behind a single type means commands.rs / the
// MobileManager DashMap can store one type per session regardless of target.

use super::commands::{encode_android_input, InputEvent};
use super::ios_simulator::IosSimSession;
use super::logs::{LogLine, LogStream};
use super::scrcpy::{self, ScrcpyHandle};
use anyhow::{anyhow, Result};
use std::path::PathBuf;
use tauri::ipc::Channel;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::process::Child;
use tokio::sync::{mpsc, Mutex};
use tokio::task::JoinHandle;

const VIDEO_READ_CHUNK: usize = 64 * 1024;

pub enum MobileSession {
    Android(AndroidSession),
    IosSimulator(IosSimSession),
}

impl MobileSession {
    pub fn pane_id(&self) -> &str {
        match self {
            Self::Android(a) => &a.pane_id,
            Self::IosSimulator(s) => &s.pane_id,
        }
    }

    pub fn width(&self) -> u32 {
        match self {
            Self::Android(a) => a.width,
            Self::IosSimulator(s) => s.width,
        }
    }

    pub fn height(&self) -> u32 {
        match self {
            Self::Android(a) => a.height,
            Self::IosSimulator(s) => s.height,
        }
    }

    pub fn codec(&self) -> &'static str {
        // Both Android (scrcpy) and iOS (VTCompressionSession) emit raw
        // H.264 Annex-B — the frontend uses one decoder configuration.
        "annexb"
    }

    pub fn send_input(&self, event: &InputEvent) -> Result<()> {
        match self {
            Self::Android(a) => {
                let bytes = encode_android_input(event).map_err(|e| anyhow!("{e}"))?;
                a.send_control(bytes)
            }
            Self::IosSimulator(s) => s.send_input(event),
        }
    }

    pub async fn start_logs(&self, on_line: Channel<LogLine>) -> Result<()> {
        match self {
            Self::Android(a) => a.start_logs(on_line).await,
            Self::IosSimulator(s) => s.start_logs(on_line).await,
        }
    }

    pub async fn stop_logs(&self) {
        match self {
            Self::Android(a) => a.stop_logs().await,
            Self::IosSimulator(s) => s.stop_logs().await,
        }
    }

    pub async fn disconnect(&self) {
        match self {
            Self::Android(a) => a.disconnect().await,
            Self::IosSimulator(s) => s.disconnect().await,
        }
    }
}

// ===== Android =====

pub struct AndroidSession {
    pub pane_id: String,
    pub width: u32,
    pub height: u32,
    pub adb: PathBuf,
    pub serial: String,

    control_tx: mpsc::UnboundedSender<Vec<u8>>,
    log_stream: Mutex<Option<LogStream>>,
    inner: Mutex<Option<Inner>>,
}

struct Inner {
    child: Child,
    local_port: u16,
    video_pump: JoinHandle<()>,
    control_pump: JoinHandle<()>,
}

impl AndroidSession {
    pub async fn connect(
        pane_id: String,
        opts: scrcpy::ScrcpyOpts,
        on_video: Channel<Vec<u8>>,
    ) -> Result<Self> {
        let ScrcpyHandle {
            child,
            mut video,
            mut control,
            local_port,
            adb,
            serial,
        } = scrcpy::spawn(opts).await?;

        let video_pump = tokio::spawn(async move {
            let mut buf = vec![0u8; VIDEO_READ_CHUNK];
            loop {
                match video.read(&mut buf).await {
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

        let (control_tx, mut control_rx) = mpsc::unbounded_channel::<Vec<u8>>();
        let control_pump = tokio::spawn(async move {
            while let Some(bytes) = control_rx.recv().await {
                if control.write_all(&bytes).await.is_err() {
                    while control_rx.recv().await.is_some() {}
                    break;
                }
            }
        });

        Ok(Self {
            pane_id,
            width: 0,
            height: 0,
            adb,
            serial,
            control_tx,
            log_stream: Mutex::new(None),
            inner: Mutex::new(Some(Inner {
                child,
                local_port,
                video_pump,
                control_pump,
            })),
        })
    }

    pub fn send_control(&self, bytes: Vec<u8>) -> Result<()> {
        self.control_tx
            .send(bytes)
            .map_err(|_| anyhow!("control channel closed (session disconnected)"))
    }

    pub async fn start_logs(&self, on_line: Channel<LogLine>) -> Result<()> {
        let mut guard = self.log_stream.lock().await;
        if let Some(old) = guard.take() {
            old.stop().await;
        }
        let stream = LogStream::spawn(&self.adb, &self.serial, on_line).await?;
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
        inner.control_pump.abort();
        scrcpy::cleanup(&self.adb, &self.serial, inner.local_port, &mut inner.child).await;
        let _ = inner.child.wait().await;
    }
}

impl Drop for AndroidSession {
    fn drop(&mut self) {
        if let Ok(mut log_guard) = self.log_stream.try_lock() {
            if let Some(stream) = log_guard.take() {
                tokio::spawn(async move { stream.stop().await });
            }
        }
        if let Ok(mut guard) = self.inner.try_lock() {
            if let Some(inner) = guard.take() {
                inner.video_pump.abort();
                inner.control_pump.abort();
                drop(inner.child);
                let adb = self.adb.clone();
                let serial = self.serial.clone();
                let port = inner.local_port;
                tokio::spawn(async move {
                    let mut cmd = tokio::process::Command::new(&adb);
                    cmd.args(["-s", &serial, "forward", "--remove", &format!("tcp:{port}")])
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null());
                    let _ = cmd.status().await;
                });
            }
        }
    }
}
