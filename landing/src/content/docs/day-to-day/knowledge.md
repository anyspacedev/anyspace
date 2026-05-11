---
title: Knowledge
description: Project-local markdown notes with [[wikilinks]], backlinks, and a graph view. Lives next to your code.
section: day-to-day
order: 80
updated: 2026-05-11
---

Knowledge is AnySpace's note-taking surface for whatever you can't fit on the Kanban or in chat: design decisions, research, runbooks, mental models, half-baked ideas. Notes are plain markdown files in your project folder. There is no cloud, no account, no sync server — your notes survive on disk and travel with the repo (gitignored by default).

If you've used Obsidian, the model will be familiar: one file per note, `[[wikilinks]]` connect them, and a force-directed graph view shows the structure.

## Where notes live

Every project gets its own knowledge folder at:

```
<projectPath>/.anyspace/knowledge/
├── note-title.md
├── another-note.md
└── README.md            # seed file written on first open
```

AnySpace creates the folder the first time you open the Knowledge view for a project. `.anyspace/` is already in this repo's `.gitignore` template, so notes don't leak into commits unless you explicitly remove the ignore.

Files are pure markdown with YAML-style frontmatter:

```markdown
---
title: Ship plan
created: 1715472896000
updated: 1715472896000
tags: [release, q2]
---

We're cutting v3.1 next Friday. See [[Release checklist]] for the gating items.
```

Open any note in Obsidian, VS Code, or any editor that handles markdown — AnySpace doesn't lock the format.

## Opening the Knowledge view

Click **Knowledge** in the sidebar (between Tasks and Agents). The first time, you'll see an empty state with a **Pick project folder** button:

- If your active workspace tab already has a project folder set, an extra button offers to reuse that path.
- Once picked, the project sticks across restarts — AnySpace remembers your last knowledge project under the `knowledge` settings key.
- Change projects later via the **folder pill** in the top-left of the Knowledge view.

## Layout

The view is three columns:

| Column | Width | Contents |
|---|---|---|
| Note list | 280px | Search input, "+ New note", sorted by updated time. |
| Center | flexible | Editor or Graph, toggled by the segmented control in the top bar. |
| Backlinks rail | 240px | Inbound and outbound references for the active note. Collapsible. |

## Writing notes

The editor is Monaco in markdown mode — the same engine the [Editor pane](/docs/day-to-day/editor) uses. Speech-to-text dictation lands in the editor when it has focus.

Above the editor, a borderless **title** field and a **tags** row blend into the content. Tags commit on <kbd>Enter</kbd> or comma. Backspace in an empty tag field deletes the previous tag.

### Auto-save

AnySpace debounces saves 800ms after the last keystroke, and also flushes on blur. The status footer shows the current state:

- **Saving…** — write in flight
- **Saved** — last successful round-trip
- **Unsaved** — local changes pending
- **Save failed** — with an inline Retry button and an error message

No save button needed.

## Wikilinks

Type `[[` anywhere in a note body to open a completion popup listing existing notes. Pick one with <kbd>Enter</kbd>. The link renders as an underlined accent-colored span.

Wikilinks resolve in this order:

1. Exact slug match (filename without `.md`)
2. Case-insensitive title match
3. Slugified title match

This means `[[Ship plan]]`, `[[ship plan]]`, and `[[ship-plan]]` all resolve to the same note as long as one of those is the filename or title.

**Unresolved links** render with a warning-color wavy underline. Click the link or use the **Create** pill in the Backlinks rail to materialize the note instantly — the editor jumps to the new note with the inferred title pre-filled.

**Clicking** a wikilink inside the editor opens the target note. The editor catches the mouse event before Monaco's default text-selection kicks in.

## Backlinks rail

Right side of the view, two sections:

- **Backlinks** — every other note that contains `[[Active note]]`. Each row shows the source title and a short context snippet around the reference.
- **Outbound** — every `[[ref]]` in the active note. Resolved refs are clickable; unresolved ones get the inline **Create** pill.

Toggle the rail with <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>B</kbd> or the chevron at the top. The collapsed/expanded state persists.

Backlinks are **recomputed on every read** — there's no index file to drift out of sync. For projects under a few thousand notes the scan is unmeasurable; beyond that we'll add an FTS5 cache (see Roadmap).

## Graph view

Switch the segmented control from **Editor** to **Graph** (or press <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>\\</kbd>).

| Visual | Meaning |
|---|---|
| Node size | sqrt of backlink count, clamped 4–14px. Hubs render larger. |
| Node color | muted by default; accent for hovered, selected, and the active note. |
| Edge | directed (source → target) with a small arrowhead. |

