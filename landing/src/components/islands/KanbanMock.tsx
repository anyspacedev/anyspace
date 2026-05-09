import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

type Card = { id: string; title: string; tag: string };

const INITIAL: Record<string, Card[]> = {
  todo: [
    { id: "t1", title: "Migrate auth to Clerk JWT", tag: "auth" },
    { id: "t2", title: "Wire OSC 133 markers to overlay", tag: "term" },
  ],
  doing: [
    { id: "d1", title: "Refactor preview port detection", tag: "preview" },
  ],
  done: [
    { id: "n1", title: "Implement /tmsg shell function", tag: "team" },
    { id: "n2", title: "Add Monaco theme bridge", tag: "editor" },
  ],
};

const COLUMNS: { id: keyof typeof INITIAL; label: string }[] = [
  { id: "todo", label: "To Do" },
  { id: "doing", label: "In Progress" },
  { id: "done", label: "Done" },
];

export default function KanbanMock() {
  const reduce = useReducedMotion();
  const [board, setBoard] = useState(INITIAL);

  useEffect(() => {
    if (reduce) return;
    // After ~1.4s on first paint, demonstrate the "live" feel by moving t1 → doing.
    const t = setTimeout(() => {
      setBoard((prev) => {
        if (!prev.todo.find((c) => c.id === "t1")) return prev;
        return {
          todo: prev.todo.filter((c) => c.id !== "t1"),
          doing: [{ id: "t1", title: "Migrate auth to Clerk JWT", tag: "auth" }, ...prev.doing],
          done: prev.done,
        };
      });
    }, 1400);
    return () => clearTimeout(t);
  }, [reduce]);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {COLUMNS.map((col) => (
        <div key={col.id} className="rounded-lg border border-border bg-bg-elev/40 p-3">
          <div className="mb-3 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">
            <span>{col.label}</span>
            <span>{board[col.id].length}</span>
          </div>
          <div className="flex flex-col gap-2">
            {board[col.id].map((c) => (
              <motion.div
                key={c.id}
                layout
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                className="rounded-md border border-border bg-bg p-3"
              >
                <div className="text-sm font-medium text-fg">{c.title}</div>
                <div className="mt-2 inline-flex rounded border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-[0.1em] text-fg-muted">
                  {c.tag}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
