use notify_debouncer_mini::notify::RecommendedWatcher;
use notify_debouncer_mini::{new_debouncer, notify::RecursiveMode, Debouncer};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::Emitter;

/// Path fragments we never want to walk. Match anywhere in the path string.
const IGNORE_FRAGMENTS: &[&str] = &[
    "/node_modules/",
    "/.git/",
    "/dist/",
    "/.next/",
    "/.nuxt/",
    "/target/",
    "/.turbo/",
    "/.svelte-kit/",
    "/.astro/",
    "/.cache/",
    "/.vercel/",
    "/.output/",
    "/coverage/",
];

/// Classification of a file change. The frontend uses this to decide whether to force a hard
/// reload (replace iframe.src) or stay out of the dev server's HMR way.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReloadKind {
    /// File where the dev server's own HMR will handle the change. We do nothing.
    Soft,
    /// Config file, public asset, html, or env — dev server typically can't HMR these.
    Hard,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReloadEvent {
    pub kind: ReloadKind,
    pub path: String,
}

fn is_ignored(path: &Path) -> bool {
    let s = normalize(path);
    IGNORE_FRAGMENTS.iter().any(|f| s.contains(f))
}

fn normalize(path: &Path) -> String {
    // Collapse OS path separators to '/' for portable fragment matching, with a leading '/'
    // sentinel so "/.git/" can match a hit at the root.
    let s = path.to_string_lossy().replace('\\', "/");
    if s.starts_with('/') { s } else { format!("/{}", s) }
}

/// Classify a single changed path. We pick the strongest signal (Hard wins).
fn classify(path: &Path) -> ReloadKind {
    let s = path.to_string_lossy().to_ascii_lowercase();
    let file = path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_ascii_lowercase();

    // Config files at any depth.
    let config_names: &[&str] = &[
        "vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.cjs",
        "next.config.js", "next.config.mjs", "next.config.ts",
        "astro.config.mjs", "astro.config.js", "astro.config.ts",
        "svelte.config.js", "svelte.config.mjs", "svelte.config.ts",
        "nuxt.config.ts", "nuxt.config.js",
        "remix.config.js", "remix.config.mjs",
        "tailwind.config.js", "tailwind.config.ts", "tailwind.config.mjs",
        "postcss.config.js", "postcss.config.cjs", "postcss.config.mjs",
        "tsconfig.json", "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb",
    ];
    if config_names.iter().any(|n| file == *n) {
        return ReloadKind::Hard;
    }

    // .env* files.
    if file.starts_with(".env") {
        return ReloadKind::Hard;
    }

    // public/ and static/ asset trees — most dev servers cannot HMR these.
    if s.contains("/public/") || s.contains("/static/") {
        return ReloadKind::Hard;
    }

    // Top-level html (e.g. Vite's index.html). Vite reloads the page itself, but doing so via
    // src= is a no-op there too — Hard is safe.
    if file.ends_with(".html") {
        return ReloadKind::Hard;
    }

    ReloadKind::Soft
}

pub fn start_watcher(
    pane_id: String,
    project_path: PathBuf,
    app: tauri::AppHandle,
) -> Result<Debouncer<RecommendedWatcher>, String> {
    let pane_id_clone = pane_id.clone();
    let mut debouncer = new_debouncer(Duration::from_millis(150), move |res| {
        match res {
            Ok(events) => {
                let events: Vec<notify_debouncer_mini::DebouncedEvent> = events;
                // Hard wins over soft when multiple kinds appear in one batch.
                let mut chosen: Option<ReloadEvent> = None;
                for e in &events {
                    if is_ignored(&e.path) { continue; }
                    let kind = classify(&e.path);
                    let path = e.path.to_string_lossy().to_string();
                    let candidate = ReloadEvent { kind, path };
                    match (&chosen, candidate.kind) {
                        (None, _) => chosen = Some(candidate),
                        (Some(c), ReloadKind::Hard) if matches!(c.kind, ReloadKind::Soft) => {
                            chosen = Some(candidate);
                        }
                        _ => {}
                    }
                }
                if let Some(ev) = chosen {
                    let _ = app.emit(&format!("preview:reload:{pane_id_clone}"), ev);
                }
            }
            Err(e) => eprintln!("watch error: {e:?}"),
        }
    })
    .map_err(|e| e.to_string())?;

    debouncer
        .watcher()
        .watch(&project_path, RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    Ok(debouncer)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn p(s: &str) -> PathBuf { PathBuf::from(s) }

    #[test]
    fn classifies_config_files_as_hard() {
        assert!(matches!(classify(&p("/proj/vite.config.ts")), ReloadKind::Hard));
        assert!(matches!(classify(&p("/proj/next.config.js")), ReloadKind::Hard));
        assert!(matches!(classify(&p("/proj/package.json")), ReloadKind::Hard));
        assert!(matches!(classify(&p("/proj/.env.local")), ReloadKind::Hard));
    }

    #[test]
    fn classifies_public_assets_as_hard() {
        assert!(matches!(classify(&p("/proj/public/logo.svg")), ReloadKind::Hard));
        assert!(matches!(classify(&p("/proj/static/style.css")), ReloadKind::Hard));
    }

    #[test]
    fn classifies_source_as_soft() {
        assert!(matches!(classify(&p("/proj/src/App.tsx")), ReloadKind::Soft));
        assert!(matches!(classify(&p("/proj/components/Button.tsx")), ReloadKind::Soft));
        assert!(matches!(classify(&p("/proj/styles.css")), ReloadKind::Soft));
    }

    #[test]
    fn ignores_node_modules() {
        assert!(is_ignored(&p("/proj/node_modules/foo/index.js")));
        assert!(is_ignored(&p("/proj/.git/HEAD")));
        assert!(!is_ignored(&p("/proj/src/App.tsx")));
    }

    #[test]
    fn html_is_hard() {
        assert!(matches!(classify(&p("/proj/index.html")), ReloadKind::Hard));
    }
}
