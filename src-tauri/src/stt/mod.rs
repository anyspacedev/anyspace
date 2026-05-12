pub mod commands;
pub mod local;
pub mod models;

#[cfg(target_os = "macos")]
pub mod hotkey_monitor;

#[cfg(target_os = "linux")]
pub mod hotkey_monitor_linux;

use dashmap::DashMap;
use std::sync::Arc;
use tokio::sync::oneshot;

/// Tracks in-flight model downloads so the frontend can cancel mid-stream.
/// Keyed by model id (`tiny`, `base`, …) — only one download per model at a
/// time is allowed; starting a second one drops the previous sender, which
/// aborts the prior download.
pub struct ModelDownloadManager {
    pub aborts: Arc<DashMap<String, oneshot::Sender<()>>>,
}

impl ModelDownloadManager {
    pub fn new() -> Self {
        Self {
            aborts: Arc::new(DashMap::new()),
        }
    }
}

impl Default for ModelDownloadManager {
    fn default() -> Self {
        Self::new()
    }
}

/// Strips bracketed/parenthesized non-speech markers from a transcript and
/// collapses leftover whitespace. ElevenLabs Scribe inlines events like
/// `[tapping]` / `(Background noise)`; whisper.cpp emits sentinel markers
/// like `[BLANK_AUDIO]` / `[Music]` / `[_BEG_]` when no speech is detected.
/// Both leak into the dispatched text and are noise once typed into a
/// terminal or editor, so we drop them at the boundary.
pub fn strip_bracketed_annotations(text: &str) -> String {
    let mut stripped = String::with_capacity(text.len());
    let mut bracket_depth: u32 = 0;
    let mut paren_depth: u32 = 0;
    for ch in text.chars() {
        match ch {
            '[' => bracket_depth += 1,
            ']' if bracket_depth > 0 => bracket_depth -= 1,
            '(' => paren_depth += 1,
            ')' if paren_depth > 0 => paren_depth -= 1,
            _ if bracket_depth == 0 && paren_depth == 0 => stripped.push(ch),
            _ => {}
        }
    }
    let mut out = String::with_capacity(stripped.len());
    let mut prev_space = true;
    for ch in stripped.chars() {
        if ch.is_whitespace() {
            if !prev_space {
                out.push(' ');
                prev_space = true;
            }
        } else {
            out.push(ch);
            prev_space = false;
        }
    }
    while out.ends_with(' ') {
        out.pop();
    }
    out
}
