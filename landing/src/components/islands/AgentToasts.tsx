import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

type Toast = {
  from: string;
  to: string;
  body: string;
};

const TOASTS: Toast[] = [
  { from: "Coordinator", to: "Builder", body: "Spec ready. Take task #4." },
  { from: "Builder", to: "Reviewer", body: "PR open at #142, ready for review." },
  { from: "Observer", to: "@all", body: "Tests green on main." },
  { from: "Reviewer", to: "Builder", body: "LGTM. Merging now." },
];

export default function AgentToasts() {
  const reduce = useReducedMotion();
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (reduce) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % TOASTS.length), 3000);
    return () => clearInterval(id);
  }, [reduce]);

  // Show three rolling toasts, oldest at top fading out.
  const visible = [TOASTS[idx], TOASTS[(idx + 1) % TOASTS.length], TOASTS[(idx + 2) % TOASTS.length]];

  return (
    <div className="relative h-[280px]">
      <AnimatePresence initial={false}>
        {visible.map((t, i) => (
          <motion.div
            key={`${idx}-${i}`}
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{
              opacity: 1 - i * 0.25,
              y: i * 76,
              scale: 1 - i * 0.03,
            }}
            exit={{ opacity: 0, y: -16, scale: 0.94 }}
            transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
            className="absolute inset-x-0 rounded-xl border border-border bg-bg-elev px-4 py-3"
            style={{ zIndex: 10 - i }}
          >
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">
              <span className="text-fg">{t.from}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <line x1="5" y1="12" x2="19" y2="12" />
                <polyline points="12 5 19 12 12 19" />
              </svg>
              <span>{t.to}</span>
            </div>
            <div className="mt-1.5 text-sm text-fg">{t.body}</div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
