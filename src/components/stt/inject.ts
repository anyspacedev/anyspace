// Paste transcribed text into whichever pane was focused at hotkey-down.

import { ptyWrite } from "../../lib/tauri";
import { getEditor } from "./editorRegistry";

export type InjectTarget =
  | { kind: "terminal"; sessionId: string; label: string }
  | { kind: "editor"; paneId: string; label: string }
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
      await ptyWrite(target.sessionId, new TextEncoder().encode(text));
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
