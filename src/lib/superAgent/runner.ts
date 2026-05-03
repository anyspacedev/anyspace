// ReAct loop runner for Super Agent.
//
// sendUserMessage(sessionId, text) drives the conversation forward:
//   1. Append the user turn.
//   2. Stream the assistant response (tokens append into a live bubble).
//   3. If the model emits tool_calls, dispatch them (immediate trust mode,
//      or queued when pause-tool-calls is on, or short-circuited when the
//      tool is disabled in settings).
//   4. Persist tool results and loop back to step 2 with updated history.
//   5. Stop when the assistant returns plain content with no tool_calls,
//      or when maxToolCallsPerTurn is reached.

import {
  aiChatStream,
  type AiMessage,
  type AiStreamHandle,
  type AiToolCall,
} from "../tauri";
import { useAiStore } from "../../stores/aiStore";
import {
  useSuperAgentSettingsStore,
  isToolEnabled,
} from "../../stores/superAgentSettingsStore";
import {
  useSuperAgentStore,
  type Message,
  type ToolCall,
  type ToolResult,
} from "../../stores/superAgentStore";
import { buildToolsPayload, findTool, type ToolName, TOOLS } from "./tools";

type AccToolCall = {
  index: number;
  id?: string;
  name: string;
  argsText: string;
};

function endpointArgs() {
  const ai = useAiStore.getState().settings;
  const sa = useSuperAgentSettingsStore.getState().settings;
  return {
    endpoint: sa.endpoint || ai.endpoint,
    apiKey: sa.apiKey || ai.apiKey,
    model: sa.model || ai.model,
  };
}

function buildHistory(sessionId: string, systemPrompt: string): AiMessage[] {
  const sa = useSuperAgentSettingsStore.getState().settings;
  const messages = useSuperAgentStore.getState().messagesBySession[sessionId] ?? [];
  const window = sa.memoryWindow > 0 ? sa.memoryWindow : 30;
  const tail = messages.slice(-window);
  const out: AiMessage[] = [{ role: "system", content: systemPrompt }];
  for (const m of tail) {
    if (m.role === "user") {
      out.push({ role: "user", content: m.content });
    } else if (m.role === "assistant") {
      const tcs: AiToolCall[] | undefined = m.toolCalls?.map((c) => ({
        id: c.id,
        type: "function" as const,
        function: { name: c.name, arguments: JSON.stringify(c.arguments) },
      }));
      out.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: tcs && tcs.length ? tcs : undefined,
      });
    } else if (m.role === "tool") {
      // Each tool result goes back as its own tool-role message keyed by call id.
      for (const result of m.toolResults ?? []) {
        out.push({
          role: "tool",
          tool_call_id: result.callId,
          content: result.resultText,
        });
      }
    }
    // 'system' messages are skipped — we always inject the current system prompt fresh.
  }
  return out;
}

function enabledToolNames(): Set<ToolName> {
  const settings = useSuperAgentSettingsStore.getState().settings;
  return new Set(TOOLS.filter((t) => isToolEnabled(t.name, settings)).map((t) => t.name));
}

/** Wait for the operator to click Run/Skip on a queued tool call. Resolves
 *  when `useSuperAgentStore.messagesBySession[...]` shows the corresponding
 *  ToolResult transitioning out of "queued". */
async function awaitQueuedDecision(
  sessionId: string,
  messageId: string,
  callId: string,
): Promise<ToolResult> {
  return new Promise((resolve) => {
    const unsub = useSuperAgentStore.subscribe((state) => {
      const list = state.messagesBySession[sessionId] ?? [];
      const msg = list.find((m) => m.id === messageId);
      const result = msg?.toolResults?.find((r) => r.callId === callId);
      if (result && result.status !== "queued") {
        unsub();
        resolve(result);
      }
    });
  });
}