| Gesture | Effect |
|---|---|
| Click node | Open in editor (auto-switches back to Editor view). |
| Drag node | Pin it. The simulation flows around. |
| Double-click node | Unpin. |
| Scroll wheel | Zoom centered on the cursor (0.3×–4×). |
| Drag empty space | Pan. |

The simulation pre-settles 60 steps on mount and refines in the background until kinetic energy drops below a threshold. If your OS has `prefers-reduced-motion: reduce`, AnySpace runs 240 settling steps upfront and skips the live animation entirely — nodes appear snapped to their final positions.

## Keyboard

| Shortcut | Action | Scope |
|---|---|---|
| <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>N</kbd> | New note | Knowledge view |
| <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>K</kbd> | Focus list search | Knowledge view |
| <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>B</kbd> | Toggle Backlinks rail | Knowledge view |
| <kbd>Cmd</kbd>/<kbd>Ctrl</kbd> + <kbd>\\</kbd> | Toggle Editor ↔ Graph | Knowledge view |
| <kbd>↑</kbd> / <kbd>↓</kbd> | Move list selection | List focused |
| <kbd>Enter</kbd> | Open selected note | List focused |
| <kbd>[[</kbd> | Wikilink completion | Editor focused |
| <kbd>Esc</kbd> | Clear search / dismiss completion | Context-dependent |

## Super Agent tools

Six tools expose the knowledge layer to [Super Agent](/docs/ai/super-agent), so a chat turn can read or write notes alongside its other actions. Each tool resolves the project path from your active Knowledge project (with the active workspace tab's project as fallback). All six can be individually disabled in **Settings → Super Agent → Tools**.

| Tool | What it does |
|---|---|
| `save_note` | Create or update a note. `title` + `body` required; `slug` and `tags` optional. |
| `get_note` | Read a note by slug. Returns body, frontmatter, backlinks, and outbound refs. |
| `list_notes` | Newest-first summary list. |
| `search_notes` | Case-insensitive substring search across title, body, and tags. Ranks title matches above tag, tag above body. |
| `find_backlinks` | List of notes linking to a slug, each with a context snippet. |
| `link_notes` | Append a `[[to_slug]]` reference to `from_slug` if it isn't already present. Idempotent. |

Example chat turn:

> **You:** Summarize what we decided about the refactor and save it as a note linked to "Ship plan".
>
> **Super Agent:** *(calls `save_note` with title="Refactor decision", body containing `[[Ship plan]]`)*
>
> *Tool result card shows*: `{ slug: "refactor-decision", path: ".../refactor-decision.md", outbound: 1 }`

Write tools execute immediately in trust mode — review the inline ToolCallCard for the args and result. Toggle the global **pause tool calls** switch on the Super Agent panel header if you want manual approval per call.

## Portability

Notes are pure markdown — open the folder in any editor or note tool:

- **Obsidian** — wikilink syntax is identical. Open `<projectPath>/.anyspace/knowledge/` as a vault and your AnySpace notes work as-is.
- **VS Code** — drag the folder into the file explorer. Markdown rendering is built-in.
- **Plain `grep` / `ripgrep`** — same files, same content, same regex.

If you change a file outside AnySpace, the in-app watcher picks it up within ~150ms and refreshes the list + graph automatically.

## Gotchas

- **Slugs follow the title.** Renaming a note's title changes its filename (slug). Existing wikilinks resolve by title or slugified-title, so links keep working, but if you rename and *also* want the old slug to still work, leave a redirect note.
- **No soft-delete.** `knowledge_delete` removes the file outright. Use git or your filesystem trash if you might want it back.
- **Frontmatter is hand-parsed.** AnySpace recognizes `title`, `created`, `updated`, and `tags` (as `[a, b, c]`). Other YAML keys are preserved on read but ignored — write only the recognized keys.
- **Graph re-layout on structural change.** Adding or removing a wikilink can shuffle node positions. Drag any node you want pinned to lock it in place.
- **One project at a time.** The Knowledge view scopes to one project folder. To work across projects, change folders via the pill — there is no global knowledge base in v1.

## Privacy & ownership

Nothing leaves your machine. No telemetry, no sync, no account requirement. The watcher emits in-process events; the data is markdown on your disk. If you point AnySpace's AI features at a third-party model (OpenAI, Anthropic, etc.) and ask Super Agent to read notes, the note contents will be sent in that turn's prompt — that's the only path off-disk, and it requires you to actively invoke a tool.

## Related

- [Super Agent](/docs/ai/super-agent)
- [Editor](/docs/day-to-day/editor)
- [Pane kinds](/docs/workspace/pane-kinds)
- [Speech-to-text](/docs/ai/speech-to-text)
