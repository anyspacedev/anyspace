import { useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Icon } from "../ui/Icon";
import { useSshHostsStore, type SshHost } from "../../stores/sshHostsStore";
import {
  sshPasswordSet,
  sshPasswordDelete,
  sshPasswordGet,
} from "../../lib/tauri";

type Props = {
  initial?: SshHost | null;
  onSaved: (host: SshHost) => void;
  onCancel: () => void;
};

type AuthMethod = "key" | "password";

type DraftState = {
  name: string;
  host: string;
  user: string;
  port: string;
  authMethod: AuthMethod;
  identityFile: string;
  password: string;
  jumpHost: string;
  defaultDirectory: string;
};

function toDraft(host: SshHost | null | undefined): DraftState {
  return {
    name: host?.name ?? "",
    host: host?.host ?? "",
    user: host?.user ?? "",
    port: host?.port !== undefined ? String(host.port) : "",
    authMethod: host?.authMethod ?? "key",
    identityFile: host?.identityFile ?? "",
    password: "",
    jumpHost: host?.jumpHost ?? "",
    defaultDirectory: host?.defaultDirectory ?? "",
  };
}

export function SshHostForm({ initial, onSaved, onCancel }: Props) {
  const upsertHost = useSshHostsStore((s) => s.upsertHost);
  const [draft, setDraft] = useState<DraftState>(() => toDraft(initial));
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const id = initial?.id ?? "";
  const isEdit = Boolean(id);
  const editingPasswordHost = isEdit && initial?.authMethod === "password";

  const portTrim = draft.port.trim();
  const portValid =
    portTrim === "" || (/^\d+$/.test(portTrim) && Number(portTrim) > 0 && Number(portTrim) <= 65535);
  // For a new host with password auth, require a non-empty password. For an
  // existing password host, an empty password means "leave keychain alone".
  const passwordOk =
    draft.authMethod !== "password" ||
    draft.password.length > 0 ||
    editingPasswordHost;
  const canSave =
    draft.name.trim().length > 0 &&
    draft.host.trim().length > 0 &&
    portValid &&
    passwordOk &&
    !saving;

  const update = (partial: Partial<DraftState>) =>
    setDraft((d) => ({ ...d, ...partial }));

  const setAuth = (method: AuthMethod) => {
    if (method === draft.authMethod) return;
    // Clear the other method's input so a stale value can't be saved by
    // accident if the user toggles back.
    if (method === "password") {
      update({ authMethod: method, identityFile: "" });
    } else {
      update({ authMethod: method, password: "" });
      setShowPassword(false);
    }
  };

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
    setError(null);
    try {
      const port = portTrim ? Number(portTrim) : undefined;
      const next: SshHost = {
        id,
        name: draft.name.trim(),
        host: draft.host.trim(),
        user: draft.user.trim() || undefined,
        port,
        authMethod: draft.authMethod,
        // Identity file is only meaningful for key auth — drop it when the
        // host uses password so a later toggle doesn't surface stale state.
        identityFile:
          draft.authMethod === "key" && draft.identityFile.trim()
            ? draft.identityFile.trim()
            : undefined,
        jumpHost: draft.jumpHost.trim() || undefined,
        defaultDirectory: draft.defaultDirectory.trim() || undefined,
        env: initial?.env,
      };

      // Sync the keychain before persisting the host record so we never
      // end up with a record claiming password auth but no stored secret.
      if (draft.authMethod === "password" && draft.password.length > 0) {
        try {
          await sshPasswordSet(next.id || initial?.id || "_pending", draft.password);
        } catch (e) {
          setError(`Failed to save password to keychain: ${String(e)}`);
          setSaving(false);
          return;
        }
      } else if (draft.authMethod === "password" && editingPasswordHost) {
        // Keychain entry already exists for this host; verify it's still
        // there to avoid claiming password auth on a host with no secret.
        try {
          const existing = await sshPasswordGet(initial!.id);
          if (!existing) {
            setError("No saved password found — enter one to enable password auth.");
            setSaving(false);
            return;
          }
        } catch {
          /* keychain unavailable — proceed; connect will surface the error */
        }
      }

      const saved = await upsertHost(next);

      // If the new host got a fresh id (no prior id), the password we just
      // wrote was under "_pending". Re-key it under the real id.
      if (
        !id &&
        draft.authMethod === "password" &&
        draft.password.length > 0 &&
        saved.id !== "_pending"
      ) {
        try {
          await sshPasswordSet(saved.id, draft.password);
          await sshPasswordDelete("_pending");
        } catch {
          /* best-effort */
        }
      }

      // If the user switched from password → key in this save, the store
      // already cleared the keychain entry. Nothing more to do here.

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

      <div className="stt-field">
        <span className="stt-field-label">Auth method</span>
        <div className="ssh-auth-toggle" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={draft.authMethod === "key"}
            className={`ssh-auth-toggle-btn${draft.authMethod === "key" ? " is-active" : ""}`}
            onClick={() => setAuth("key")}
          >
            SSH key
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={draft.authMethod === "password"}
            className={`ssh-auth-toggle-btn${draft.authMethod === "password" ? " is-active" : ""}`}
            onClick={() => setAuth("password")}
          >
            Password
          </button>
        </div>
      </div>

      {draft.authMethod === "key" && (
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
      )}

      {draft.authMethod === "password" && (
        <label className="stt-field">
          <span className="stt-field-label">Password</span>
          <div className="ssh-host-form-row">
            <input
              type={showPassword ? "text" : "password"}
              value={draft.password}
              placeholder={editingPasswordHost ? "(unchanged)" : "Enter SSH password"}
              onChange={(e) => update({ password: e.target.value })}
              spellCheck={false}
              autoComplete="new-password"
            />
            <button
              type="button"
              className="stt-hotkey-btn"
              aria-label={showPassword ? "Hide password" : "Show password"}
              onClick={() => setShowPassword((v) => !v)}
            >
              <Icon name={showPassword ? "eye-off" : "eye"} size={14} />
            </button>
          </div>
          <span className="ssh-host-form-hint">
            Stored in your OS keychain (libsecret / Keychain / Credential Manager).
            Requires OpenSSH 8.4+ on the connecting machine.
          </span>
        </label>
      )}

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
      {error && <div className="ssh-host-form-error">{error}</div>}
    </div>
  );
}
