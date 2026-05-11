// SSH host commands — keychain CRUD for stored passwords plus an askpass
// helper that materializes a one-shot SSH_ASKPASS script for password auth.
//
// We don't persist passwords in settings.json — only the OS keychain. The
// host record carries an `authMethod` flag and the keychain entry is keyed
// by host id, so the form can render the right fields without unlocking
// the keychain.
//
// Linux fallback: on Debian/Ubuntu without prior Secret Service activity
// the "default" collection alias is often unset, so a fresh `Entry::new`
// fails with "Secret Service: no result found". gnome-keyring's "login"
// collection always exists and is unlocked at session start, so we retry
// against it before giving up.

use keyring::Entry;
use std::collections::HashMap;

const KEYCHAIN_SERVICE: &str = "anyspace-ssh";

/// Push our process's display-related env vars into the session
/// dbus-daemon's activation environment. The daemon usually starts at
/// user-session boot before X has come up, so its activation env has no
/// DISPLAY/XAUTHORITY/etc. When gnome-keyring later asks D-Bus to
/// activate `gcr-prompter`, the prompter inherits dbus-daemon's empty
/// env, can't reach the X server, exits immediately, and the keyring
/// API reports the prompt as "dismissed". Propagating our env (Tauri is
/// running inside the user's graphical session, so we have the right
/// values) fixes that for the lifetime of the dbus-daemon.
///
/// Best-effort: any failure here is swallowed — the worst case is the
/// user sees the original "dismissed" error, which we already handle.
#[cfg(target_os = "linux")]
pub fn propagate_display_env_to_dbus() {
    use dbus::blocking::Connection;
    use std::collections::HashMap;
    use std::time::Duration;

    // Keys that gcr-prompter (or any other GUI helper D-Bus-activates)
    // needs to reach the user's display. WAYLAND_DISPLAY is included for
    // Wayland setups even though gcr-prompter is currently X-only.
    const KEYS: &[&str] = &[
        "DISPLAY",
        "XAUTHORITY",
        "WAYLAND_DISPLAY",
        "XDG_RUNTIME_DIR",
        "XDG_SESSION_TYPE",
        "XDG_CURRENT_DESKTOP",
    ];

    let mut env: HashMap<String, String> = HashMap::new();
    for k in KEYS {
        if let Ok(v) = std::env::var(k) {
            if !v.is_empty() {
                env.insert((*k).to_string(), v);
            }
        }
    }
    if env.is_empty() {
        return;
    }

    let Ok(conn) = Connection::new_session() else { return };
    let proxy = conn.with_proxy(
        "org.freedesktop.DBus",
        "/org/freedesktop/DBus",
        Duration::from_secs(5),
    );
    let _: Result<(), _> =
        proxy.method_call("org.freedesktop.DBus", "UpdateActivationEnvironment", (env,));
}

/// On Linux: make sure the user has a persistent Secret Service collection
/// usable as the default. gnome-keyring on a fresh XFCE/SSH-login box runs
/// with only an in-memory `/collection/session` and no `default` alias, so
/// every `keyring::Entry` op fails with "no result found". We try to
/// resolve the default → login → any-persistent collection; if none exist,
/// we call `CreateCollection` so `gcr-prompter` asks the user for a master
/// password once. After this returns Ok, the user's keychain is durable.
///
/// No-op on macOS / Windows — their keychain APIs handle this transparently.
#[cfg(target_os = "linux")]
fn ensure_default_collection() -> Result<(), String> {
    use dbus_secret_service::{EncryptionType, SecretService};

    // 120s prompt timeout — generous for the user to type a master password
    // into gcr-prompter, but stops us hanging forever if no prompter is
    // installed on this session.
    let ss = SecretService::connect_with_max_prompt_timeout(EncryptionType::Dh, 120)
        .map_err(|e| format!("Couldn't reach Secret Service over D-Bus: {e}"))?;

    // Already have a default alias → nothing to do.
    if ss.get_default_collection().is_ok() {
        return Ok(());
    }

    // gnome-keyring's PAM-created "login" collection is also fine — the
    // existing fallback in this file targets it directly via
    // Entry::new_with_target("login", …).
    if ss.get_collection_by_alias("login").is_ok() {
        return Ok(());
    }

    // No persistent collection exists. Before we trigger gcr-prompter,
    // push our display env to the dbus-daemon so the prompter spawns into
    // a session that can actually reach the X server. Without this, on
    // many Debian/XFCE setups the dialog never renders and the call comes
    // back as "dismissed" — see `propagate_display_env_to_dbus` above.
    propagate_display_env_to_dbus();

    // Now create the collection and alias it "default". gcr-prompter pops
    // a dialog: "Choose a password for the new keyring."
    ss.create_collection("Login", "default").map_err(|e| {
        let raw = e.to_string();
        if raw.contains("dismissed") {
            // User clicked Cancel / hit Escape / closed the dialog. Don't
            // claim "couldn't create the keyring" — the daemon is fine, the
            // user just needs to complete the prompt.
            "The keyring master-password prompt was dismissed. Click Save \
             again and enter a master password when the dialog appears. \
             (You only need to do this once.)"
                .to_string()
        } else {
            format!(
                "Couldn't create the default keyring: {raw}. Make sure \
                 gcr-prompter is installed and reachable from this session \
                 (`/usr/libexec/gcr-prompter` on Debian)."
            )
        }
    })?;
    Ok(())
}

