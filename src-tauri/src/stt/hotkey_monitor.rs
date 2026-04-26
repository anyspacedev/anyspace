//! macOS NSEvent local monitor for the hold-to-talk modifier hotkey.
//!
//! WebKit consults `NSTextInputContext` (and through it, IMK) on every
//! modifier-key event. On recent macOS versions that consultation logs
//! `error messaging the mach port for IMKCFRunLoopWakeUpReliable` whenever the
//! IMK server's run loop isn't already awake — which is the common case when
//! the user isn't actively entering text. The error is harmless but spams
//! stderr every time the user holds the dictation hotkey.
//!
//! `preventDefault()` in JS can't suppress it because IMK is consulted
//! *before* WebKit dispatches the keydown to JS. So we intercept the event
//! one layer up: an `addLocalMonitorForEventsMatchingMask:handler:` hook for
//! `flagsChanged` events. When the configured hotkey's flag bit toggles, we
//! emit `stt://hotkey-down` / `stt://hotkey-up` and return nil so WebKit
//! never sees the event.
//!
//! Only modifier hotkeys go through this path — `flagsChanged` only fires for
//! Shift / Control / Option / Command. Non-modifier hotkeys keep flowing
//! through the JS keydown listener (and may still produce IMK log spam, but
//! that's not our default).

#![cfg(target_os = "macos")]

use std::ptr::NonNull;
use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering};

use block2::RcBlock;
use objc2_app_kit::{NSEvent, NSEventMask};
use tauri::{AppHandle, Emitter};

/// Maps a JS `KeyboardEvent.code` to (macOS virtual keyCode,
/// device-dependent bit in `NSEvent.modifierFlags`). Only the eight modifier
/// codes are recognized; everything else returns None which disables
/// interception.
fn key_info(code: &str) -> Option<(u16, u64)> {
    Some(match code {
        "AltRight" => (61, 0x40),
        "AltLeft" => (58, 0x20),
        "ControlRight" => (62, 0x2000),
        "ControlLeft" => (59, 0x01),
        "MetaRight" => (54, 0x10),
        "MetaLeft" => (55, 0x08),
        "ShiftRight" => (60, 0x04),
        "ShiftLeft" => (56, 0x02),
        _ => return None,
    })
}

const DISABLED: u16 = u16::MAX;

static TARGET_KEY_CODE: AtomicU16 = AtomicU16::new(DISABLED);
static TARGET_FLAG: AtomicU64 = AtomicU64::new(0);
static PRESSED: AtomicBool = AtomicBool::new(false);
static INSTALLED: AtomicBool = AtomicBool::new(false);

/// Atomically swap the hotkey we intercept. A non-modifier code disables
/// interception — the JS keydown listener picks those up instead.
pub fn set_hotkey(code: &str) {
    match key_info(code) {
        Some((kc, flag)) => {
            TARGET_KEY_CODE.store(kc, Ordering::Release);
            TARGET_FLAG.store(flag, Ordering::Release);
        }
        None => {
            TARGET_KEY_CODE.store(DISABLED, Ordering::Release);
            TARGET_FLAG.store(0, Ordering::Release);
        }
    }
    PRESSED.store(false, Ordering::Release);
}

/// Install the AppKit local monitor. Idempotent; must be called on the main
/// thread (Tauri's `setup` callback satisfies that).
pub fn install(app: AppHandle) {
    if INSTALLED.swap(true, Ordering::SeqCst) {
        return;
    }

    let block = RcBlock::new(move |event: NonNull<NSEvent>| -> *mut NSEvent {
        let target_kc = TARGET_KEY_CODE.load(Ordering::Acquire);
        if target_kc == DISABLED {
            return event.as_ptr();
        }
        let event_kc = unsafe { event.as_ref().keyCode() };
        if event_kc != target_kc {
            return event.as_ptr();
        }
        let flag = TARGET_FLAG.load(Ordering::Acquire);
        let raw = unsafe { event.as_ref().modifierFlags() }.0 as u64;
        let now_pressed = (raw & flag) != 0;
        let was_pressed = PRESSED.swap(now_pressed, Ordering::AcqRel);
        if now_pressed && !was_pressed {
            let _ = app.emit("stt://hotkey-down", ());
        } else if !now_pressed && was_pressed {
            let _ = app.emit("stt://hotkey-up", ());
        }
        std::ptr::null_mut()
    });

    unsafe {
        let token = NSEvent::addLocalMonitorForEventsMatchingMask_handler(
            NSEventMask::FlagsChanged,
            &block,
        );
        // Leak the monitor token — we want the hook to live for the entire
        // app lifetime. AppKit returns nil if registration failed; in either
        // case there's no cleanup we'd want to do later.
        std::mem::forget(token);
    }
}