async function runOneToolCall(
  sessionId: string,
  toolMessageId: string,
  call: ToolCall,
): Promise<ToolResult> {
  const sa = useSuperAgentSettingsStore.getState().settings;
  const tool = findTool(call.name);
  const store = useSuperAgentStore.getState();

  // Disabled? short-circuit with a synthetic error, model gets a clean signal.
  if (!tool || !isToolEnabled(call.name, sa)) {
    return {
      callId: call.id,
      status: "disabled",
      resultText: JSON.stringify({ error: `tool ${call.name} is disabled` }),
    };
  }

  // Queue path: write a placeholder ToolResult with status="queued", let the
  // UI surface Run/Skip buttons, and await the operator's decision.
  if (store.pauseToolCalls) {
    return new Promise<ToolResult>((resolve) => {
      const queued: ToolResult = {
        callId: call.id,
        status: "queued",
        resultText: "",
      };
      // Append the queued result onto the tool message so the card renders.
      const list = useSuperAgentStore.getState().messagesBySession[sessionId] ?? [];
      const msg = list.find((m) => m.id === toolMessageId);
      const merged: Message | undefined = msg
        ? { ...msg, toolResults: [...(msg.toolResults ?? []), queued] }
        : undefined;
      if (merged) {
        void useSuperAgentStore.getState().updateMessage(sessionId, toolMessageId, merged);
      }
      void awaitQueuedDecision(sessionId, toolMessageId, call.id).then(async (decision) => {
        if (decision.status === "skipped") {
          resolve({
            callId: call.id,
            status: "skipped",
            resultText: JSON.stringify({ error: "operator skipped this tool call" }),
          });
          return;
        }
        // status flipped to "running" — execute now.
        const started = performance.now();
        try {
          const out = await tool.handler(call.arguments);
          resolve({
            callId: call.id,
            status: "ok",
            resultText: out.resultText,
            durationMs: Math.round(performance.now() - started),
          });
        } catch (e) {
          resolve({
            callId: call.id,
            status: "error",
            resultText: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
            durationMs: Math.round(performance.now() - started),
            errorMessage: e instanceof Error ? e.message : String(e),
          });
        }
      });
    });
  }

  // Trust mode: execute immediately.
  const started = performance.now();
  try {
    const out = await tool.handler(call.arguments);
    return {
      callId: call.id,
      status: "ok",
      resultText: out.resultText,
      durationMs: Math.round(performance.now() - started),
    };
  } catch (e) {
    return {
      callId: call.id,
      status: "error",
      resultText: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      durationMs: Math.round(performance.now() - started),
      errorMessage: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function sendUserMessage(sessionId: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const store = useSuperAgentStore.getState();
  await store.appendMessage({ sessionId, role: "user", content: trimmed });

  const sa = useSuperAgentSettingsStore.getState().settings;
  const session = store.sessions.find((s) => s.id === sessionId);
  const systemPrompt = session?.systemPromptOverride ?? sa.systemPrompt;
  const { endpoint, apiKey, model } = endpointArgs();
  if (!endpoint || !apiKey || !model) {
    await store.appendMessage({
      sessionId,
      role: "assistant",
      content: "AI is not configured. Open Settings → Super Agent (or AI) and set endpoint / API key / model.",
    });
    return;
  }

  const enabled = enabledToolNames();
  let calls = 0;
  // Multi-turn loop — keep going until the assistant returns a plain message
  // or we hit the configured cap (so a runaway model can't burn tokens forever).
  for (let i = 0; i < (sa.maxToolCallsPerTurn || 6) + 1; i++) {
    const messages = buildHistory(sessionId, systemPrompt);
    const tools = enabled.size > 0 ? buildToolsPayload(enabled) : undefined;

    // Open an in-progress assistant bubble; tokens stream into it.
    const liveAssistant = await store.appendMessage({
      sessionId,
      role: "assistant",
      content: "",
    });
    useSuperAgentStore.setState((s) => ({
      messagesBySession: {
        ...s.messagesBySession,
        [sessionId]: (s.messagesBySession[sessionId] ?? []).map((m) =>
          m.id === liveAssistant.id ? { ...m, streaming: true } : m,
        ),
      },
    }));

    const acc = new Map<number, AccToolCall>();
    let assistantText = "";
    let finishReason: string | undefined;
    let handle: AiStreamHandle | null = null;

    // Always go through ai_chat_stream — when sa.streaming is false the Rust
    // side skips SSE and falls into the one-shot path, which still emits a
    // single delta + tool_call_deltas + done, so the aggregation logic below
    // works identically. Avoids regressing to single-turn / no-tools when
    // streaming is toggled off (aiChat takes only systemPrompt + userMessage).
    await new Promise<void>((resolve) => {
      let resolved = false;
      const settle = () => {
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };
      void aiChatStream(
        { endpoint, apiKey, model, messages, tools, streaming: sa.streaming !== false },
        (ev) => {
          if (ev.type === "delta") {
            assistantText += ev.content;
            useSuperAgentStore.setState((s) => ({
              messagesBySession: {
                ...s.messagesBySession,
                [sessionId]: (s.messagesBySession[sessionId] ?? []).map((m) =>
                  m.id === liveAssistant.id ? { ...m, content: assistantText } : m,
                ),
              },
            }));
          } else if (ev.type === "tool_call_delta") {
            const cur = acc.get(ev.index) ?? { index: ev.index, name: "", argsText: "" };
            if (ev.id) cur.id = ev.id;
            if (ev.name) cur.name = ev.name;
            if (ev.arguments_partial) cur.argsText += ev.arguments_partial;
            acc.set(ev.index, cur);
          } else if (ev.type === "done") {
            finishReason = ev.finish_reason;
            settle();
          } else if (ev.type === "error") {
            assistantText += `\n\n_[error: ${ev.message}]_`;
            settle();
          }
        },
      ).then((h) => {
        handle = h;
        useSuperAgentStore.getState().setActiveStreamId(h.streamId);
      });
    });
    if (handle) useSuperAgentStore.getState().setActiveStreamId(null);

    const completedCalls: ToolCall[] = [];
    for (const [, c] of acc) {
      if (!c.name || !c.id) continue;
      let parsed: Record<string, unknown> = {};
      try {
        parsed = c.argsText ? JSON.parse(c.argsText) : {};
      } catch {
        parsed = { _raw: c.argsText };
      }
      completedCalls.push({ id: c.id, name: c.name, arguments: parsed });
    }

    // Persist the assistant turn (with any tool_calls embedded).
    await store.updateMessage(sessionId, liveAssistant.id, {
      content: assistantText,
      toolCalls: completedCalls.length ? completedCalls : undefined,
      streaming: false,
    });

    if (completedCalls.length === 0 || finishReason === "stop") {
      return;
    }

    // Open a tool-role message that will hold the results for this fan-out.
    const toolMsg = await store.appendMessage({
      sessionId,
      role: "tool",
      content: "",
      toolCalls: completedCalls,
      toolResults: [],
    });

    // Execute / queue / disable each call and persist results as they finalize.
    const results: ToolResult[] = [];
    for (const call of completedCalls) {
      calls++;
      if (calls > (sa.maxToolCallsPerTurn || 6)) {
        results.push({
          callId: call.id,
          status: "error",
          resultText: JSON.stringify({ error: "maxToolCallsPerTurn reached" }),
          errorMessage: "maxToolCallsPerTurn reached",
        });
        continue;
      }
      // Optimistic write so UI renders running state immediately.
      const placeholder: ToolResult = { callId: call.id, status: "running", resultText: "" };
      const cur = useSuperAgentStore.getState().messagesBySession[sessionId] ?? [];
      const msg = cur.find((m) => m.id === toolMsg.id);
      await useSuperAgentStore.getState().updateMessage(sessionId, toolMsg.id, {
        toolResults: [...(msg?.toolResults ?? []), placeholder],
      });

      const result = await runOneToolCall(sessionId, toolMsg.id, call);
      results.push(result);

      // Replace placeholder with final result.
      const cur2 = useSuperAgentStore.getState().messagesBySession[sessionId] ?? [];
      const msg2 = cur2.find((m) => m.id === toolMsg.id);
      const merged = (msg2?.toolResults ?? []).map((r) =>
        r.callId === call.id ? result : r,
      );
      await useSuperAgentStore.getState().updateMessage(sessionId, toolMsg.id, {
        toolResults: merged,
      });
    }
    void results; // keep eslint happy; persisted via updateMessage above

    // Loop back — model sees the tool results in the next history snapshot.
  }
}

/** Operator-driven decision for a queued tool call. The runner's promise
 *  observer (awaitQueuedDecision) picks up the status flip. */
export async function decideQueuedToolCall(
  sessionId: string,
  messageId: string,
  callId: string,
  decision: "run" | "skip",
): Promise<void> {
  const list = useSuperAgentStore.getState().messagesBySession[sessionId] ?? [];
  const msg = list.find((m) => m.id === messageId);
  if (!msg) return;
  const merged = (msg.toolResults ?? []).map((r) =>
    r.callId === callId
      ? { ...r, status: (decision === "run" ? "running" : "skipped") as ToolResult["status"] }
      : r,
  );
  await useSuperAgentStore.getState().updateMessage(sessionId, messageId, {
    toolResults: merged,
  });
}

/** Stop the active stream and resolve any queued tool calls as skipped so
 *  awaitQueuedDecision-parked promises unwind cleanly and the ReAct loop
 *  exits without leaking. */
export async function abortActive(): Promise<void> {
  const state = useSuperAgentStore.getState();
  if (state.activeStreamId) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("abort_ai_chat_stream", { streamId: state.activeStreamId });
    } catch {
      /* best-effort */
    }
    state.setActiveStreamId(null);
  }
  // Walk every active session and flip any 'queued' results to 'skipped'.
  // The runner observer (awaitQueuedDecision) sees the status change and
  // resolves with a synthetic skip result.
  for (const [sid, list] of Object.entries(state.messagesBySession)) {
    for (const msg of list) {
      if (!msg.toolResults || msg.toolResults.length === 0) continue;
      const hasQueued = msg.toolResults.some((r) => r.status === "queued");
      if (!hasQueued) continue;
      const merged = msg.toolResults.map((r) =>
        r.status === "queued" ? { ...r, status: "skipped" as const } : r,
      );
      await useSuperAgentStore
        .getState()
        .updateMessage(sid, msg.id, { toolResults: merged });
    }
  }
  // Clear pause-tool-calls so subsequent prompts aren't accidentally queued
  // (the next session should start in normal trust mode).
  if (state.pauseToolCalls) state.setPauseToolCalls(false);
}
