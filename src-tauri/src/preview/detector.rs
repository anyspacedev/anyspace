use serde::Serialize;
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedPreview {
    pub url: String,
    pub port: u16,
    pub framework: String,
}

const PROBE_PORTS_VITE: &[u16] = &[5173, 5174, 4173];
const PROBE_PORTS_NEXT: &[u16] = &[3000, 3001];
const PROBE_PORTS_ASTRO: &[u16] = &[4321];
const PROBE_PORTS_GENERIC: &[u16] = &[8080, 8000, 5000, 4000, 3000, 5173];

/// Detects which framework a project uses (best-effort) by reading package.json.
pub fn detect_framework(project_path: &Path) -> &'static str {
    let pkg = project_path.join("package.json");
    if !pkg.exists() { return "unknown"; }
    let Ok(content) = std::fs::read_to_string(&pkg) else { return "unknown"; };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) else { return "unknown"; };

    let deps = json.get("dependencies").and_then(|v| v.as_object()).cloned().unwrap_or_default();
    let dev_deps = json.get("devDependencies").and_then(|v| v.as_object()).cloned().unwrap_or_default();
    let has = |name: &str| deps.contains_key(name) || dev_deps.contains_key(name);

    if has("next") { "next" }
    else if has("astro") { "astro" }
    else if has("@sveltejs/kit") { "sveltekit" }
    else if has("nuxt") { "nuxt" }
    else if has("@remix-run/react") { "remix" }
    else if has("vite") { "vite" }
    else { "unknown" }
}

fn ports_for(framework: &str) -> Vec<u16> {
    match framework {
        "next" | "remix" | "nuxt" => PROBE_PORTS_NEXT.into(),
        "vite" => PROBE_PORTS_VITE.into(),
        "astro" => PROBE_PORTS_ASTRO.into(),
        "sveltekit" => PROBE_PORTS_VITE.into(),
        _ => PROBE_PORTS_GENERIC.into(),
    }
}

pub async fn detect(project_path: String) -> Result<Option<DetectedPreview>, String> {
    let path = Path::new(&project_path);
    let framework = detect_framework(path);
    let ports = ports_for(framework);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(250))
        .build()
        .map_err(|e| e.to_string())?;

    for port in ports {
        let url = format!("http://localhost:{port}");
        if client.get(&url).send().await.is_ok() {
            return Ok(Some(DetectedPreview {
                url,
                port,
                framework: framework.to_string(),
            }));
        }
    }
    Ok(None)
}
