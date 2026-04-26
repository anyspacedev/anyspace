import { Icon } from "../ui/Icon";
import { basename } from "./editorPayload";

type Props = {
  files: string[];
  activePath: string | null;
  dirtyMap: Record<string, boolean>;
  onSwitch: (path: string) => void;
  onClose: (path: string) => void;
  onAdd: () => void;
};

export function EditorTabs({
  files,
  activePath,
  dirtyMap,
  onSwitch,
  onClose,
  onAdd,
}: Props) {
  return (
    <div className="editor-tabs scrollbar">
      {files.map((f) => {
        const active = f === activePath;
        const dirty = !!dirtyMap[f];
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
              onClick={() => onSwitch(f)}
            >
              <span className="editor-tab-name">{name}</span>
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
