import { useMemo } from "react";
import { Icon } from "../ui/Icon";

type Row = { key: string; value: string };

function parseEnv(json: string): Row[] {
  if (!json || !json.trim()) return [];
  try {
    const obj = JSON.parse(json);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
    return Object.entries(obj).map(([k, v]) => ({
      key: k,
      value: typeof v === "string" ? v : String(v ?? ""),
    }));
  } catch {
    return [];
  }
}

function stringifyEnv(rows: Row[]): string {
  const obj: Record<string, string> = {};
  for (const r of rows) {
    const k = r.key.trim();
    if (!k) continue;
    obj[k] = r.value;
  }
  return JSON.stringify(obj);
}

export function EnvEditor({
  envJson,
  onChange,
}: {
  envJson: string;
  onChange: (next: string) => void;
}) {
  const rows = useMemo(() => parseEnv(envJson), [envJson]);

  const setRow = (idx: number, patch: Partial<Row>) => {
    const next = rows.map((r, i) => (i === idx ? { ...r, ...patch } : r));
    onChange(stringifyEnv(next));
  };
  const removeRow = (idx: number) => {
    const next = rows.filter((_, i) => i !== idx);
    onChange(stringifyEnv(next));
  };
  const addRow = () => {
    onChange(stringifyEnv([...rows, { key: "", value: "" }]));
  };

  return (
    <div className="env-editor">
      {rows.length === 0 && (
        <div className="env-editor-empty">
          No environment variables — agents inherit the parent shell's env. Add
          one if your CLI needs an API key or feature flag.
        </div>
      )}
      {rows.map((r, i) => (
        <div className="env-row" key={i}>
          <input
            className="env-row-key"
            value={r.key}
            placeholder="KEY"
            spellCheck={false}
            onChange={(e) => setRow(i, { key: e.target.value })}
          />
          <span className="env-row-eq" aria-hidden="true">=</span>
          <input
            className="env-row-value"
            value={r.value}
            placeholder="value"
            spellCheck={false}
            onChange={(e) => setRow(i, { value: e.target.value })}
          />
          <button
            type="button"
            className="icon-btn"
            aria-label="Remove env var"
            title="Remove"
            onClick={() => removeRow(i)}
          >
            <Icon name="x" size={12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn btn-ghost btn-with-icon env-add"
        onClick={addRow}
      >
        <Icon name="plus" size={12} />
        <span>Add env var</span>
      </button>
    </div>
  );
}
