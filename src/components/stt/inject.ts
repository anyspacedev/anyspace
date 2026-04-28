// Paste transcribed text into whichever pane (or focused input) was active at hotkey-down.

import { ptyWrite } from "../../lib/tauri";
import { broadcastBytes } from "../../lib/paneBroadcast";
import { getEditor } from "./editorRegistry";

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
      return { ok: true, fallback: null, message: `Pasted to ${target.label}` };
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
