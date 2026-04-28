use super::adb;
use super::control::{self, TouchAction};
use super::ios_simulator::{IosSimOpts, IosSimSession};
use super::scrcpy::ScrcpyOpts;
use super::session::{AndroidSession, MobileSession};
use super::MobileManager;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{ipc::Channel, AppHandle, State};
use uuid::Uuid;

// Mobile pane Tauri commands. Dispatches by target:
//   - target=android → scrcpy + AndroidSession,
//   - target=ios     → iossimstream helper + IosSimSession (macOS-only).

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileDevice {
    pub id: String,
    /// "android" | "ios"
    pub target: String,
    /// "emulator" | "usb"
    pub source: String,
    pub name: String,
    pub ready: bool,
}

#[tauri::command]
pub async fn mobile_list_devices() -> Result<Vec<MobileDevice>, String> {
    let (android, ios) = tokio::join!(super::adb::list_devices(), super::simctl::list_devices());
    let mut out = android;
    out.extend(ios);
    Ok(out)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileConnectArgs {
    pub pane_id: String,
    pub target: String,
    pub device_id: String,
    pub source: String,
    /// Required for iOS — used by the helper to find the Simulator window.
    /// Optional for Android.
    pub device_name: Option<String>,
    #[serde(default)]
    pub bitrate: Option<u32>,
    #[serde(default)]
    pub max_size: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MobileConnection {
    pub connection_id: String,
    pub width: u32,
    pub height: u32,
    /// "annexb" today; opaque to the frontend besides config-supported probing.
    pub codec: String,
}

#[tauri::command]
pub async fn mobile_connect(
    _app: AppHandle,
    args: MobileConnectArgs,
    on_video: Channel<Vec<u8>>,
    manager: State<'_, MobileManager>,
) -> Result<MobileConnection, String> {
    // Per-paneId lock. Held across dedup + spawn + insert so concurrent
    // connects for the same pane (StrictMode's double-mount) serialise
    // and the second one definitely sees the first session in the manager.
    let pane_lock = {
        let entry = manager
            .connect_locks
            .entry(args.pane_id.clone())
            .or_insert_with(|| Arc::new(tokio::sync::Mutex::new(())));
        entry.value().clone()
    };
    let _guard = pane_lock.lock().await;

    // Dedup by paneId. macOS' SCK doesn't tolerate two streams on the same
    // window from the same parent process, so we tear down any previous
    // session for this pane *synchronously* before spawning the new one.
    let stale: Vec<(String, Arc<MobileSession>)> = manager
        .sessions
        .iter()
        .filter(|r| r.value().pane_id() == args.pane_id)
        .map(|r| (r.key().clone(), Arc::clone(r.value())))
        .collect();
    for (cid, session) in stale {
        manager.sessions.remove(&cid);
        session.disconnect().await;
    }

    let session = match args.target.as_str() {
        "android" => connect_android(&args, on_video).await?,
        "ios" => connect_ios(&args, on_video).await?,
        other => return Err(format!("unknown target {other:?}")),
    };

    let connection_id = Uuid::new_v4().to_string();
    let width = session.width();
    let height = session.height();
    let codec = session.codec().to_string();
    manager.sessions.insert(connection_id.clone(), session);

    Ok(MobileConnection {
        connection_id,
        width,
        height,
        codec,
    })
}

async fn connect_android(
    args: &MobileConnectArgs,
    on_video: Channel<Vec<u8>>,
) -> Result<Arc<MobileSession>, String> {
    let adb_path = adb::locate_adb().ok_or_else(|| {
        "adb not found in PATH or $ANDROID_HOME/platform-tools. Install Android SDK \
         platform-tools (`apt install adb`, `brew install android-platform-tools`, or \
         the Android Studio SDK Manager)."
            .to_string()
    })?;
    let opts = ScrcpyOpts {
        adb: adb_path,
        serial: args.device_id.clone(),
        max_size: args.max_size.unwrap_or(0),
        bit_rate: args.bitrate.unwrap_or(8_000_000),
    };
    let android = AndroidSession::connect(args.pane_id.clone(), opts, on_video)
        .await
        .map_err(|e| format!("{e:#}"))?;
    Ok(Arc::new(MobileSession::Android(android)))
}

async fn connect_ios(
    args: &MobileConnectArgs,
    on_video: Channel<Vec<u8>>,
) -> Result<Arc<MobileSession>, String> {
    if !cfg!(target_os = "macos") {
        return Err(
            "iOS Simulator streaming requires a macOS host (Apple licensing forbids running \
             iOS Simulator on Linux/Windows). Use the Appetize.io fallback in a future \
             release for cloud iOS on non-Mac hosts."
                .into(),
        );
    }
    let device_name = args
        .device_name
        .clone()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            "iOS connect requires deviceName (set by the device chooser when picking a simulator)"
                .to_string()
        })?;
    let opts = IosSimOpts {
        device_id: args.device_id.clone(),
        device_name,
        bitrate: args.bitrate.unwrap_or(6_000_000),
    };
    let ios = IosSimSession::connect(args.pane_id.clone(), opts, on_video)
        .await
        .map_err(|e| format!("{e:#}"))?;
    Ok(Arc::new(MobileSession::IosSimulator(ios)))
}

