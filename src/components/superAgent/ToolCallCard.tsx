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
  const [open, setOpen] = useState(false);

  const status = result?.status ?? "running";
  const argsJson = JSON.stringify(call.arguments, null, 2);

  return (
    <div className={`sa-toolcard sa-toolcard-${status}`}>
      <button
        type="button"
        className="sa-toolcard-head"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <Icon name={open ? "chevron-down" : "chevron-right"} size={11} />
        <span className="sa-toolcard-name">{call.name}</span>
        <span className={`sa-toolcard-status sa-toolcard-status-${status}`}>
          {STATUS_LABEL[status]}
        </span>
        {result?.durationMs != null && (
          <span className="sa-toolcard-duration">{result.durationMs} ms</span>
        )}
      </button>
      {open && (
        <>
          <div className="sa-toolcard-row">
            <span>args</span>
            <code>{argsJson}</code>
          </div>
          {result?.resultText && (
            <div className="sa-toolcard-row">
              <span>result</span>
              <code>{result.resultText}</code>
            </div>
          )}
        </>
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
