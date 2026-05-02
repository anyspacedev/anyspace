import { useState } from "react";
import { Icon } from "../ui/Icon";
import type { ToolCall, ToolResult } from "../../stores/superAgentStore";
import { decideQueuedToolCall } from "../../lib/superAgent/runner";

const STATUS_LABEL: Record<NonNullable<ToolResult>["status"], string> = {
  queued: "queued",
  running: "running",
  ok: "ok",
  error: "error",
  disabled: "disabled",
  skipped: "skipped",
};

export function ToolCallCard({
  sessionId,
  messageId,
  call,
  result,
}: {
  sessionId: string;
  messageId: string;
  call: ToolCall;
  result?: ToolResult;
}) {
  const [argsOpen, setArgsOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);

  const status = result?.status ?? "running";
  const argsJson = JSON.stringify(call.arguments, null, 2);
  const argsPreview = argsJson.length > 80 ? argsJson.slice(0, 80) + "…" : argsJson;
  const resultPreview = result?.resultText
    ? result.resultText.length > 200
      ? result.resultText.slice(0, 200) + "…"
      : result.resultText
    : "";

  return (
    <div className={`sa-toolcard sa-toolcard-${status}`}>
      <div className="sa-toolcard-head">
        <Icon name="play" size={11} />
        <span className="sa-toolcard-name">{call.name}</span>
        <span className={`sa-toolcard-status sa-toolcard-status-${status}`}>
          {STATUS_LABEL[status]}
        </span>
        {result?.durationMs != null && (
          <span className="sa-toolcard-duration">{result.durationMs} ms</span>
        )}
      </div>
      <button
        type="button"
        className="sa-toolcard-args-toggle"
        onClick={() => setArgsOpen((v) => !v)}
        aria-expanded={argsOpen}
      >
        <span>args</span>
        <code>{argsOpen ? argsJson : argsPreview}</code>
      </button>
      {result?.resultText && (
        <button
          type="button"
          className="sa-toolcard-result-toggle"
          onClick={() => setResultOpen((v) => !v)}
          aria-expanded={resultOpen}
        >
          <span>result</span>
          <code>{resultOpen ? result.resultText : resultPreview}</code>
        </button>
      )}
      {status === "queued" && (
        <div className="sa-toolcard-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => decideQueuedToolCall(sessionId, messageId, call.id, "run")}
          >
            Run
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => decideQueuedToolCall(sessionId, messageId, call.id, "skip")}
          >
            Skip
          </button>
        </div>
      )}
    </div>
  );
}
