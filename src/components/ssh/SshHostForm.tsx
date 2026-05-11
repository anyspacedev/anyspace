import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Icon } from "../ui/Icon";
import { useSshHostsStore, type SshHost } from "../../stores/sshHostsStore";

type Props = {
  initial?: SshHost | null;
  onSaved: (host: SshHost) => void;
  onCancel: () => void;
};

type DraftState = {
  name: string;
  host: string;
  user: string;
  port: string;
  identityFile: string;
  jumpHost: string;
  defaultDirectory: string;
};

function toDraft(host: SshHost | null | undefined): DraftState {
  return {
    name: host?.name ?? "",
    host: host?.host ?? "",
    user: host?.user ?? "",
    port: host?.port !== undefined ? String(host.port) : "",
    identityFile: host?.identityFile ?? "",
    jumpHost: host?.jumpHost ?? "",
    defaultDirectory: host?.defaultDirectory ?? "",
  };
}

export function SshHostForm({ initial, onSaved, onCancel }: Props) {
  const upsertHost = useSshHostsStore((s) => s.upsertHost);
  const [draft, setDraft] = useState<DraftState>(() => toDraft(initial));
  const [saving, setSaving] = useState(false);

  const id = initial?.id ?? "";
  const portTrim = draft.port.trim();
  const portValid =
    portTrim === "" || (/^\d+$/.test(portTrim) && Number(portTrim) > 0 && Number(portTrim) <= 65535);
  const canSave =
    draft.name.trim().length > 0 && draft.host.trim().length > 0 && portValid && !saving;

  const update = (partial: Partial<DraftState>) =>
    setDraft((d) => ({ ...d, ...partial }));

  const pickIdentityFile = async () => {
    try {
      const picked = await openDialog({ multiple: false, directory: false });
      if (typeof picked === "string") update({ identityFile: picked });
    } catch {
      /* user cancelled */
    }
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const port = portTrim ? Number(portTrim) : undefined;
      const next: SshHost = {
        id,
        name: draft.name.trim(),
        host: draft.host.trim(),
        user: draft.user.trim() || undefined,
        port,
        identityFile: draft.identityFile.trim() || undefined,
        jumpHost: draft.jumpHost.trim() || undefined,
        defaultDirectory: draft.defaultDirectory.trim() || undefined,
        env: initial?.env,
      };
      const saved = await upsertHost(next);
      onSaved(saved);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ssh-host-form">
      <label className="stt-field">
        <span className="stt-field-label">Name</span>
        <input
          autoFocus
          type="text"
          value={draft.name}
          placeholder="e.g. prod-bastion"
          onChange={(e) => update({ name: e.target.value })}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <label className="stt-field">
        <span className="stt-field-label">Host</span>
        <input
          type="text"
          value={draft.host}
          placeholder="hostname or IP"
          onChange={(e) => update({ host: e.target.value })}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <label className="stt-field">
        <span className="stt-field-label">User</span>
        <input
          type="text"
          value={draft.user}
          placeholder="(optional — defaults to ~/.ssh/config)"
          onChange={(e) => update({ user: e.target.value })}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <label className="stt-field">
        <span className="stt-field-label">Port</span>
        <input
          type="text"
          value={draft.port}
          placeholder="22"
          onChange={(e) => update({ port: e.target.value })}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <label className="stt-field">
        <span className="stt-field-label">Identity file</span>
        <div className="ssh-host-form-row">
          <input
            type="text"
            value={draft.identityFile}
            placeholder="~/.ssh/id_ed25519 (optional)"
            onChange={(e) => update({ identityFile: e.target.value })}
            spellCheck={false}
            autoComplete="off"
          />
          <button type="button" className="stt-hotkey-btn" onClick={() => void pickIdentityFile()}>
            Browse…
          </button>
        </div>
      </label>
      <label className="stt-field">
        <span className="stt-field-label">Jump host</span>
        <input
          type="text"
          value={draft.jumpHost}
          placeholder="user@bastion (optional, passed as -J)"
          onChange={(e) => update({ jumpHost: e.target.value })}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <label className="stt-field">
        <span className="stt-field-label">Default directory</span>
        <input
          type="text"
          value={draft.defaultDirectory}
          placeholder="cd here on connect (POSIX shells only)"
          onChange={(e) => update({ defaultDirectory: e.target.value })}
          spellCheck={false}
          autoComplete="off"
        />
      </label>
      <div className="ssh-host-form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-with-icon"
          onClick={() => void save()}
          disabled={!canSave}
        >
          <Icon name="check" size={14} />
          {id ? "Save" : "Add host"}
        </button>
      </div>
      {!portValid && (
        <div className="ssh-host-form-error">Port must be a number between 1 and 65535.</div>
      )}
    </div>
  );
}
