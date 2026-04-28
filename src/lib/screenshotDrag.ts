// In-app drag bridge between the screenshot stack and terminal panes.
//
// HTML5 dataTransfer is the primary channel — `dataTransfer.setData("text/plain", path)`
// on dragstart, read on drop. But CLAUDE.md flags that WKWebView and Tauri's
// WebView occasionally swallow native drag events on iframe-bearing pages
// (`pane header drag-to-swap`). The screenshot drag *source* is outside any
// iframe, but the *target* (terminal pane) lives next to one. If HTML5 drop
// is ever flaky, the receiver can read this module-level ref instead.

let dragging: string | null = null;

export function setDraggingPath(path: string | null): void {
  dragging = path;
}

export function getDraggingPath(): string | null {
  return dragging;
}
