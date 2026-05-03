import type { Message } from "../../stores/superAgentStore";
import { ToolCallCard } from "./ToolCallCard";

export function MessageBubble({
  message,
  sessionId,
}: {
  message: Message;
  sessionId: string;
}) {
  if (message.role === "tool") {
    // Tool-role messages render as a stack of cards (one per call) with
    // matched results. Args come from message.toolCalls[i]; results from
    // message.toolResults[j] keyed by callId.
    const calls = message.toolCalls ?? [];
    const results = message.toolResults ?? [];
    return (
      <div className="sa-msg sa-msg-tool">
        {calls.map((call) => {
          const result = results.find((r) => r.callId === call.id);
          return (
            <ToolCallCard
              key={call.id}
              sessionId={sessionId}
              messageId={message.id}
              call={call}
              result={result}
            />
          );
        })}
      </div>
    );
  }

  if (message.role === "user") {
    return (
      <div className="sa-msg sa-msg-user">
        <div className="sa-bubble sa-bubble-user">{message.content}</div>
      </div>
    );
  }

  if (message.role === "system") {
    // Visible-only context note (e.g. an @operator escalation handed off
    // from the inbox). The runner skips role:"system" history when calling
    // the model, so this never round-trips as duplicate system prompt.
    return (
      <div className="sa-msg sa-msg-system">
        <div className="sa-bubble sa-bubble-system">{message.content}</div>
      </div>
    );
  }

  // assistant
  return (
    <div className="sa-msg sa-msg-assistant">
      <div className={"sa-bubble sa-bubble-assistant" + (message.streaming ? " streaming" : "")}>
        {message.content || (message.streaming ? "…" : "")}
        {message.streaming && <span className="sa-cursor">▍</span>}
      </div>
    </div>
  );
}
