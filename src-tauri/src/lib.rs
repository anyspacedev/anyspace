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
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Teamship");
}
