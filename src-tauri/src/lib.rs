use tauri::Manager;

mod agent;
mod agent_api;
mod ai;
mod browser;
mod clipboard;
mod fs_ops;
mod git;
mod kanban;
mod knowledge;
mod mobile;
mod net;
mod preview;
mod pty;
mod screenshot;
mod settings;
mod shell_integration;
mod stt;
mod team;
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
    use std::panic::AssertUnwindSafe;

    use objc2::exception;
    use objc2_foundation::{ns_string, NSNumber, NSObjectNSKeyValueCoding, NSString};
    use objc2_web_kit::{WKPreferences, WKWebView};

    let _ = window.with_webview(|webview| {
        let wv_ptr = webview.inner() as *const WKWebView;
        if wv_ptr.is_null() {
            return;
        }
        // Private WKPreferences SPI — without these `navigator.mediaDevices`
        // is undefined on Tauri's custom-scheme origin. wry's WKUIDelegate
        // already grants requestMediaCapturePermissionForOrigin, so flipping
        // the keys is enough to make hold-to-talk work.
        //
        // The available keys differ between WebKit versions (e.g. macOS 14+
        // dropped `mediaDevicesEnabled`), and an unknown key raises
        // NSUndefinedKeyException — which would abort the process across the
        // objc_msgSend boundary. Catch each one individually so we set
        // whatever the running WebKit recognizes and skip the rest.
        let set = |prefs: &WKPreferences, key: &NSString, value: &NSNumber| {
            let _ = exception::catch(AssertUnwindSafe(|| unsafe {
                prefs.setValue_forKey(Some(value), key);
            }));
        };
        unsafe {
            let wv = &*wv_ptr;
            let prefs = wv.configuration().preferences();
            let yes = NSNumber::numberWithBool(true);
            let no = NSNumber::numberWithBool(false);
            set(&prefs, ns_string!("mediaDevicesEnabled"), &yes);
            set(&prefs, ns_string!("mediaCaptureRequiresSecureConnection"), &no);
            set(&prefs, ns_string!("getUserMediaRequiresUserGesture"), &no);
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // WebKitGTK 2.42+ (Debian 12, Ubuntu 22.04+) ships a DMABUF renderer that
    // fails to repaint after window state changes — double-clicking the title
    // bar to maximize/unmaximize leaves the WebView blank and unrecoverable.
    // Falling back to the non-DMABUF renderer fixes the white-screen-on-resize
    // without disabling compositing entirely.
    #[cfg(target_os = "linux")]
    if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default()
            .add_migrations("sqlite:anyspace.db", kanban::db::migrations())
            .build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("anyspace-preview-picker")
                .js_init_script_on_all_frames(PREVIEW_PICKER_SCRIPT)
                .build(),
        )
        .manage(pty::PtyManager::new())
        .manage(preview::PreviewManager::new())
        .manage(browser::BrowserManager::new())
        .manage(mobile::MobileManager::new())
        .manage(team::TeamManager::new())
        .manage(knowledge::KnowledgeManager::new())
        .manage(ai::AiStreamManager::new())
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
            // Browser pane (embedded child WebView)
            browser::commands::browser_create,
            browser::commands::browser_navigate,
            browser::commands::browser_back,
            browser::commands::browser_forward,
            browser::commands::browser_reload,
            browser::commands::browser_resize,
            browser::commands::browser_show,
            browser::commands::browser_hide,
            browser::commands::browser_destroy,
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
            stt::commands::stt_hotkey_set,
            // AI
            ai::commands::ai_chat,
            ai::stream::ai_chat_stream,
            ai::stream::abort_ai_chat_stream,
            // Clipboard
            clipboard::commands::clipboard_save_blob,
            // Screenshot (preview / mobile capture, terminal drop attach)
            screenshot::commands::screenshot_capture_window_region,
            screenshot::commands::screenshot_save_png_bytes,
            // Mobile (Android / iOS pane)
            mobile::commands::mobile_list_devices,
            mobile::commands::mobile_connect,
            mobile::commands::mobile_disconnect,
            mobile::commands::mobile_input,
            mobile::commands::mobile_logs_start,
            mobile::commands::mobile_logs_stop,
            // Workspace persistence
            workspace::commands::workspace_save,
            workspace::commands::workspace_load,
            // Knowledge (project-local notes + wikilinks)
            knowledge::commands::knowledge_init,
            knowledge::commands::knowledge_list,
            knowledge::commands::knowledge_read,
            knowledge::commands::knowledge_write,
            knowledge::commands::knowledge_delete,
            knowledge::commands::knowledge_search,
            knowledge::commands::knowledge_graph,
            knowledge::commands::knowledge_watch_start,
            knowledge::commands::knowledge_watch_stop,
            knowledge::commands::knowledge_project_hash,
            // Team mode
            team::commands::team_init,
            team::commands::team_watch_start,
            team::commands::team_watch_stop,
            team::commands::team_rpc_reply,
            team::commands::team_rpc_drain,
            team::commands::team_write_prompt,
            team::commands::team_compact_messages,
            team::commands::team_append_message,
            team::commands::team_read_messages_text,
            // Agent API (drives Preview from terminal-spawned Code Agents)
            agent_api::commands::agent_api_info,
            agent_api::commands::agent_api_reply,
            agent_api::commands::agent_api_rotate_token,
        ])
        .setup(|app| {
            let window = app.get_webview_window("main").unwrap();
            #[cfg(debug_assertions)]
            window.open_devtools();
            #[cfg(any(target_os = "linux", target_os = "macos"))]
            enable_media_capture(&window);
            #[cfg(target_os = "macos")]
            stt::hotkey_monitor::install(app.handle().clone());
            #[cfg(target_os = "linux")]
            stt::hotkey_monitor_linux::install(app.handle().clone());

            // Bind synchronously so the assigned port is available to anything
            // that reads agent_api_info before the async serve task starts.
            match agent_api::server::bind_local() {
                Ok((std_listener, port)) => {
                    let token = agent_api::auth::load_or_mint(app.handle());
                    let api_state = agent_api::AgentApiState::new(port, token);
                    app.manage(api_state.clone());
                    let app_handle = app.handle().clone();
                    tauri::async_runtime::spawn(async move {
                        agent_api::server::serve(api_state, app_handle, std_listener).await;
                    });
                    println!("[agent_api] server listening on 127.0.0.1:{port}");
                }
                Err(e) => {
                    eprintln!("[agent_api] bind failed: {e:?} — Code Agent preview API disabled");
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running AnySpace");
}
