use serde::Serialize;
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedPreview {
    pub url: String,
    pub port: u16,
    pub framework: String,
    /// Did we positively identify framework markers in the response (e.g. Vite client script)?
    pub verified: bool,
}

const PROBE_PORTS_VITE: &[u16] = &[5173, 5174, 4173];
const PROBE_PORTS_NEXT: &[u16] = &[3000, 3001];
const PROBE_PORTS_ASTRO: &[u16] = &[4321, 3000];
const PROBE_PORTS_GENERIC: &[u16] = &[8080, 8000, 5000, 4000, 3000, 5173];
const PROBE_HOSTS: &[&str] = &["127.0.0.1", "localhost"];

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

/// Try to extract a configured dev-server port. Best-effort regex-style extraction; we don't
/// execute project code. Looks at `vite.config.*`, `next.config.*`, and `package.json` scripts.
fn configured_port(project_path: &Path, framework: &str) -> Option<u16> {
    if let Some(p) = port_from_package_scripts(project_path, framework) {
        return Some(p);
    }
    match framework {
        "vite" | "sveltekit" => port_from_config_file(project_path, &["vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.cjs"], r"server\s*:\s*\{[^}]*port\s*:\s*(\d{2,5})"),
        "next" | "remix" => port_from_config_file(project_path, &["next.config.js", "next.config.mjs", "next.config.ts"], r"port\s*:\s*(\d{2,5})"),
        "astro" => port_from_config_file(project_path, &["astro.config.mjs", "astro.config.js", "astro.config.ts"], r"server\s*:\s*\{[^}]*port\s*:\s*(\d{2,5})"),
        _ => None,
    }
}

fn port_from_package_scripts(project_path: &Path, framework: &str) -> Option<u16> {
    let pkg = project_path.join("package.json");
    let content = std::fs::read_to_string(&pkg).ok()?;
    let json: serde_json::Value = serde_json::from_str(&content).ok()?;
    let scripts = json.get("scripts")?.as_object()?;
    // Prefer `dev` then `start` then any other.
    let candidates = ["dev", "start", "serve"];
    for key in candidates.iter() {
        if let Some(val) = scripts.get(*key).and_then(|v| v.as_str()) {
            if let Some(p) = extract_port_flag(val, framework) {
                return Some(p);
            }
        }
    }
    None
}

fn extract_port_flag(cmd: &str, _framework: &str) -> Option<u16> {
    // Match `--port 1234`, `--port=1234`, `-p 1234`, `-p=1234` (case-insensitive on long form).
    // We avoid pulling in regex; do a simple scan.
    let bytes = cmd.as_bytes();
    let lower = cmd.to_ascii_lowercase();
    let needles: &[&str] = &["--port", "-p"];
    for n in needles {
        let mut start = 0;
        while let Some(idx) = lower[start..].find(n) {
            let abs = start + idx;
            // Boundary check: previous char must not be alphanumeric (avoid matching "--port-foo").
            if abs > 0 {
                let prev = bytes[abs - 1];
                if prev.is_ascii_alphanumeric() { start = abs + n.len(); continue; }
            }
            let after = abs + n.len();
            if after >= bytes.len() { break; }
            // Next char must be space, '=' or end.
            let next = bytes[after];
            if !(next == b' ' || next == b'=' || next == b'\t') {
                start = abs + n.len();
                continue;
            }
            // Skip separator.
            let mut i = after + 1;
            while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') { i += 1; }
            // Read digits.
            let mut j = i;
            while j < bytes.len() && bytes[j].is_ascii_digit() { j += 1; }
            if j > i {
                if let Ok(p) = cmd[i..j].parse::<u16>() {
                    return Some(p);
                }
            }
            start = abs + n.len();
        }
    }
    None
}

fn port_from_config_file(project_path: &Path, candidates: &[&str], pattern: &str) -> Option<u16> {
    for name in candidates {
        let path = project_path.join(name);
        if !path.exists() { continue; }
        let Ok(content) = std::fs::read_to_string(&path) else { continue; };
        if let Some(p) = scan_pattern_port(&content, pattern) {
            return Some(p);
        }
    }
    None
}

/// Tiny pattern matcher tailored to extracting a port number.
/// `pattern` is one of two well-known shapes; we only honor the trailing `(\d+)` capture.
fn scan_pattern_port(content: &str, pattern: &str) -> Option<u16> {
    // We intentionally don't depend on the regex crate. Recognize the two patterns by prefix.
    if pattern.starts_with("server") {
        // Look for `server` block then `port: <num>`.
        let lower = content.to_ascii_lowercase();
        let server_idx = lower.find("server")?;
        let after = &content[server_idx..];
        scan_port_field(after)
    } else {
        // `port: <num>` anywhere.
        scan_port_field(content)
    }
}

