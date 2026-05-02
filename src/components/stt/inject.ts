// Paste transcribed text into whichever pane (or focused input) was active at hotkey-down.

import { ptyWrite } from "../../lib/tauri";
import { broadcastBytes } from "../../lib/paneBroadcast";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useTeamStore } from "../../stores/teamStore";
import { useSuperAgentStore } from "../../stores/superAgentStore";
import { getTerminalContext } from "../terminal/terminalRegistry";
import { getEditor } from "./editorRegistry";
import { getSuperAgentInput } from "../superAgent/inputRegistry";

export type InjectTarget =
  | { kind: "terminal"; sessionId: string; paneId: string; label: string }
  | { kind: "editor"; paneId: string; label: string }
  | { kind: "dom-input"; element: HTMLInputElement | HTMLTextAreaElement; label: string }
  | { kind: "dom-contenteditable"; element: HTMLElement; label: string }
  | { kind: "none"; label: string };

export type InjectResult = {
  ok: boolean;
  fallback: "clipboard" | null;
  message: string;
};

export async function inject(text: string, target: InjectTarget): Promise<InjectResult> {
  if (!text) {
    console.warn("[stt:inject] empty transcription — nothing to paste");
    return { ok: false, fallback: null, message: "No speech detected" };
  }

  console.debug(
    "[stt:inject] dispatch target=%s chars=%d label=%s",
    target.kind,
    text.length,
    target.label,
  );

  if (target.kind === "terminal") {
    try {
      // Deliberately omit \n so we never auto-execute the command.
      const bytes = new TextEncoder().encode(text);
      await ptyWrite(target.sessionId, bytes);
      // Mirror to other selected panes so multi-pane broadcast applies to STT
      // dictation, matching the keyboard onData fan-out in Terminal.tsx.
      broadcastBytes(target.paneId, bytes);
      // Voice-to-team: if the source pane belongs to a team tab and no
      // explicit multi-pane selection is set, fan to every other team pane
      // so the operator can drive the whole team by voice. With selection
      // active, broadcastBytes already covered the fan-out — we skip to
      // avoid double-writes.
      const fanned = await fanToTeamPanes(target.paneId, target.sessionId, bytes);
      const suffix = fanned > 0 ? ` (+${fanned} team panes)` : "";
      return { ok: true, fallback: null, message: `Pasted to ${target.label}${suffix}` };
    } catch (e) {
      console.error("[stt:inject] terminal write failed session=%s:", target.sessionId, e);
      return clipboardFallback(text, `terminal write failed: ${stringifyErr(e)}`);
    }
  }

  if (target.kind === "editor") {
    const ed = getEditor(target.paneId);
    if (!ed) {
      console.warn("[stt:inject] editor not found pane=%s", target.paneId);
      return clipboardFallback(text, "editor not found");
    }
    const sel = ed.getSelection();
    if (!sel) {
      console.warn("[stt:inject] editor selection unknown pane=%s", target.paneId);
      return clipboardFallback(text, "editor selection unknown");
    }
    ed.executeEdits("stt", [{ range: sel, text, forceMoveMarkers: true }]);
    return { ok: true, fallback: null, message: `Pasted to ${target.label}` };
  }

  if (target.kind === "dom-input") {
    const el = target.element;
    if (!document.contains(el)) {
      return clipboardFallback(text, "input no longer attached");
    }
    try {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      el.setRangeText(text, start, end, "end");
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, fallback: null, message: `Pasted to ${target.label}` };
    } catch (e) {
      console.error("[stt:inject] input write failed:", e);
      return clipboardFallback(text, `input write failed: ${stringifyErr(e)}`);
    }
  }

  if (target.kind === "dom-contenteditable") {
    const el = target.element;
    if (!document.contains(el)) {
      return clipboardFallback(text, "editable no longer attached");
    }
    try {
      // Refocus so execCommand / Selection acts on this element.
      if (document.activeElement !== el) el.focus();
      let inserted = false;
      try {
        inserted = document.execCommand("insertText", false, text);
      } catch {
        inserted = false;
      }
      if (!inserted) {
        const sel = window.getSelection();
        if (!sel || sel.rangeCount === 0) {
          return clipboardFallback(text, "no selection in editable");
        }
        const range = sel.getRangeAt(0);
        range.deleteContents();
        const node = document.createTextNode(text);
        range.insertNode(node);
        range.setStartAfter(node);
        range.setEndAfter(node);
        sel.removeAllRanges();
        sel.addRange(range);
        el.dispatchEvent(
          new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }),
        );
      }
      return { ok: true, fallback: null, message: `Pasted to ${target.label}` };
    } catch (e) {
      console.error("[stt:inject] contenteditable write failed:", e);
      return clipboardFallback(text, `editable write failed: ${stringifyErr(e)}`);
    }
  }

  // Last-resort: if the Super Agent panel is open or its full-page view is
  // active, route into its textarea. The textarea ref is registered when the
  // panel mounts and unregisters on unmount; we focus it before writing so
  // the existing dom-input pipeline takes the result naturally on next runs.
  const ws = useWorkspaceStore.getState();
  const sa = useSuperAgentStore.getState();
  const superAgentReachable =
    sa.panelOpen || ws.selectedView === "superagent";
  if (superAgentReachable) {
    const el = getSuperAgentInput();
    if (el) {
      el.focus();
      try {
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        el.setRangeText(text, start, end, "end");
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, fallback: null, message: "Pasted to Super Agent" };
      } catch (e) {
        return clipboardFallback(text, `super agent write failed: ${stringifyErr(e)}`);
      }
    }
  }

  return clipboardFallback(text, "no text target focused");
}

async function clipboardFallback(text: string, why: string): Promise<InjectResult> {
  try {
    await navigator.clipboard.writeText(text);
    console.log("[stt:inject] clipboard fallback — %s", why);
    return { ok: true, fallback: "clipboard", message: `Copied — ${why}` };
  } catch (e) {
    console.error("[stt:inject] clipboard write failed (%s):", why, e);
    return { ok: false, fallback: null, message: `Failed: ${why}` };
  }
}

function stringifyErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

/** When the source pane is in a team tab, write the same bytes (no newline)
 * into every other terminal pane in that team tab. Returns the count fanned.
 * Skips when the user already has explicit multi-pane selection — that path
 * is handled by `broadcastBytes` to avoid double-writes. */
async function fanToTeamPanes(
  originPaneId: string,
  originSessionId: string,
  bytes: Uint8Array,
): Promise<number> {
  const ws = useWorkspaceStore.getState();
  const tab = ws.tabs.find((t) =>
    Object.prototype.hasOwnProperty.call(t.panes, originPaneId),
  );
  if (!tab) return 0;
  if ((tab.selectedPaneIds ?? []).length >= 2) return 0; // covered by broadcastBytes
  const team = useTeamStore.getState().teams.find((t) => t.tabId === tab.id);
  if (!team) return 0;

  let count = 0;
  for (const pane of Object.values(tab.panes)) {
    if (pane.id === originPaneId) continue;
    if (pane.kind !== "terminal") continue;
    const ctx = getTerminalContext(pane.id);
    if (!ctx || ctx.sessionId === originSessionId) continue;
    try {
      await ptyWrite(ctx.sessionId, bytes);
      count++;
    } catch (e) {
      console.warn("[stt:inject] team-fan failed pane=%s:", pane.id, e);
    }
  }
  return count;
}
