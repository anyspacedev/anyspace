import { useCallback, useMemo, useState } from "react";
import { Icon } from "../ui/Icon";
import { toast } from "../../stores/toastStore";
import { usePromptsStore } from "../../stores/promptsStore";
import {
  useSuperAgentSettingsStore,
  SUPER_AGENT_DEFAULT_SYSTEM_PROMPT,
} from "../../stores/superAgentSettingsStore";
import { useAiStore, AI_DEFAULT_SYSTEM_PROMPT } from "../../stores/aiStore";
import {
  DEFAULT_PROMPTS,
  PROMPT_GROUPS,
  PROMPT_METADATA,
  customizedCount,
  isPromptOverridden,
  type PromptGroup,
  type PromptId,
} from "../../lib/prompts";

export function PromptsSection() {
  return (
    <div className="settings-section">
      <div className="settings-section-head">
        <h2 className="settings-section-title">Prompts</h2>
        <div className="settings-section-sub">
          Customize the system prompts the app sends to AI models. Click{" "}
          <em>Reset to default</em> on any prompt to restore its original text.
          The task-file scaffold around <code>Agent launch</code> is fixed —
          only the appended preview-API hint is customizable.
        </div>
      </div>
      <MainPromptsSubgroup />
      {PROMPT_GROUPS.map((g) => (
        <PromptSubgroup key={g.id} group={g} />
      ))}
    </div>
  );
}

/**
 * The two pre-existing "main" system prompts live in their own stores
 * (`superAgent.systemPrompt` and `ai.systemPrompt`) and have inline editors
 * in their feature sections. Mirror them here so users don't have to hunt
 * across the page — both editors write to the same store, no second source
 * of truth.
 */
function MainPromptsSubgroup() {
  const saPrompt = useSuperAgentSettingsStore((s) => s.settings.systemPrompt);
  const aiPrompt = useAiStore((s) => s.settings.systemPrompt);
  const saCustom = saPrompt !== SUPER_AGENT_DEFAULT_SYSTEM_PROMPT;
  const aiCustom = aiPrompt !== AI_DEFAULT_SYSTEM_PROMPT;
  const customCount = (saCustom ? 1 : 0) + (aiCustom ? 1 : 0);
  return (
    <details className="prompt-subgroup">
      <summary>
        <Icon name="chevron-right" size={14} className="prompt-subgroup-caret" />
        <span className="prompt-subgroup-title">Main prompts</span>
        <span
          className={
            "prompt-subgroup-badge" + (customCount > 0 ? " is-customized" : "")
          }
        >
          {customCount > 0 ? `${customCount}/2 customized` : "default"}
        </span>
      </summary>
      <div className="prompt-subgroup-body">
        <p className="prompt-subgroup-desc">
          The two primary system prompts. These also appear in the Super Agent
          and AI sections — edits here and there go to the same place.
        </p>
        <SuperAgentMainRow />
        <AiMainRow />
      </div>
    </details>
  );
}

function SuperAgentMainRow() {
  const value = useSuperAgentSettingsStore((s) => s.settings.systemPrompt);
  const update = useSuperAgentSettingsStore((s) => s.update);
  const overridden = value !== SUPER_AGENT_DEFAULT_SYSTEM_PROMPT;
  const onReset = useCallback(async () => {
    const previous = value;
    await update({ systemPrompt: SUPER_AGENT_DEFAULT_SYSTEM_PROMPT });
    toast.info("Reset Super Agent system prompt", "Restored compiled-in default.", {
      label: "Undo",
      onClick: () => void update({ systemPrompt: previous }),
    });
  }, [update, value]);
  return (
    <div className="prompt-row">
      <div className="prompt-row-header">
        <label className="prompt-row-label" htmlFor="prompt-super-agent-main">
          <span>Super Agent (main loop)</span>
          {overridden && (
            <span
              className="prompt-row-dot"
              aria-label="customized"
              title="Customized — click Reset to restore the default."
            />
          )}
        </label>
        {overridden && (
          <button
            type="button"
            className="prompt-row-reset"
            onClick={() => void onReset()}
          >
            Reset to default
          </button>
        )}
      </div>
      <p className="prompt-row-desc">
        Drives every Super Agent chat. Tool descriptions are appended automatically by pi-agent-core.
      </p>
      <textarea
        id="prompt-super-agent-main"
        rows={8}
        className="prompt-row-input"
        value={value}
        spellCheck={false}
        onChange={(e) => void update({ systemPrompt: e.target.value })}
      />
    </div>
  );
}

