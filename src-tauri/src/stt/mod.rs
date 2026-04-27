pub mod commands;

#[cfg(target_os = "macos")]
pub mod hotkey_monitor;

#[cfg(target_os = "linux")]
pub mod hotkey_monitor_linux;
