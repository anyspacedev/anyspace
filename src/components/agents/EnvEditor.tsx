import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";

type Row = { id: number; key: string; value: string };

let rowIdSeq = 0;
const nextRowId = () => ++rowIdSeq;

function parseEnv(json: string): Row[] {
  if (!json || !json.trim()) return [];
  try {
    const obj = JSON.parse(json);
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return [];
    return Object.entries(obj).map(([k, v]) => ({
      id: nextRowId(),
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
  const [rows, setRows] = useState<Row[]>(() => parseEnv(envJson));
  const lastEmitted = useRef<string>(stringifyEnv(rows));

  // Resync from props when the parent swaps in a different envJson (e.g. the
  // user picked a different agent). Ignore echoes of our own emissions, since
  // empty-key rows are stripped on the way out and must not be discarded here.
  useEffect(() => {
    if (envJson === lastEmitted.current) return;
    const parsed = parseEnv(envJson);
    setRows(parsed);
    lastEmitted.current = stringifyEnv(parsed);
  }, [envJson]);

  const emit = (next: Row[]) => {
    setRows(next);
    const json = stringifyEnv(next);
    lastEmitted.current = json;
    onChange(json);
  };

  const setRow = (id: number, patch: Partial<Omit<Row, "id">>) => {
    emit(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };
  const removeRow = (id: number) => {
    emit(rows.filter((r) => r.id !== id));
  };
  const addRow = () => {
    emit([...rows, { id: nextRowId(), key: "", value: "" }]);
  };

  return (
    <div className="env-editor">
      {rows.length === 0 && (
        <div className="env-editor-empty">
          No environment variables — agents inherit the parent shell's env. Add
          one if your CLI needs an API key or feature flag.
        </div>
      )}
      {rows.map((r) => (
        <div className="env-row" key={r.id}>
          <input
            className="env-row-key"
            value={r.key}
            placeholder="KEY"
            spellCheck={false}
            onChange={(e) => setRow(r.id, { key: e.target.value })}
          />
          <span className="env-row-eq" aria-hidden="true">=</span>
          <input
            className="env-row-value"
            value={r.value}
            placeholder="value"
            spellCheck={false}
            onChange={(e) => setRow(r.id, { value: e.target.value })}
          />
          <button
            type="button"
            className="icon-btn"
            aria-label="Remove env var"
            title="Remove"
            onClick={() => removeRow(r.id)}
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
