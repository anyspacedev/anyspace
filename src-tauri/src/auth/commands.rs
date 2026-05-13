use tauri::{AppHandle, State};

use super::{DesktopAuthManager, DesktopAuthSession};

#[tauri::command]
pub fn desktop_auth_begin(
    app: AppHandle,
    state: State<'_, DesktopAuthManager>,
) -> Result<DesktopAuthSession, String> {
    state.begin(app)
}

#[tauri::command]
pub fn desktop_auth_cancel(state: State<'_, DesktopAuthManager>) {
    state.cancel();
}
