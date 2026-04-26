//! Centralized HTTP client construction. Every outbound `reqwest` request in
//! the app is built through here so user-configured proxy settings (read from
//! the `"proxy"` key in `settings.json`) apply uniformly.
//!
//! Settings are read per call. Building a `ClientBuilder`/`Client` is cheap
//! and this avoids a cache-invalidation event when the user edits settings.

use reqwest::{Client, ClientBuilder, NoProxy, Proxy};
use serde::Deserialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

/// Always excluded from proxying. Local dev servers (Vite/Next/etc.) are
/// reached over loopback by `preview_detect` and the user's own AI/STT
/// endpoints may also be local — proxying them would just break things.
const ALWAYS_NO_PROXY: &str = "localhost,127.0.0.1,::1";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProxySettings {
    #[serde(default)]
    mode: Mode,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    http_url: Option<String>,
    #[serde(default)]
    https_url: Option<String>,
    #[serde(default)]
    no_proxy: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum Mode {
    #[default]
    Off,
    Manual,
}

fn settings_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_config_dir().ok()?;
    Some(dir.join("settings.json"))
}

fn load_proxy_settings(app: &AppHandle) -> ProxySettings {
    let default = ProxySettings {
        mode: Mode::Off,
        url: None,
        http_url: None,
        https_url: None,
        no_proxy: None,
    };
    let Some(path) = settings_path(app) else { return default };
    let Ok(text) = std::fs::read_to_string(&path) else { return default };
    let Ok(root) = serde_json::from_str::<serde_json::Value>(&text) else { return default };
    let Some(value) = root.get("proxy") else { return default };
    serde_json::from_value::<ProxySettings>(value.clone()).unwrap_or(default)
}

fn merged_no_proxy(user: Option<&str>) -> Option<NoProxy> {
    let combined = match user {
        Some(extra) if !extra.trim().is_empty() => {
            format!("{ALWAYS_NO_PROXY},{}", extra.trim())
        }
        _ => ALWAYS_NO_PROXY.to_string(),
    };
    NoProxy::from_string(&combined)
}

fn apply_proxies(builder: ClientBuilder, settings: &ProxySettings) -> reqwest::Result<ClientBuilder> {
    if settings.mode == Mode::Off {
        return Ok(builder.no_proxy());
    }

    let no_proxy = merged_no_proxy(settings.no_proxy.as_deref());
    let mut builder = builder.no_proxy();

    let has_scheme_overrides =
        settings.http_url.as_deref().is_some_and(|s| !s.is_empty())
            || settings.https_url.as_deref().is_some_and(|s| !s.is_empty());

    if has_scheme_overrides {
        if let Some(http) = settings.http_url.as_deref().filter(|s| !s.is_empty()) {
            let mut p = Proxy::http(http)?;
            if let Some(np) = &no_proxy {
                p = p.no_proxy(Some(np.clone()));
            }
            builder = builder.proxy(p);
        }
        if let Some(https) = settings.https_url.as_deref().filter(|s| !s.is_empty()) {
            let mut p = Proxy::https(https)?;
            if let Some(np) = &no_proxy {
                p = p.no_proxy(Some(np.clone()));
            }
            builder = builder.proxy(p);
        }
    } else if let Some(url) = settings.url.as_deref().filter(|s| !s.is_empty()) {
        let mut p = Proxy::all(url)?;
        if let Some(np) = no_proxy {
            p = p.no_proxy(Some(np));
        }
        builder = builder.proxy(p);
    }

    Ok(builder)
}

/// Returns a `ClientBuilder` with the user's proxy configuration applied.
/// Callers chain their own timeout/redirect/header config before `.build()`.
pub fn http_client_builder(app: &AppHandle) -> reqwest::Result<ClientBuilder> {
    let settings = load_proxy_settings(app);
    apply_proxies(Client::builder(), &settings)
}

/// Returns a fully-built `Client` with default settings + proxy applied.
pub fn http_client(app: &AppHandle) -> reqwest::Result<Client> {
    http_client_builder(app)?.build()
}