#[tauri::command]
pub async fn mobile_disconnect(
    connection_id: String,
    manager: State<'_, MobileManager>,
) -> Result<(), String> {
    let removed: Option<Arc<MobileSession>> =
        manager.sessions.remove(&connection_id).map(|(_, v)| v);
    if let Some(session) = removed {
        session.disconnect().await;
    }
    Ok(())
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum InputEvent {
    Touch {
        action: String,
        x: i32,
        y: i32,
        #[serde(rename = "pointerId")]
        pointer_id: i64,
        #[serde(rename = "screenWidth")]
        screen_width: u16,
        #[serde(rename = "screenHeight")]
        screen_height: u16,
    },
    Scroll {
        x: i32,
        y: i32,
        #[serde(rename = "screenWidth")]
        screen_width: u16,
        #[serde(rename = "screenHeight")]
        screen_height: u16,
        dx: f32,
        dy: f32,
    },
    Back,
    Home,
    AppSwitch,
}

#[tauri::command]
pub fn mobile_input(
    connection_id: String,
    event: InputEvent,
    manager: State<'_, MobileManager>,
) -> Result<(), String> {
    // Clone the Arc out so the dashmap shard reference doesn't span the dispatch.
    let session: Arc<MobileSession> = manager
        .sessions
        .get(&connection_id)
        .map(|r| r.value().clone())
        .ok_or_else(|| format!("no session for connectionId={connection_id}"))?;
    session.send_input(&event).map_err(|e| e.to_string())
}

pub(super) fn encode_android_input(event: &InputEvent) -> Result<Vec<u8>, String> {
    Ok(match event {
        InputEvent::Touch {
            action,
            x,
            y,
            pointer_id,
            screen_width,
            screen_height,
        } => {
            let action = match action.as_str() {
                "down" => TouchAction::Down,
                "up" => TouchAction::Up,
                "move" => TouchAction::Move,
                other => return Err(format!("unknown touch action {other:?}")),
            };
            control::encode_touch(action, *pointer_id, *x, *y, *screen_width, *screen_height)
                .to_vec()
        }
        InputEvent::Scroll {
            x,
            y,
            screen_width,
            screen_height,
            dx,
            dy,
        } => control::encode_scroll(*x, *y, *screen_width, *screen_height, *dx, *dy).to_vec(),
        InputEvent::Back => {
            let mut buf = Vec::with_capacity(4);
            buf.extend_from_slice(&control::encode_back_or_screen_on(true));
            buf.extend_from_slice(&control::encode_back_or_screen_on(false));
            buf
        }
        InputEvent::Home => synth_keypress(control::KEYCODE_HOME),
        InputEvent::AppSwitch => synth_keypress(control::KEYCODE_APP_SWITCH),
    })
}

fn synth_keypress(keycode: i32) -> Vec<u8> {
    let mut buf = Vec::with_capacity(28);
    buf.extend_from_slice(&control::encode_keycode(true, keycode, 0, 0));
    buf.extend_from_slice(&control::encode_keycode(false, keycode, 0, 0));
    buf
}

#[tauri::command]
pub async fn mobile_logs_start(
    connection_id: String,
    on_line: Channel<super::logs::LogLine>,
    manager: State<'_, MobileManager>,
) -> Result<(), String> {
    let session: Arc<MobileSession> = manager
        .sessions
        .get(&connection_id)
        .map(|r| r.clone())
        .ok_or_else(|| format!("no session for connectionId={connection_id}"))?;
    session
        .start_logs(on_line)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn mobile_logs_stop(
    connection_id: String,
    manager: State<'_, MobileManager>,
) -> Result<(), String> {
    let session: Option<Arc<MobileSession>> =
        manager.sessions.get(&connection_id).map(|r| r.clone());
    if let Some(s) = session {
        s.stop_logs().await;
    }
    Ok(())
}
