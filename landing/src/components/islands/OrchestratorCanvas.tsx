import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import VoiceSphere from "./VoiceSphere";

const CLAUDE_LINES = [
  "$ claude --task auth-refactor",
  "Reading src/auth/*.ts (12 files)…",
  "Drafting plan: extract JWT verifier",
  "→ Edit src/auth/jwt.ts (+34 −18)",
  "→ Edit src/auth/middleware.ts (+9 −5)",
  "tests passing (24 / 24)",
];

const AIDER_LINES = [
  "$ aider src/server/routes.ts",
  "loaded 1 file (412 LOC)",
  "> add rate-limit to /api/login",
  "Editing src/server/routes.ts",
  "+ import rateLimit from 'express-rate-limit'",
  "+ const loginLimiter = rateLimit({ … })",
  "Committed: 'rate-limit login route'",
];

function useTypewriter(lines: string[], delay = 1800) {
  const reduce = useReducedMotion();
  const [count, setCount] = useState(reduce ? lines.length : 1);
  useEffect(() => {
    if (reduce) {
      setCount(lines.length);
      return;
    }
    const id = setInterval(() => {
      setCount((c) => (c >= lines.length ? 1 : c + 1));
    }, delay);
    return () => clearInterval(id);
  }, [lines.length, delay, reduce]);
  return lines.slice(0, count);
}

function PaneChrome({ title, accent }: { title: string; accent?: boolean }) {
  return (
    <div className="flex h-7 items-center gap-2 border-b border-border px-3">
      <div className="flex gap-1.5">
        <span className="h-2 w-2 rounded-full bg-fg-dim/60" />
        <span className="h-2 w-2 rounded-full bg-fg-dim/40" />
        <span className="h-2 w-2 rounded-full bg-fg-dim/30" />
      </div>
      <span className={"font-mono text-[10px] uppercase tracking-[0.12em] " + (accent ? "text-fg" : "text-fg-muted")}>
        {title}
      </span>
    </div>
  );
}

function TerminalPane({ title, lines }: { title: string; lines: string[] }) {
  const visible = useTypewriter(lines, 2200);
  return (
    <div className="ring-pane flex flex-col overflow-hidden">
      <PaneChrome title={title} accent />
      <div className="flex-1 overflow-hidden p-3 font-mono text-[11px] leading-[1.55] text-fg-muted">
        {visible.map((line, i) => {
          const isPrompt = line.startsWith("$");
          const isArrow = line.startsWith("→") || line.startsWith("+");
          return (
            <div
              key={i}
              className={
                isPrompt ? "text-fg" : isArrow ? "text-fg-muted" : "text-fg-dim"
              }
            >
              {line}
              {i === visible.length - 1 && (
                <span className="ml-0.5 inline-block h-3 w-[6px] -mb-[2px] bg-fg align-middle animate-caret" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PreviewPane() {
  return (
    <div className="ring-pane flex flex-col overflow-hidden">
      <PaneChrome title="preview · localhost:5173" />
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="h-2.5 w-1/3 rounded-full bg-fg/80" />
        <div className="h-1.5 w-2/3 rounded-full bg-fg-muted/50" />
        <div className="mt-3 grid grid-cols-3 gap-2">
          <div className="h-10 rounded-md border border-border bg-bg" />
          <div className="h-10 rounded-md border border-border bg-bg" />
          <div className="h-10 rounded-md border border-border bg-bg" />
        </div>
        <div className="mt-2 h-1.5 w-1/2 rounded-full bg-fg-muted/40" />
        <div className="h-1.5 w-3/5 rounded-full bg-fg-muted/30" />
      </div>
    </div>
  );
}

function MobilePane() {
  return (
    <div className="ring-pane flex items-center justify-center overflow-hidden">
      <div className="flex h-full w-full flex-col">
        <PaneChrome title="mobile · iOS" />
        <div className="flex flex-1 items-center justify-center p-3">
          <div className="relative h-full max-h-[180px] w-[100px] rounded-[14px] border-2 border-fg/80 bg-bg p-1.5">
            <div className="absolute left-1/2 top-1.5 h-1 w-6 -translate-x-1/2 rounded-full bg-fg/60" />
            <div className="mt-3 flex h-[calc(100%-12px)] flex-col gap-1.5 overflow-hidden rounded-md border border-border p-1.5">
              <div className="h-1.5 w-2/3 rounded-full bg-fg/80" />
              <div className="h-1 w-1/2 rounded-full bg-fg-muted/50" />
              <div className="mt-1 grid grid-cols-2 gap-1">
                <div className="h-6 rounded border border-border bg-bg-elev" />
                <div className="h-6 rounded border border-border bg-bg-elev" />
              </div>
              <div className="h-1 w-3/4 rounded-full bg-fg-muted/40" />
              <div className="h-1 w-2/3 rounded-full bg-fg-muted/30" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function OrchestratorCanvas() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      className="relative mx-auto w-full max-w-[960px]"
    >
      <div className="relative rounded-xl border border-border bg-bg-elev p-3 sm:p-4">
        <div className="grid aspect-[16/10] grid-cols-1 gap-3 sm:grid-cols-2 sm:grid-rows-2">
          <TerminalPane title="claude code" lines={CLAUDE_LINES} />
          <TerminalPane title="aider" lines={AIDER_LINES} />
          <PreviewPane />
          <MobilePane />
        </div>
      </div>
      <div className="absolute -bottom-12 left-1/2 -translate-x-1/2">
        <div className="rounded-full border border-border bg-bg p-3">
          <VoiceSphere size={84} state="idle" className="text-fg" />
        </div>
      </div>
    </motion.div>
  );
}
