use tauri::Manager;

mod agent;
mod ai;
mod fs_ops;
mod git;
mod kanban;
mod preview;
mod pty;
mod settings;
mod shell_integration;
mod stt;
mod workspace;

const PREVIEW_PICKER_SCRIPT: &str = include_str!("preview/picker_script.js");

#[cfg(target_os = "linux")]
fn enable_media_capture(window: &tauri::WebviewWindow) {
    use webkit2gtk::{
        glib::ObjectExt, PermissionRequestExt, SettingsExt, UserMediaPermissionRequest,
        WebViewExt,
    };
    let _ = window.with_webview(|webview| {
        let wv = webview.inner();
        if let Some(settings) = WebViewExt::settings(&wv) {
            settings.set_enable_media_stream(true);
            settings.set_enable_mediasource(true);
        }
        wv.connect_permission_request(|_, request| {
            if request.is::<UserMediaPermissionRequest>() {
                request.allow();
                true
            } else {
                false
            }
        });
    });
}

#[cfg(target_os = "macos")]
fn enable_media_capture(window: &tauri::WebviewWindow) {
    use objc2_foundation::{ns_string, NSNumber, NSObjectNSKeyValueCoding};
    use objc2_web_kit::WKWebView;

    let _ = window.with_webview(|webview| {
        let wv_ptr = webview.inner() as *const WKWebView;
        if wv_ptr.is_null() {
            return;
        }
        unsafe {
            let wv = &*wv_ptr;
            let prefs = wv.configuration().preferences();
            let yes = NSNumber::numberWithBool(true);
            let no = NSNumber::numberWithBool(false);
            // Private WKPreferences SPI — without these `navigator.mediaDevices`
            // is undefined on Tauri's custom-scheme origin. wry's WKUIDelegate
            // already grants requestMediaCapturePermissionForOrigin, so flipping
            // the keys is enough to make hold-to-talk work.
            prefs.setValue_forKey(Some(&yes), ns_string!("mediaDevicesEnabled"));
            prefs.setValue_forKey(Some(&no), ns_string!("mediaCaptureRequiresSecureConnection"));
            prefs.setValue_forKey(Some(&no), ns_string!("getUserMediaRequiresUserGesture"));
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default()
            .add_migrations("sqlite:teamship.db", kanban::db::migrations())
            .build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("teamship-preview-picker")
                .js_init_script_on_all_frames(PREVIEW_PICKER_SCRIPT)
                .build(),
        )
        .manage(pty::PtyManager::new())
        .manage(preview::PreviewManager::new())
        .invoke_handler(tauri::generate_handler![
            // PTY
            pty::commands::pty_spawn,
            pty::commands::pty_write,
            pty::commands::pty_resize,
            pty::commands::pty_kill,
            // Preview
            preview::commands::preview_detect,
            preview::commands::preview_can_frame,
            preview::commands::preview_watch_start,
            preview::commands::preview_watch_stop,
            // Agent
            agent::commands::agent_launch,
            // FS (helpers beyond plugin scope)
            fs_ops::commands::fs_list_dir_recursive,
            // Git
            git::commands::git_status,
            // Settings
            settings::commands::settings_get,
            settings::commands::settings_set,
            // STT
            stt::commands::stt_transcribe,
            // AI
            ai::commands::ai_chat,
            // Workspace persistence
            workspace::commands::workspace_save,
            workspace::commands::workspace_load,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            #[cfg(debug_assertions)]
            window.open_devtools();
            #[cfg(any(target_os = "linux", target_os = "macos"))]
            enable_media_capture(&window);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Teamship");
}
