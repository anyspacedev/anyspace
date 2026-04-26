# UI Review — Fix List

Source: `/ui-ux-pro-max review` pass on 2026-04-26.

## Phase 1 — Touched files (modified PR surface)

### Critical — a11y & interaction
- [x] 1. Replace `alert()` with toast in `Board.tsx`
- [x] 2. Escape-to-close on `LaunchAgentDialog` and `TaskEditor`
- [x] 3. `role="dialog"` + `aria-labelledby` on both dialogs
- [x] 4. Confirm-on-dismiss when description dirty
- [x] 5. `aria-label` on URL inputs
- [x] 6. `role="status" aria-live="polite"` on `.modal-toast`
- [x] 7. Form labels associated with `htmlFor`

### High — style & forms
- [x] 8. Theme-able select chevron (`[data-theme-kind="light"]` override)
- [x] 9. `--danger-fg` token replaces `btn-danger { color: white }`
- [x] 10. Require non-empty description in `LaunchAgentDialog`
- [x] 11. Spinner inside primary CTA on busy
- [x] 12. Modal width: `min(width, calc(100vw - 32px))`

### Medium / Low
- [x] 13. `--fg-dim` `#5b6478` → `#6b748a` (default token)
- [x] 14. Submit button on `.preview-empty` URL input
- [x] 15. `.captured-html` font-size 11.5px → 12px
- [x] 16. Picker iframe ring → sibling `::after` (no clipping)

## Phase 2 — Sweep across the rest of the app
- [x] 17. `QuickOpen`: role/aria-modal/aria-label, window-scoped Escape
- [x] 18. `TemplatePicker`: role/aria-modal/aria-labelledby, Escape close, `htmlFor`
- [x] 19. `Editor.UnsavedConfirm`: `aria-labelledby`
- [x] 20. `aria-label` on `FileBrowser` filter, `TabBar` rename, `Terminal` search, `Settings` theme filter
- [x] 21. `AgentManager`: `htmlFor` on Name / Command / System prompt

## Phase 6 — Focus management on modal close
- [x] 30. New `src/lib/useFocusReturn.ts` hook: snapshots `document.activeElement` on activate, restores on cleanup. Guards against the previous element being unmounted.
- [x] 31. Adopted in `LaunchAgentDialog`, `TaskEditor`, `UnsavedConfirm`, `TemplatePicker` (gated by `open`), `QuickOpen` (gated by `open`), and `AiExplainPopover`. Closing any of these now returns focus to the trigger button instead of dropping to `<body>`.

## Phase 5 — ErrorState pattern
- [x] 26. New `src/components/ui/ErrorState.tsx` (title, optional message, optional retry; compact + full variants). New `.error-state` CSS with danger-tinted icon container.
- [x] 27. `FileBrowser`: removed inline `fb-row.danger` row; failures now render compact `ErrorState` with retry that re-fetches.
- [x] 28. `QuickOpen`: previously swallowed `fsListDirRecursive` failures via `console.warn`; now surfaced via `ErrorState` with retry.
- [x] 29. `Editor`: save failures (Cmd-S keyhandler + `saveAndClose`) now show a transient `editor-toast` with a4-second auto-dismiss, `role="status" aria-live="polite"`, and a danger-tinted style. Previously logged to console only.

## Phase 4 — Empty / loading state consistency
- [x] 24. Standardize small empty states: `kanban-empty` and `fb-empty` adopt the icon + dashed-border pattern; QuickOpen "no matches" gets an icon to match its sibling no-root state.
- [x] 25. FileBrowser loading row swapped from plain "Loading…" text to spinner + text + `role="status" aria-live="polite"` (matches `ai-explain-loading` / `preview-overlay`).

## Phase 3 — Theme audit (25 themes × 8 token pairs)
- [x] 22. Wire `dangerFg` end-to-end through `UiTokens` / `apply.ts` / all themes
- [x] 23. WCAG cross-theme contrast audit (`scripts/audit-contrast.mjs`):
  - Found **80 AA failures** across 25 themes (62 with relaxed `fgDim` 3:1).
  - Auto-patched `accentFg` / `dangerFg` to whichever of `#000`, `#fff`, `theme.bg`, or `theme.fg` cleared 4.5:1.
  - Cohesive pass: swapped harsh `#000000` for the theme's own `bg` color where it also passes (22 swaps — preserves dracula-style identity).
  - Bumped `fgDim` / `fgMuted` per theme via HSL adjust until ≥ floor (`fgDim` 3:1, `fgMuted` 4.5:1).
  - **Result: 0 failures across all 25 themes.**

## Skipped (intentional)
- Hover-lift cards, disabled-ghost dashed border, `framework-tag` 11px uppercase.
- Wrapped `<label>` patterns in `Settings.tsx` (already valid).
- ANSI palette colors (terminal-only; `--fg-dim` audit covers UI chrome).

## Verification
- `npx tsc --noEmit` — clean (all phases).
- `npx vite build` — built in 24.5s.
- `node scripts/audit-contrast.mjs` — 0 AA failures across 25 themes.
- Browser smoke test: not possible — app requires Tauri runtime.

## Tooling left in repo
- `scripts/audit-contrast.mjs` — recurring audit (`--apply` to patch).
- `scripts/audit-contrast-cohesive.mjs` — one-shot post-pass for visual cohesion.