function AiMainRow() {
  const value = useAiStore((s) => s.settings.systemPrompt);
  const update = useAiStore((s) => s.updateSettings);
  const overridden = value !== AI_DEFAULT_SYSTEM_PROMPT;
  const onReset = useCallback(async () => {
    const previous = value;
    await update({ systemPrompt: AI_DEFAULT_SYSTEM_PROMPT });
    toast.info("Reset AI terminal-assistant prompt", "Restored compiled-in default.", {
      label: "Undo",
      onClick: () => void update({ systemPrompt: previous }),
    });
  }, [update, value]);
  return (
    <div className="prompt-row">
      <div className="prompt-row-header">
        <label className="prompt-row-label" htmlFor="prompt-ai-main">
          <span>AI (terminal assistant)</span>
          {overridden && (
            <span
              className="prompt-row-dot"
              aria-label="customized"
              title="Customized — click Reset to restore the default."
            />
          )}
        </label>
        {overridden && (
          <button
            type="button"
            className="prompt-row-reset"
            onClick={() => void onReset()}
          >
            Reset to default
          </button>
        )}
      </div>
      <p className="prompt-row-desc">
        Powers the Explain action on terminal command blocks.
      </p>
      <textarea
        id="prompt-ai-main"
        rows={5}
        className="prompt-row-input"
        value={value}
        spellCheck={false}
        onChange={(e) => void update({ systemPrompt: e.target.value })}
      />
    </div>
  );
}

function PromptSubgroup({ group }: { group: PromptGroup }) {
  const overrides = usePromptsStore((s) => s.settings.overrides);
  const count = useMemo(
    () => customizedCount(group.id, overrides),
    [group.id, overrides],
  );
  return (
    <details className="prompt-subgroup">
      <summary>
        <Icon name="chevron-right" size={14} className="prompt-subgroup-caret" />
        <span className="prompt-subgroup-title">{group.label}</span>
        <span
          className={
            "prompt-subgroup-badge" +
            (count.custom > 0 ? " is-customized" : "")
          }
        >
          {count.custom > 0
            ? `${count.custom}/${count.total} customized`
            : "default"}
        </span>
      </summary>
      <div className="prompt-subgroup-body">
        {group.description && (
          <p className="prompt-subgroup-desc">{group.description}</p>
        )}
        {group.promptIds.map((id) => (
          <PromptRow key={id} id={id} />
        ))}
      </div>
    </details>
  );
}

function PromptRow({ id }: { id: PromptId }) {
  const meta = PROMPT_METADATA[id];
  const overrides = usePromptsStore((s) => s.settings.overrides);
  const update = usePromptsStore((s) => s.update);
  const reset = usePromptsStore((s) => s.reset);

  const overridden = isPromptOverridden(id, overrides);
  const value = overrides[id] ?? DEFAULT_PROMPTS[id];
  const inputId = `prompt-${id}`;

  const onReset = useCallback(async () => {
    const previous = overrides[id];
    await reset(id);
    // Brief undo window — accidental click on a long prompt is the main risk.
    toast.info(`Reset ${meta.label}`, "Restored compiled-in default.", {
      label: "Undo",
      onClick: () => {
        if (previous !== undefined) {
          void update(id, previous);
        }
      },
    });
  }, [id, meta.label, overrides, reset, update]);

  return (
    <div className="prompt-row">
      <div className="prompt-row-header">
        <label className="prompt-row-label" htmlFor={inputId}>
          <span>{meta.label}</span>
          {overridden && (
            <span
              className="prompt-row-dot"
              aria-label="customized"
              title="Customized — click Reset to restore the default."
            />
          )}
        </label>
        {overridden && (
          <button
            type="button"
            className="prompt-row-reset"
            onClick={() => void onReset()}
          >
            Reset to default
          </button>
        )}
      </div>
      <p className="prompt-row-desc">{meta.description}</p>
      <textarea
        id={inputId}
        rows={meta.rows}
        className={
          "prompt-row-input" + (meta.kind === "structured" ? " is-mono" : "")
        }
        value={value}
        spellCheck={false}
        onChange={(e) => void update(id, e.target.value)}
      />
      {meta.placeholders && meta.placeholders.length > 0 && (
        <div className="prompt-row-tokens">
          <span className="prompt-row-tokens-label">Placeholders:</span>
          {meta.placeholders.map((p) => (
            <TokenChip key={p.token} token={p.token} explain={p.explain} />
          ))}
        </div>
      )}
    </div>
  );
}

function TokenChip({ token, explain }: { token: string; explain: string }) {
  const [copied, setCopied] = useState(false);
  const onClick = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(token);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard may be unavailable in some contexts; tooltip still shows the value */
    }
  }, [token]);
  return (
    <button
      type="button"
      className="prompt-token"
      title={`${explain} Click to copy.`}
      onClick={() => void onClick()}
    >
      <code>{token}</code>
      {copied && <span className="prompt-token-copied"> copied</span>}
    </button>
  );
}
