import { useEffect, useRef, useState } from "react";
import { Icon } from "../ui/Icon";
import type { CommandBlock } from "./osc133";

export type BlockAction =
  | "rerun"
  | "copyCmd"
  | "copyOut"
  | "copyMd"
  | "explain";

type Props = {
  block: CommandBlock;
  onAction: (action: BlockAction, blockId: string) => void;
};

export function BlockActions({ block, onAction }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [flash, setFlash] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  const isFinished = block.state === "finished";
  const canRerun = isFinished && !!block.command;

  const fireCopy = (action: "copyCmd" | "copyOut" | "copyMd") => {
    onAction(action, block.id);
    setMenuOpen(false);
    setFlash(true);
    window.setTimeout(() => setFlash(false), 1200);
  };

  return (
    <div className={"cmd-block-actions" + (menuOpen ? " menu-open" : "")}>
      {canRerun && (
        <button
          className="cmd-block-action-btn"
          onClick={(e) => {
            e.stopPropagation();
            onAction("rerun", block.id);
          }}
          title="Re-run command"
          aria-label="Re-run command"
        >
          <Icon name="refresh" size={12} />
        </button>
      )}
      {isFinished && (
        <button
          className="cmd-block-action-btn"
          onClick={(e) => {
            e.stopPropagation();
            onAction("explain", block.id);
          }}
          title="Explain with AI"
          aria-label="Explain with AI"
        >
          <Icon name="sparkles" size={12} />
        </button>
      )}
      <div className="cmd-block-action-menu" ref={menuRef}>
        <button
          className="cmd-block-action-btn"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          title="Copy"
          aria-label="Copy"
          aria-expanded={menuOpen}
          disabled={!isFinished}
        >
          <Icon name={flash ? "check" : "clipboard"} size={12} />
        </button>
        {menuOpen && (
          <div className="copy-menu" role="menu">
            <button
              type="button"
              role="menuitem"
              disabled={!block.command}
              onClick={(e) => {
                e.stopPropagation();
                fireCopy("copyCmd");
              }}
            >
              Copy command
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                fireCopy("copyOut");
              }}
            >
              Copy output
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={(e) => {
                e.stopPropagation();
                fireCopy("copyMd");
              }}
            >
              Copy as Markdown
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
