import type { Pane } from "../../lib/types";
import { Icon } from "../ui/Icon";

type Props = { pane: Pane; tabId: string };

/**
 * Embedded browser pane — **deferred in v1**.
 *
 * The intended implementation was a Tauri child WebView positioned over
 * the pane host. Two architectural blockers prevent shipping it today:
 *
 * - `Window::add_child` on Linux uses wry's `build_gtk(GtkBox)` path —
 *   wry's `set_bounds()` is a no-op for that container, so the child
 *   WebView gets stacked in a vertical box with the main WebView instead
 *   of positioned over the pane.
 * - The `WebviewWindow` (separate top-level) fallback couldn't reliably
 *   honor `set_position` / `set_size` on WebKitGTK / xfce4 — the window
 *   appears at the WM-default geometry and the runtime reports back
 *   `outer_position()` / `inner_size()` as `Err` even after `show()`
 *   returns `Ok`.
 *
 * The Rust commands (`browser_create / navigate / resize / show / hide /
 * destroy`) and TS wrappers are kept wired so a future macOS / Windows
 * pass can ship the feature without re-doing the IPC plumbing. On those
 * platforms `Window::add_child` works correctly; the React side will
 * need to do the bounds-sync there.
 *
 * Until then, the pane renders this placeholder. The kind is excluded
 * from `QUICK_PICKS` so new panes can't pick "Browser" — but existing
 * persisted browser panes (from earlier dev sessions) still render
 * gracefully through this component.
 */
export function BrowserPane(_props: Props) {
  return (
    <div className="browser-pane-placeholder">
      <div className="browser-pane-placeholder-card">
        <Icon name="globe" size={24} />
        <div className="browser-pane-placeholder-title">Browser pane is coming</div>
        <div className="browser-pane-placeholder-body">
          The embedded browser is not yet supported on Linux. On macOS and
          Windows Tauri's child-WebView API positions correctly; the Linux
          (WebKitGTK) build needs more runtime support. Use the Preview
          pane for localhost dev servers in the meantime.
        </div>
      </div>
    </div>
  );
}
