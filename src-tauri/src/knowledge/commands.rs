use super::watcher::start_knowledge_watcher;
use super::{KnowledgeManager, KNOWLEDGE_DIR_PREFIX};
use anyhow::Context;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};

// ============================================================================
// Types
// ============================================================================

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteSummary {
    pub slug: String,
    pub title: String,
    pub created: i64,
    pub updated: i64,
    pub tags: Vec<String>,
    pub preview: String,
    pub backlink_count: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RefLink {
    pub target_slug: Option<String>,
    pub target_title: String,
    pub resolved: bool,
    pub context: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacklinkRef {
    pub source_slug: String,
    pub source_title: String,
    pub context: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub slug: String,
    pub title: String,
    pub body: String,
    pub created: i64,
    pub updated: i64,
    pub tags: Vec<String>,
    pub backlinks: Vec<BacklinkRef>,
    pub outbound: Vec<RefLink>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeNode {
    pub slug: String,
    pub title: String,
    pub backlink_count: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeEdge {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeGraph {
    pub nodes: Vec<KnowledgeNode>,
    pub edges: Vec<KnowledgeEdge>,
}

// ============================================================================
// Path / slug helpers
// ============================================================================

fn knowledge_dir(project_path: &str) -> PathBuf {
    PathBuf::from(project_path).join(KNOWLEDGE_DIR_PREFIX)
}

pub fn slugify(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last_dash = true;
    for ch in s.chars() {
        let c = ch.to_ascii_lowercase();
        if c.is_ascii_alphanumeric() {
            out.push(c);
            last_dash = false;
        } else if !last_dash {
            out.push('-');
            last_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        out.push_str("untitled");
    }
    out
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

// ============================================================================
// Frontmatter parser (hand-rolled, no serde_yaml needed)
// ============================================================================

#[derive(Debug, Default)]
struct Frontmatter {
    title: Option<String>,
    created: Option<i64>,
    updated: Option<i64>,
    tags: Vec<String>,
}

/// Returns `(frontmatter, body)`. If the file doesn't start with `---`,
/// returns a default Frontmatter and the whole content as body.
fn parse_file(content: &str) -> (Frontmatter, String) {
    let mut fm = Frontmatter::default();
    let trimmed_start = content.trim_start_matches('\u{feff}');
    if !trimmed_start.starts_with("---") {
        return (fm, content.to_string());
    }
    // Find the closing ---
    let after_open = match trimmed_start.find('\n') {
        Some(i) => &trimmed_start[i + 1..],
        None => return (fm, String::new()),
    };
    let close_idx = match after_open.find("\n---") {
        Some(i) => i,
        None => return (fm, content.to_string()),
    };
    let fm_block = &after_open[..close_idx];
    let body_start = close_idx + 4; // past "\n---"
    let body = after_open[body_start..]
        .trim_start_matches('\n')
        .to_string();

    for line in fm_block.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let (key, value) = match line.split_once(':') {
            Some((k, v)) => (k.trim(), v.trim()),
            None => continue,
        };
        match key {
            "title" => fm.title = Some(strip_quotes(value).to_string()),
            "created" => fm.created = value.parse().ok(),
            "updated" => fm.updated = value.parse().ok(),
            "tags" => fm.tags = parse_tags(value),
            _ => {}
        }
    }
    (fm, body)
}

fn strip_quotes(s: &str) -> &str {
    let s = s.trim();
    if (s.starts_with('"') && s.ends_with('"') && s.len() >= 2)
        || (s.starts_with('\'') && s.ends_with('\'') && s.len() >= 2)
    {
        &s[1..s.len() - 1]
    } else {
        s
    }
}

fn parse_tags(value: &str) -> Vec<String> {
    let v = value.trim();
    let inner = v
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .unwrap_or(v);
    inner
        .split(',')
        .map(|t| strip_quotes(t.trim()).to_string())
        .filter(|t| !t.is_empty())
        .collect()
}

fn serialize_note(title: &str, created: i64, updated: i64, tags: &[String], body: &str) -> String {
    let tags_str = if tags.is_empty() {
        "[]".to_string()
    } else {
        let inner = tags
            .iter()
            .map(|t| t.as_str())
            .collect::<Vec<_>>()
            .join(", ");
        format!("[{inner}]")
    };
    let body_norm = if body.is_empty() || body.starts_with('\n') {
        body.to_string()
    } else {
        format!("\n{body}")
    };
    format!(
        "---\ntitle: {title}\ncreated: {created}\nupdated: {updated}\ntags: {tags_str}\n---\n{body_norm}",
        title = title.replace('\n', " ").trim()
    )
}

// ============================================================================
// Wikilink scanner
// ============================================================================

/// Find `[[ref]]` occurrences in body. Returns list of `(refstr, byte_start, byte_end_exclusive_of_closing)`.
fn find_wikilinks(body: &str) -> Vec<(String, usize, usize)> {
    let bytes = body.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i + 1 < bytes.len() {
        if bytes[i] == b'[' && bytes[i + 1] == b'[' {
            let start = i + 2;
            // Scan for `]]` — bail if we hit a newline (no multi-line refs).
            let mut j = start;
            let mut found = false;
            while j + 1 < bytes.len() {
                if bytes[j] == b'\n' {
                    break;
                }
                if bytes[j] == b']' && bytes[j + 1] == b']' {
                    found = true;
                    break;
                }
                j += 1;
            }
            if found && j > start {
                if let Ok(refstr) = std::str::from_utf8(&bytes[start..j]) {
                    out.push((refstr.trim().to_string(), start, j));
                }
                i = j + 2;
                continue;
            }
        }
        i += 1;
    }
    out
}

fn context_around(body: &str, start: usize, end: usize, radius: usize) -> String {
    let len = body.len();
    let pre_start = start.saturating_sub(radius);
    let post_end = (end + 2 + radius).min(len);
    // Snap to char boundaries.
    let mut pre = pre_start;
    while pre > 0 && !body.is_char_boundary(pre) {
        pre -= 1;
    }
    let mut post = post_end;
    while post < len && !body.is_char_boundary(post) {
        post += 1;
    }
    let snippet = body[pre..post].replace('\n', " ");
    let snippet = snippet.trim().to_string();
    if pre > 0 {
        format!("…{snippet}")
    } else {
        snippet
    }
}

fn make_preview(body: &str) -> String {
    // Skip blank lines, return the first non-blank line stripped of wikilink
    // brackets, truncated to ~100 chars.
    for line in body.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with("---") {
            continue;
        }
        let mut s = trimmed.to_string();
        // Strip wikilink brackets but keep the ref text.
        s = s.replace("[[", "").replace("]]", "");
        // Strip leading markdown markers (# > - * ).
        let s = s
            .trim_start_matches(|c: char| matches!(c, '#' | '>' | '-' | '*' | ' '))
            .to_string();
        if s.is_empty() {
            continue;
        }
        let mut chars: Vec<char> = s.chars().collect();
        if chars.len() > 100 {
            chars.truncate(100);
            return format!("{}…", chars.iter().collect::<String>());
        }
        return chars.iter().collect();
    }
    String::new()
}

// ============================================================================
// Directory scan + index
// ============================================================================

struct NoteIndexEntry {
    slug: String,
    title: String,
    created: i64,
    updated: i64,
    tags: Vec<String>,
    body: String,
}

fn scan_dir(project_path: &str) -> anyhow::Result<Vec<NoteIndexEntry>> {
    let dir = knowledge_dir(project_path);
    if !dir.is_dir() {
        return Ok(vec![]);
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).with_context(|| format!("read_dir {}", dir.display()))? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue;
        }
        let slug = match path.file_stem().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        // Skip dotfiles, README, and our archive sentinels.
        if slug.starts_with('.') || slug == "README" {
            continue;
        }
        let content = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => continue,
        };
        let (fm, body) = parse_file(&content);
        let modified = std::fs::metadata(&path)
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);
        let title = fm.title.unwrap_or_else(|| slug.replace('-', " "));
        let created = fm.created.unwrap_or(modified);
        let updated = fm.updated.unwrap_or(modified);
        out.push(NoteIndexEntry {
            slug,
            title,
            created,
            updated,
            tags: fm.tags,
            body,
        });
    }
    Ok(out)
}

/// Resolve a wikilink ref string to a known slug. Tries exact slug first,
/// then case-insensitive title match, then slugified ref.
fn resolve_ref(refstr: &str, by_slug: &HashMap<String, usize>, by_title_lower: &HashMap<String, usize>) -> Option<usize> {
    if let Some(&i) = by_slug.get(refstr) {
        return Some(i);
    }
    if let Some(&i) = by_title_lower.get(&refstr.to_ascii_lowercase()) {
        return Some(i);
    }
    let s = slugify(refstr);
    by_slug.get(&s).copied()
}

fn build_lookups(notes: &[NoteIndexEntry]) -> (HashMap<String, usize>, HashMap<String, usize>) {
    let mut by_slug = HashMap::with_capacity(notes.len());
    let mut by_title = HashMap::with_capacity(notes.len());
    for (i, n) in notes.iter().enumerate() {
        by_slug.insert(n.slug.clone(), i);
        by_title.insert(n.title.to_ascii_lowercase(), i);
    }
    (by_slug, by_title)
}

fn count_backlinks(notes: &[NoteIndexEntry]) -> Vec<u32> {
    let (by_slug, by_title) = build_lookups(notes);
    let mut counts = vec![0u32; notes.len()];
    for n in notes.iter() {
        let refs = find_wikilinks(&n.body);
        // Dedupe within a single note (multiple refs to the same target only count once).
        let mut seen = std::collections::HashSet::new();
        for (refstr, _, _) in refs {
            if let Some(target_idx) = resolve_ref(&refstr, &by_slug, &by_title) {
                if seen.insert(target_idx) {
                    counts[target_idx] += 1;
                }
            }
        }
    }
    counts
}

fn to_summary(n: &NoteIndexEntry, backlink_count: u32) -> NoteSummary {
    NoteSummary {
        slug: n.slug.clone(),
        title: n.title.clone(),
        created: n.created,
        updated: n.updated,
        tags: n.tags.clone(),
        preview: make_preview(&n.body),
        backlink_count,
    }
}

// ============================================================================
// Commands
// ============================================================================

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectArgs {
    pub project_path: String,
}

#[tauri::command]
pub fn knowledge_init(args: ProjectArgs) -> Result<(), String> {
    init_impl(&args.project_path).map_err(|e| format!("{e:#}"))
}

fn init_impl(project_path: &str) -> anyhow::Result<()> {
    let project = PathBuf::from(project_path);
    if !project.is_dir() {
        anyhow::bail!("project path is not a directory: {}", project.display());
    }
    let dir = knowledge_dir(project_path);
    std::fs::create_dir_all(&dir).with_context(|| format!("create {}", dir.display()))?;
    let readme = dir.join("README.md");
    if !readme.exists() {
        let seed = "# Knowledge\n\nThis folder holds project-local notes. Each `.md` file is one note. \
                    Link between them with `[[Note Title]]` or `[[note-slug]]`.\n\n\
                    These files live in your repo (gitignored by anyspace) and survive across sessions.\n";
        std::fs::write(&readme, seed).context("write README.md")?;
    }
    Ok(())
}

#[tauri::command]
pub fn knowledge_list(args: ProjectArgs) -> Result<Vec<NoteSummary>, String> {
    list_impl(&args.project_path).map_err(|e| format!("{e:#}"))
}

fn list_impl(project_path: &str) -> anyhow::Result<Vec<NoteSummary>> {
    let mut notes = scan_dir(project_path)?;
    let counts = count_backlinks(&notes);
    let mut out: Vec<NoteSummary> = notes
        .iter()
        .enumerate()
        .map(|(i, n)| to_summary(n, counts[i]))
        .collect();
    out.sort_by(|a, b| b.updated.cmp(&a.updated));
    // Drop the temporary scan buffer once summaries are computed.
    notes.clear();
    Ok(out)
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadArgs {
    pub project_path: String,
    pub slug: String,
}

#[tauri::command]
pub fn knowledge_read(args: ReadArgs) -> Result<Note, String> {
    read_impl(&args.project_path, &args.slug).map_err(|e| format!("{e:#}"))
}

fn read_impl(project_path: &str, slug: &str) -> anyhow::Result<Note> {
    let notes = scan_dir(project_path)?;
    let (by_slug, by_title) = build_lookups(&notes);
    let idx = by_slug
        .get(slug)
        .copied()
        .ok_or_else(|| anyhow::anyhow!("note not found: {slug}"))?;
    let n = &notes[idx];

    // Outbound refs from this note.
    let mut outbound: Vec<RefLink> = Vec::new();
    let refs = find_wikilinks(&n.body);
    for (refstr, start, end) in refs {
        let target_idx = resolve_ref(&refstr, &by_slug, &by_title);
        let target_slug = target_idx.map(|i| notes[i].slug.clone());
        outbound.push(RefLink {
            target_slug,
            target_title: refstr.clone(),
            resolved: target_idx.is_some(),
            context: context_around(&n.body, start, end, 40),
        });
    }

    // Backlinks: every other note that resolves a wikilink to `slug`.
    let mut backlinks: Vec<BacklinkRef> = Vec::new();
    for (i, m) in notes.iter().enumerate() {
        if i == idx {
            continue;
        }
        for (refstr, start, end) in find_wikilinks(&m.body) {
            if let Some(target_idx) = resolve_ref(&refstr, &by_slug, &by_title) {
                if target_idx == idx {
                    backlinks.push(BacklinkRef {
                        source_slug: m.slug.clone(),
                        source_title: m.title.clone(),
                        context: context_around(&m.body, start, end, 40),
                    });
                    break; // one backlink per source note
                }
            }
        }
    }

    Ok(Note {
        slug: n.slug.clone(),
        title: n.title.clone(),
        body: n.body.clone(),
        created: n.created,
        updated: n.updated,
        tags: n.tags.clone(),
        backlinks,
        outbound,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteArgs {
    pub project_path: String,
    pub slug: Option<String>,
    pub title: String,
    pub body: String,
    pub tags: Option<Vec<String>>,
}

#[tauri::command]
pub fn knowledge_write(args: WriteArgs) -> Result<Note, String> {
    write_impl(&args).map_err(|e| format!("{e:#}"))
}

fn write_impl(args: &WriteArgs) -> anyhow::Result<Note> {
    init_impl(&args.project_path)?;
    let dir = knowledge_dir(&args.project_path);
    let slug = match &args.slug {
        Some(s) if !s.is_empty() => slugify(s),
        _ => slugify(&args.title),
    };
    let path = dir.join(format!("{slug}.md"));
    let tags = args.tags.clone().unwrap_or_default();

    let now = now_millis();
    let (created, _existing_updated) = if path.exists() {
        let existing = std::fs::read_to_string(&path).unwrap_or_default();
        let (fm, _) = parse_file(&existing);
        (fm.created.unwrap_or(now), fm.updated.unwrap_or(now))
    } else {
        (now, now)
    };
    let updated = now;

    let content = serialize_note(&args.title, created, updated, &tags, &args.body);
    let tmp = dir.join(format!("{slug}.md.tmp"));
    std::fs::write(&tmp, &content).with_context(|| format!("write tmp {}", tmp.display()))?;
    std::fs::rename(&tmp, &path)
        .with_context(|| format!("rename {} -> {}", tmp.display(), path.display()))?;

    read_impl(&args.project_path, &slug)
}

#[tauri::command]
pub fn knowledge_delete(args: ReadArgs) -> Result<(), String> {
    let dir = knowledge_dir(&args.project_path);
    let path = dir.join(format!("{}.md", args.slug));
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchArgs {
    pub project_path: String,
    pub query: String,
    pub limit: Option<usize>,
}

#[tauri::command]
pub fn knowledge_search(args: SearchArgs) -> Result<Vec<NoteSummary>, String> {
    search_impl(&args).map_err(|e| format!("{e:#}"))
}

fn search_impl(args: &SearchArgs) -> anyhow::Result<Vec<NoteSummary>> {
    let q = args.query.trim().to_ascii_lowercase();
    let notes = scan_dir(&args.project_path)?;
    let counts = count_backlinks(&notes);
    let limit = args.limit.unwrap_or(50);

    if q.is_empty() {
        let mut out: Vec<NoteSummary> = notes
            .iter()
            .enumerate()
            .map(|(i, n)| to_summary(n, counts[i]))
            .collect();
        out.sort_by(|a, b| b.updated.cmp(&a.updated));
        out.truncate(limit);
        return Ok(out);
    }

    let mut matches: Vec<(i32, NoteSummary)> = Vec::new();
    for (i, n) in notes.iter().enumerate() {
        let title_lc = n.title.to_ascii_lowercase();
        let body_lc = n.body.to_ascii_lowercase();
        let title_hit = title_lc.contains(&q);
        let body_hit = body_lc.contains(&q);
        let tag_hit = n.tags.iter().any(|t| t.to_ascii_lowercase().contains(&q));
        if !title_hit && !body_hit && !tag_hit {
            continue;
        }
        let score = if title_hit { 3 } else { 0 } + if tag_hit { 2 } else { 0 } + if body_hit { 1 } else { 0 };
        matches.push((score, to_summary(n, counts[i])));
    }
    matches.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.updated.cmp(&a.1.updated)));
    let out: Vec<NoteSummary> = matches.into_iter().take(limit).map(|(_, s)| s).collect();
    Ok(out)
}

#[tauri::command]
pub fn knowledge_graph(args: ProjectArgs) -> Result<KnowledgeGraph, String> {
    graph_impl(&args.project_path).map_err(|e| format!("{e:#}"))
}

fn graph_impl(project_path: &str) -> anyhow::Result<KnowledgeGraph> {
    let notes = scan_dir(project_path)?;
    let counts = count_backlinks(&notes);
    let (by_slug, by_title) = build_lookups(&notes);

    let nodes: Vec<KnowledgeNode> = notes
        .iter()
        .enumerate()
        .map(|(i, n)| KnowledgeNode {
            slug: n.slug.clone(),
            title: n.title.clone(),
            backlink_count: counts[i],
        })
        .collect();

    let mut edges: Vec<KnowledgeEdge> = Vec::new();
    let mut seen_edges = std::collections::HashSet::new();
    for (i, n) in notes.iter().enumerate() {
        for (refstr, _, _) in find_wikilinks(&n.body) {
            if let Some(target_idx) = resolve_ref(&refstr, &by_slug, &by_title) {
                if target_idx == i {
                    continue;
                }
                let key = (i, target_idx);
                if seen_edges.insert(key) {
                    edges.push(KnowledgeEdge {
                        source: notes[i].slug.clone(),
                        target: notes[target_idx].slug.clone(),
                    });
                }
            }
        }
    }

    Ok(KnowledgeGraph { nodes, edges })
}

#[tauri::command]
pub fn knowledge_watch_start(
    app: AppHandle,
    args: ProjectArgs,
    manager: State<'_, KnowledgeManager>,
) -> Result<(), String> {
    if manager.watchers.contains_key(&args.project_path) {
        return Ok(());
    }
    init_impl(&args.project_path).map_err(|e| format!("{e:#}"))?;
    let dir = knowledge_dir(&args.project_path);
    let watcher = start_knowledge_watcher(args.project_path.clone(), dir, app)?;
    manager.watchers.insert(args.project_path, watcher);
    Ok(())
}

#[tauri::command]
pub fn knowledge_watch_stop(
    args: ProjectArgs,
    manager: State<'_, KnowledgeManager>,
) -> Result<(), String> {
    manager.watchers.remove(&args.project_path);
    Ok(())
}

#[tauri::command]
pub fn knowledge_project_hash(project_path: String) -> Result<String, String> {
    Ok(super::project_hash(&project_path))
}

// Avoid "unused" warnings when this file is consumed without all callers wired.
#[allow(dead_code)]
fn _path_assert(_p: &Path) {}
