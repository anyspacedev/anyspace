import { useState } from "react";
import { Icon } from "../ui/Icon";
import { useSshHostsStore, type SshHost } from "../../stores/sshHostsStore";
import { useWorkspaceStore, type PanePreset } from "../../stores/workspaceStore";
import { buildSshArgs, formatHostTarget } from "../../lib/sshCommand";
import { SshHostForm } from "./SshHostForm";

type Mode =
  | { kind: "list" }
  | { kind: "edit"; host: SshHost }
  | { kind: "add" };

function connect(host: SshHost) {
  const ws = useWorkspaceStore.getState();
  const preset: PanePreset = {
    kind: "terminal",
    sshHostId: host.id,
    spawnProgram: buildSshArgs(host),
    title: host.name,
  };
  const activeTab = ws.tabs.find((t) => t.id === ws.activeTabId);
  if (activeTab && activeTab.activePaneId) {
    ws.splitPane(activeTab.id, activeTab.activePaneId, "horizontal", preset);
    ws.setView("workspace");
    return;
  }
  // No active tab — open a single-pane tab seeded with the SSH preset.
  ws.newTab(1, host.name, [preset]);
  ws.setView("workspace");
}

export function SshHostsView() {
  const hosts = useSshHostsStore((s) => s.hosts);
  const loaded = useSshHostsStore((s) => s.loaded);
  const removeHost = useSshHostsStore((s) => s.removeHost);
  const [mode, setMode] = useState<Mode>({ kind: "list" });

  const isListMode = mode.kind === "list";

  return (
    <div className="ssh-view">
      <header className="ssh-view-head">
        <div>
          <h1 className="ssh-view-title">Remotes</h1>
          <p className="ssh-view-sub">
            Stored SSH connections. Click Connect to open a remote terminal pane.
            Command blocks and Super Brain don't fire on SSH panes — the shell-
            integration hook lives only on this machine.
          </p>
        </div>
        {isListMode && (
          <button
            type="button"
            className="btn btn-primary btn-with-icon"
            onClick={() => setMode({ kind: "add" })}
          >
            <Icon name="plus" size={14} />
            Add host
          </button>
        )}
      </header>

      {mode.kind === "list" && (
        <>
          {!loaded ? (
            <div className="ssh-view-empty">Loading…</div>
          ) : hosts.length === 0 ? (
            <div className="ssh-view-empty">
              <p>No SSH hosts yet.</p>
              <p className="ssh-view-empty-hint">
                Add a host to spawn SSH panes from the sidebar. Anyspace uses
                your system <code>ssh</code> binary, so <code>~/.ssh/config</code>,
                ControlMaster, jump hosts, and keys work without extra setup.
              </p>
            </div>
          ) : (
            <ul className="ssh-host-list">
              {hosts.map((host) => (
                <li key={host.id} className="ssh-host-row">
                  <div className="ssh-host-row-main">
                    <div className="ssh-host-row-name">{host.name}</div>
                    <div className="ssh-host-row-target">
                      {formatHostTarget(host)}
                      {host.jumpHost && (
                        <span className="ssh-host-row-tag">via {host.jumpHost}</span>
                      )}
                    </div>
                  </div>
                  <div className="ssh-host-row-actions">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => connect(host)}
                    >
                      Connect
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setMode({ kind: "edit", host })}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={() => {
                        if (window.confirm(`Delete SSH host "${host.name}"?`)) {
                          void removeHost(host.id);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {mode.kind === "add" && (
        <div className="ssh-host-form-wrap">
          <h2 className="ssh-host-form-title">Add SSH host</h2>
          <SshHostForm
            initial={null}
            onSaved={() => setMode({ kind: "list" })}
            onCancel={() => setMode({ kind: "list" })}
          />
        </div>
      )}

      {mode.kind === "edit" && (
        <div className="ssh-host-form-wrap">
          <h2 className="ssh-host-form-title">Edit {mode.host.name}</h2>
          <SshHostForm
            initial={mode.host}
            onSaved={() => setMode({ kind: "list" })}
            onCancel={() => setMode({ kind: "list" })}
          />
        </div>
      )}
    </div>
  );
}