#[cfg(not(target_os = "linux"))]
fn ensure_default_collection() -> Result<(), String> {
    Ok(())
}

fn primary_entry(host_id: &str) -> Result<Entry, keyring::Error> {
    Entry::new(KEYCHAIN_SERVICE, host_id)
}

#[cfg(target_os = "linux")]
fn fallback_entry(host_id: &str) -> Option<Entry> {
    Entry::new_with_target("login", KEYCHAIN_SERVICE, host_id).ok()
}

#[cfg(not(target_os = "linux"))]
fn fallback_entry(_host_id: &str) -> Option<Entry> {
    None
}

fn humanize(err: &keyring::Error) -> String {
    let raw = err.to_string();
    #[cfg(target_os = "linux")]
    {
        if raw.contains("Secret Service") || raw.contains("secret-service") {
            return format!(
                "{raw}. Install and unlock a Secret Service daemon: \
                 `sudo apt install gnome-keyring libsecret-1-0`, then \
                 log out and back in so the login keyring is created."
            );
        }
    }
    raw
}

/// Run a keychain operation against the default collection; on Linux, retry
/// against the "login" collection if the first attempt fails. `T` is the
/// success type of the operation (e.g. `()` for set/delete, `String` for get).
fn with_fallback<T, F>(host_id: &str, op: F) -> Result<T, String>
where
    F: Fn(&Entry) -> Result<T, keyring::Error>,
{
    let primary = primary_entry(host_id).map_err(|e| humanize(&e))?;
    match op(&primary) {
        Ok(v) => Ok(v),
        Err(primary_err) => {
            if let Some(fb) = fallback_entry(host_id) {
                match op(&fb) {
                    Ok(v) => Ok(v),
                    Err(_) => Err(humanize(&primary_err)),
                }
            } else {
                Err(humanize(&primary_err))
            }
        }
    }
}

#[tauri::command]
pub fn ssh_password_set(host_id: String, password: String) -> Result<(), String> {
    // First-save bootstrap: make sure the user has a usable persistent
    // collection. On Linux without prior Secret Service activity this is
    // what actually creates the keyring and prompts for a master password.
    ensure_default_collection()?;
    with_fallback(&host_id, |entry| entry.set_password(&password))
}

#[tauri::command]
pub fn ssh_password_get(host_id: String) -> Result<Option<String>, String> {
    // NoEntry is the legitimate "no such password" case — distinguish it
    // from real errors so a stale `authMethod` flag doesn't brick connect.
    let primary = primary_entry(&host_id).map_err(|e| humanize(&e))?;
    match primary.get_password() {
        Ok(p) => Ok(Some(p)),
        Err(keyring::Error::NoEntry) => {
            // Also probe the fallback collection — a previous save may
            // have landed there if the primary was unavailable at the time.
            if let Some(fb) = fallback_entry(&host_id) {
                match fb.get_password() {
                    Ok(p) => Ok(Some(p)),
                    Err(keyring::Error::NoEntry) => Ok(None),
                    Err(_) => Ok(None),
                }
            } else {
                Ok(None)
            }
        }
        Err(primary_err) => {
            if let Some(fb) = fallback_entry(&host_id) {
                match fb.get_password() {
                    Ok(p) => Ok(Some(p)),
                    Err(keyring::Error::NoEntry) => Ok(None),
                    Err(_) => Err(humanize(&primary_err)),
                }
            } else {
                Err(humanize(&primary_err))
            }
        }
    }
}

#[tauri::command]
pub fn ssh_password_delete(host_id: String) -> Result<(), String> {
    // Best-effort: try to delete from both collections, since we don't
    // always know which one stored the entry. Treat NoEntry as success.
    let mut last_err: Option<String> = None;
    let mut any_success = false;
    let candidates: Vec<Entry> = std::iter::once(primary_entry(&host_id).ok())
        .chain(std::iter::once(fallback_entry(&host_id)))
        .flatten()
        .collect();
    for entry in candidates {
        match entry.delete_credential() {
            Ok(()) => any_success = true,
            Err(keyring::Error::NoEntry) => {}
            Err(e) => last_err = Some(humanize(&e)),
        }
    }
    if any_success {
        Ok(())
    } else if let Some(msg) = last_err {
        Err(msg)
    } else {
        Ok(())
    }
}

/// Writes a temp SSH_ASKPASS script that echoes the password, then returns
/// the env vars the caller should merge into the `ssh` child env. The
/// script self-destructs after a short window so the password doesn't
/// linger on disk.
#[tauri::command]
pub fn ssh_askpass_prepare(password: String) -> Result<HashMap<String, String>, String> {
    let path = super::askpass::prepare_askpass(&password).map_err(|e| e.to_string())?;
    let mut env = HashMap::new();
    env.insert("SSH_ASKPASS".to_string(), path);
    // OpenSSH 8.4+ — forces askpass even when a TTY is attached.
    env.insert("SSH_ASKPASS_REQUIRE".to_string(), "force".to_string());
    // Pre-8.4 fallback: ssh consults askpass only when DISPLAY is set and
    // there's no TTY. The `REQUIRE` env handles modern OpenSSH; this is
    // belt-and-braces for older builds.
    env.insert("DISPLAY".to_string(), ":0".to_string());
    Ok(env)
}
