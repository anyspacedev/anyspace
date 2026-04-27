// Centralized keyboard shortcut dispatcher.
// All shortcuts use the platform "mod" key (Cmd on macOS, Ctrl on others).

const isMac = typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

export const modKey = isMac ? "metaKey" : "ctrlKey";

export type ShortcutAction =
  | "newTab"
  | "closeTab"
  | "quickOpen"
  | "search"
  | "splitPane"
  | "splitPaneVertical"
  | "switchTab1"
  | "switchTab2"
  | "switchTab3"
  | "switchTab4"
  | "switchTab5"
  | "switchTab6"
  | "switchTab7"
  | "switchTab8"
  | "switchTab9"
  | "themeNext"
  | "togglePreview"
  | "jumpBlockPrev"
  | "jumpBlockNext"
  | "runSuperBrain";

const handlers = new Map<ShortcutAction, () => void>();

export function registerShortcut(action: ShortcutAction, handler: () => void): () => void {
  handlers.set(action, handler);
  return () => {
    if (handlers.get(action) === handler) handlers.delete(action);
  };
}

function dispatch(action: ShortcutAction) {
  const fn = handlers.get(action);
  if (fn) fn();
}

export function attachGlobalShortcuts() {
  const onKey = (e: KeyboardEvent) => {
    const mod = e[modKey];
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (e.shiftKey && k === "d") return dispatch("splitPaneVertical"), e.preventDefault();
    if (e.shiftKey && k === "b") return dispatch("runSuperBrain"), e.preventDefault();
    switch (k) {
      case "t": dispatch("newTab"); e.preventDefault(); break;
      case "w": dispatch("closeTab"); e.preventDefault(); break;
      case "p": dispatch("quickOpen"); e.preventDefault(); break;
      case "f": dispatch("search"); e.preventDefault(); break;
      case "d": dispatch("splitPane"); e.preventDefault(); break;
      case "1": dispatch("switchTab1"); e.preventDefault(); break;
      case "2": dispatch("switchTab2"); e.preventDefault(); break;
      case "3": dispatch("switchTab3"); e.preventDefault(); break;
      case "4": dispatch("switchTab4"); e.preventDefault(); break;
      case "5": dispatch("switchTab5"); e.preventDefault(); break;
      case "6": dispatch("switchTab6"); e.preventDefault(); break;
      case "7": dispatch("switchTab7"); e.preventDefault(); break;
      case "8": dispatch("switchTab8"); e.preventDefault(); break;
      case "9": dispatch("switchTab9"); e.preventDefault(); break;
      case "[": dispatch("jumpBlockPrev"); e.preventDefault(); break;
      case "]": dispatch("jumpBlockNext"); e.preventDefault(); break;
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}