fn scan_port_field(s: &str) -> Option<u16> {
    let lower = s.to_ascii_lowercase();
    let mut from = 0;
    while let Some(idx) = lower[from..].find("port") {
        let abs = from + idx;
        // Boundary: previous char not alphanumeric (so we don't match "import").
        if abs > 0 {
            let prev = s.as_bytes()[abs - 1];
            if prev.is_ascii_alphanumeric() || prev == b'_' {
                from = abs + 4;
                continue;
            }
        }
        let mut i = abs + 4;
        let bytes = s.as_bytes();
        // Skip whitespace + ':' + whitespace.
        while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') { i += 1; }
        if i < bytes.len() && bytes[i] == b':' { i += 1; }
        while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') { i += 1; }
        let mut j = i;
        while j < bytes.len() && bytes[j].is_ascii_digit() { j += 1; }
        if j > i {
            if let Ok(p) = s[i..j].parse::<u16>() {
                return Some(p);
            }
        }
        from = abs + 4;
    }
    None
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

/// Verify a response body looks like the expected framework. Conservative: we treat unknown as
/// unverified rather than rejecting, so generic dev servers still surface.
fn verify_framework(body: &str, headers: &reqwest::header::HeaderMap, framework: &str) -> bool {
    let body_lower = body.to_ascii_lowercase();
    match framework {
        "vite" => body_lower.contains("/@vite/client") || body_lower.contains("vite-plugin"),
        "next" => headers
            .get("x-powered-by")
            .and_then(|v| v.to_str().ok())
            .map(|v| v.eq_ignore_ascii_case("Next.js"))
            .unwrap_or(false)
            || body_lower.contains("/_next/")
            || body_lower.contains("__next_data__"),
        "astro" => body_lower.contains("astro-island") || body_lower.contains("/@astro/"),
        "sveltekit" => body_lower.contains("/_app/") || body_lower.contains("svelte-kit"),
        "nuxt" => body_lower.contains("__nuxt") || body_lower.contains("/_nuxt/"),
        "remix" => body_lower.contains("__remixContext") || body_lower.contains("/build/_assets/"),
        _ => false,
    }
}

pub async fn detect(project_path: String) -> Result<Option<DetectedPreview>, String> {
    let path = Path::new(&project_path);
    let framework = detect_framework(path);

    // Compose port priority: configured port first, then framework defaults, then a generic
    // fallback. Dedupe while preserving order.
    let mut ports: Vec<u16> = Vec::new();
    if let Some(p) = configured_port(path, framework) { ports.push(p); }
    for p in ports_for(framework) { if !ports.contains(&p) { ports.push(p); } }
    for p in PROBE_PORTS_GENERIC { if !ports.contains(p) { ports.push(*p); } }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(400))
        // Some dev servers redirect /; follow once so we can read the body.
        .redirect(reqwest::redirect::Policy::limited(2))
        .build()
        .map_err(|e| e.to_string())?;

    // First pass: prefer a verified hit. Second pass: accept any reachable hit.
    let mut fallback: Option<DetectedPreview> = None;

    for host in PROBE_HOSTS {
        for port in &ports {
            let url = format!("http://{host}:{port}");
            let Ok(resp) = client.get(&url).send().await else { continue };
            if !resp.status().is_success() && !resp.status().is_redirection() { continue; }
            let headers = resp.headers().clone();
            let body = resp.text().await.unwrap_or_default();
            let verified = framework != "unknown" && verify_framework(&body, &headers, framework);
            let candidate = DetectedPreview {
                url,
                port: *port,
                framework: framework.to_string(),
                verified,
            };
            if verified {
                return Ok(Some(candidate));
            }
            if fallback.is_none() {
                fallback = Some(candidate);
            }
        }
    }

    Ok(fallback)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_port_from_long_flag() {
        assert_eq!(extract_port_flag("next dev --port 4001", "next"), Some(4001));
        assert_eq!(extract_port_flag("vite --port=5180 --host", "vite"), Some(5180));
    }

    #[test]
    fn extracts_port_from_short_flag() {
        assert_eq!(extract_port_flag("next dev -p 4002", "next"), Some(4002));
        assert_eq!(extract_port_flag("foo -p=4003", "foo"), Some(4003));
    }

    #[test]
    fn ignores_lookalike_flags() {
        assert_eq!(extract_port_flag("next dev --port-prefix 9", "next"), None);
        assert_eq!(extract_port_flag("foo --teleport 8080", "foo"), None);
    }

    #[test]
    fn finds_port_field_in_config_text() {
        let txt = r#"
            export default defineConfig({
              server: {
                host: '0.0.0.0',
                port: 5180,
              },
            });
        "#;
        assert_eq!(scan_port_field(txt), Some(5180));
    }

    #[test]
    fn skips_lookalike_words_when_scanning() {
        // "import" contains "port" but should be ignored by the boundary check.
        // Only the real `port: 4321` field is picked up.
        let txt = "import x from 'y'; export const cfg = { port: 4321 };";
        assert_eq!(scan_port_field(txt), Some(4321));
    }

    #[test]
    fn returns_none_when_no_port_field() {
        let txt = "import x from 'y'; const transportSize = 100;";
        assert_eq!(scan_port_field(txt), None);
    }
}
