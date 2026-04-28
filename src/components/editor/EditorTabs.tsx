import { Icon } from "../ui/Icon";
import { basename } from "./editorPayload";
import type { GitStatusLetter } from "../../lib/tauri";

type Props = {
  files: string[];
  activePath: string | null;
  dirtyMap: Record<string, boolean>;
  gitMap: Record<string, GitStatusLetter>;
  onSwitch: (path: string) => void;
  onClose: (path: string) => void;
  onAdd: () => void;
};

const GIT_TITLES: Record<GitStatusLetter, string> = {
  M: "Modified",
  A: "Added",
  D: "Deleted",
  R: "Renamed",
  C: "Copied",
  "?": "Untracked",
  U: "Unmerged",
};
const GIT_CLASS: Record<GitStatusLetter, string> = {
  M: "m",
  A: "a",
  D: "d",
  R: "r",
  C: "c",
  "?": "untracked",
  U: "u",
};

export function EditorTabs({
  files,
  activePath,
  dirtyMap,
  gitMap,
  onSwitch,
  onClose,
  onAdd,
}: Props) {
  return (
    <div className="editor-tabs scrollbar">
      {files.map((f) => {
        const active = f === activePath;
        const dirty = !!dirtyMap[f];
        const git = gitMap[f];
        const name = basename(f);
        return (
          <div
            key={f}
            className={"editor-tab" + (active ? " active" : "")}
            title={f}
          >
            <button
              type="button"
              className="editor-tab-label"
              aria-current={active ? "true" : undefined}
              onClick={() => onSwitch(f)}
            >
              <span className="editor-tab-name">{name}</span>
              {git && (
                <span
                  className={"editor-tab-git git-" + GIT_CLASS[git]}
                  title={GIT_TITLES[git]}
                  aria-label={GIT_TITLES[git]}
                >
                  {git}
                </span>
              )}
              {dirty && (
                <span
                  className="editor-tab-dirty"
                  aria-label="unsaved changes"
                />
              )}
            </button>
            <button
              type="button"
              className="editor-tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onClose(f);
              }}
              aria-label={`Close ${name}`}
              title="Close"
            >
              <Icon name="x" size={10} />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="editor-tab-add"
        onClick={onAdd}
        aria-label="Open file"
        title="Open file"
      >
        <Icon name="plus" size={12} />
      </button>
    </div>
  );
}
