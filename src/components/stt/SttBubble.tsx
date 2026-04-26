import { useSttStore } from "../../stores/sttStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { Icon } from "../ui/Icon";
import { Waveform } from "./Waveform";
import { useSttHotkey } from "./useSttHotkey";

export function SttBubble() {
  useSttHotkey();
  const phase = useSttStore((s) => s.phase);
  const message = useSttStore((s) => s.message);
  const analyser = useSttStore((s) => s.analyser);
  const dismiss = useSttStore((s) => s.dismiss);
  const setView = useWorkspaceStore((s) => s.setView);

  if (phase === "idle") return null;

  return (
    <div
      className={"stt-bubble stt-bubble--" + phase}
      role="status"
      aria-live="polite"
    >
      {phase === "listening" && (
        <>
          <span className="stt-mic-dot" aria-hidden="true" />
          <Waveform analyser={analyser} />
          <span className="stt-hint">Hold Right Ctrl · release to paste</span>
        </>
      )}

      {phase === "transcribing" && (
        <>
          <span className="stt-spinner" aria-hidden="true" />
          <span className="stt-label">{message || "Transcribing…"}</span>
        </>
      )}

      {phase === "success" && (
        <>
          <span className="stt-check" aria-hidden="true">
            <Icon name="check" size={14} />
          </span>
          <span className="stt-label">{message}</span>
        </>
      )}

      {phase === "error" && (
        <>
          <span className="stt-warn" aria-hidden="true">
            <Icon name="alert-circle" size={14} />
          </span>
          <span className="stt-label stt-label--err">{message}</span>
          {message.includes("API key") && (
            <button
              type="button"
              className="stt-action"
              onClick={() => {
                dismiss();
                setView("settings");
              }}
            >
              Open Settings
            </button>
          )}
          <button
            type="button"
            className="stt-close"
            aria-label="Dismiss"
            onClick={dismiss}
          >
            <Icon name="x" size={12} />
          </button>
        </>
      )}
    </div>
  );
}
