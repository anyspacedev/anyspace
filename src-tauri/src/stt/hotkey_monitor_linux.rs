//! Linux keyboard polling for the hold-to-talk hotkey.
//!
//! WebKitGTK on Linux silently drops keyup events for modifier-only hotkeys
//! (the JS layer often sees a keydown but no matching keyup, or only spurious
//! keyups whose `getModifierState` lies about whether the key is still held).
//! That makes it impossible to drive hold-to-talk from JS keyboard events
//! alone. So we poll the keyboard at the OS level — same idea as the macOS
//! `NSEvent` monitor — and emit `stt://hotkey-down` / `stt://hotkey-up`
//! events to the frontend, which already mirrors `heldRef` from those.
//!
//! The polling uses `device_query`, which talks to X11 (works under XWayland
//! too). On a pure-Wayland session without XWayland this monitor will not see
//! events; the JS keyboard path with its watchdog stays as fallback.

#![cfg(target_os = "linux")]

use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::thread;
use std::time::Duration;

use device_query::{DeviceQuery, DeviceState, Keycode};
use tauri::{AppHandle, Emitter, Manager};

const POLL_INTERVAL_MS: u64 = 30;
const TARGET_NONE: u8 = 0;

static TARGET_KEY: AtomicU8 = AtomicU8::new(TARGET_NONE);
static IS_PRESSED: AtomicBool = AtomicBool::new(false);
static INSTALLED: AtomicBool = AtomicBool::new(false);

#[derive(Copy, Clone)]
enum Hotkey {
    AltLeft = 1,
    AltRight = 2,
    ControlLeft = 3,
    ControlRight = 4,
    MetaLeft = 5,
    MetaRight = 6,
    ShiftLeft = 7,
    ShiftRight = 8,
}

impl Hotkey {
    fn from_code(code: &str) -> Option<Hotkey> {
        Some(match code {
            "AltLeft" => Hotkey::AltLeft,
            "AltRight" => Hotkey::AltRight,
            "ControlLeft" => Hotkey::ControlLeft,
            "ControlRight" => Hotkey::ControlRight,
            "MetaLeft" => Hotkey::MetaLeft,
            "MetaRight" => Hotkey::MetaRight,
            "ShiftLeft" => Hotkey::ShiftLeft,
            "ShiftRight" => Hotkey::ShiftRight,
            _ => return None,
        })
    }

    fn from_u8(v: u8) -> Option<Hotkey> {
        Some(match v {
            1 => Hotkey::AltLeft,
            2 => Hotkey::AltRight,
            3 => Hotkey::ControlLeft,
            4 => Hotkey::ControlRight,
            5 => Hotkey::MetaLeft,
            6 => Hotkey::MetaRight,
            7 => Hotkey::ShiftLeft,
            8 => Hotkey::ShiftRight,
            _ => return None,
        })
    }

    fn matches(self, key: &Keycode) -> bool {
        matches!(
            (self, key),
            (Hotkey::AltLeft, Keycode::LAlt)
                | (Hotkey::AltRight, Keycode::RAlt)
                | (Hotkey::ControlLeft, Keycode::LControl)
                | (Hotkey::ControlRight, Keycode::RControl)
                | (Hotkey::MetaLeft, Keycode::LMeta)
                | (Hotkey::MetaRight, Keycode::RMeta)
                | (Hotkey::ShiftLeft, Keycode::LShift)
                | (Hotkey::ShiftRight, Keycode::RShift)
        )
    }
}

/// Atomically swap which key the polling thread tracks. A non-modifier code
/// disables the monitor — the JS keydown path still picks those up.
pub fn set_hotkey(code: &str) {
    let v = Hotkey::from_code(code).map(|h| h as u8).unwrap_or(TARGET_NONE);
    TARGET_KEY.store(v, Ordering::Release);
    // Reset edge-detection state so a stale "pressed" flag from the previous
    // hotkey can't mask the first press of the new one.
    IS_PRESSED.store(false, Ordering::Release);
}

/// Spawn the polling thread. Idempotent; may be called multiple times safely.
pub fn install(app: AppHandle) {
    if INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }

    let result = thread::Builder::new()
        .name("stt-hotkey-monitor".into())
        .spawn(move || run(app));
    if let Err(e) = result {
        eprintln!("[stt] failed to spawn Linux hotkey monitor: {e}");
        INSTALLED.store(false, Ordering::Release);
    }
}

fn run(app: AppHandle) {
    let device = DeviceState::new();
    loop {
        poll_once(&app, &device);
        thread::sleep(Duration::from_millis(POLL_INTERVAL_MS));
    }
}

fn poll_once(app: &AppHandle, device: &DeviceState) {
    let target_raw = TARGET_KEY.load(Ordering::Acquire);
    if target_raw == TARGET_NONE {
        // Make sure we don't strand a stale pressed=true if the user
        // rebound the hotkey mid-hold.
        if IS_PRESSED.swap(false, Ordering::AcqRel) {
            let _ = app.emit("stt://hotkey-up", ());
        }
        return;
    }
    let Some(target) = Hotkey::from_u8(target_raw) else {
        return;
    };

    // Window-scoped: only emit events while our main window has focus, so
    // holding the modifier in another app doesn't start a recording. Focus
    // loss while held emits hotkey-up so the recorder cleans up.
    let focused = app
        .get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false);

    let pressed_now = if focused {
        device
            .get_keys()
            .iter()
            .any(|k| target.matches(k))
    } else {
        false
    };

    let was_pressed = IS_PRESSED.swap(pressed_now, Ordering::AcqRel);
    if pressed_now && !was_pressed {
        let _ = app.emit("stt://hotkey-down", ());
    } else if !pressed_now && was_pressed {
        let _ = app.emit("stt://hotkey-up", ());
    }
}
