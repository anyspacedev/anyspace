import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import { aiChat } from "../../lib/tauri";
import { useAiStore } from "../../stores/aiStore";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useFocusReturn } from "../../lib/useFocusReturn";
import type { CommandBlock } from "./osc133";

type Phase =
  | { state: "loading" }
  | { state: "ok"; text: string }
  | { state: "err"; message: string; needsConfig?: boolean };

type Props = {
  block: CommandBlock;
  output: string;
  onClose: () => void;
};

export function AiExplainPopover({ block, output, onClose }: Props) {
  const settings = useAiStore((s) => s.settings);
  const [phase, setPhase] = useState<Phase>({ state: "loading" });
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useFocusReturn();

  // Fire one request on mount. Re-trigger requires unmount + remount via
  // a key change on the parent — explainingBlockId in Terminal.tsx.
  const setView = useWorkspaceStore((s) => s.setView);

  useEffect(() => {
    let cancelled = false;
    if (!settings.endpoint || !settings.apiKey || !settings.model) {
      setPhase({
        state: "err",
        message:
          "AI provider isn't configured. Set endpoint, API key, and model first.",
        needsConfig: true,
      });
      return;
    }
    const cmd = block.command ?? "(unknown command)";
    const exit = block.exitCode != null ? `\n\nexit ${block.exitCode}` : "";
    const userMessage = `Explain this command and its output:\n\n$ ${cmd}\n\n${output}${exit}`;
    void aiChat({
      endpoint: settings.endpoint,
      apiKey: settings.apiKey,
      model: settings.model,
      systemPrompt: settings.systemPrompt,
      userMessage,
    })
      .then((text) => {
        if (!cancelled) setPhase({ state: "ok", text });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setPhase({
            state: "err",
            message: e instanceof Error ? e.message : String(e),
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [block.id, block.command, block.exitCode, output, settings]);

  // Esc + click-outside dismiss.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDoc = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [onClose]);

  const cmdPreview = (block.command ?? "").split("\n")[0].slice(0, 60);

  return (
    <div
      className="ai-explain-popover"
      ref={popoverRef}
      role="dialog"
      aria-label={cmdPreview ? `Explain: ${cmdPreview}` : "Explain command"}
    >
      <div className="ai-explain-head">
        <div className="ai-explain-title">
          <Icon name="sparkles" size={12} aria-hidden="true" />
          <span>Explain</span>
          {cmdPreview && <code className="ai-explain-cmd">{cmdPreview}</code>}
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close"
          onClick={onClose}
        >
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="ai-explain-body">
        {phase.state === "loading" && (
          <div className="ai-explain-loading">
            <span className="ai-explain-spinner" aria-hidden="true" />
            <span>Asking {settings.model}…</span>
          </div>
        )}
        {phase.state === "ok" && (
          <div className="ai-explain-text">{phase.text}</div>
        )}
        {phase.state === "err" && (
          <div className="ai-explain-error">
            <div>{phase.message}</div>
            {phase.needsConfig && (
              <button
                type="button"
                className="btn btn-ghost btn-with-icon"
                style={{ marginTop: 6 }}
                onClick={() => {
                  setView("settings");
                  onClose();
                }}
              >
                <Icon name="settings" size={12} />
                <span>Open Settings → AI</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
