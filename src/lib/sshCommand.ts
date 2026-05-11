import type { SshHost } from "../stores/sshHostsStore";
import type { SpawnProgram } from "./tauri";

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Build the ssh argv vector for a host record. The result is meant for
 *  `pty_spawn`'s `program` override — i.e. the PTY spawns `ssh` directly as
 *  the root process so that connection drops close the pane cleanly. */
export function buildSshArgs(host: SshHost): SpawnProgram {
  const args: string[] = [];
  if (host.identityFile) {
    args.push("-i", host.identityFile);
  }
  if (host.port && host.port !== 22) {
    args.push("-p", String(host.port));
  }
  if (host.jumpHost) {
    args.push("-J", host.jumpHost);
  }
  if (host.env) {
    for (const [k, v] of Object.entries(host.env)) {
      if (!k) continue;
      args.push("-o", `SetEnv=${k}=${v}`);
    }
  }
  const target = host.user ? `${host.user}@${host.host}` : host.host;
  if (host.defaultDirectory) {
    // -t forces TTY allocation when running a remote command. cd to the
    // requested dir, then exec a fresh interactive login shell so the
    // session looks like a normal SSH session, just rooted elsewhere.
    args.push("-t", target, `cd ${shellQuote(host.defaultDirectory)} && exec $SHELL -il`);
  } else {
    args.push(target);
  }
  return { cmd: "ssh", args };
}

/** Human-readable connection target, e.g. `alice@bastion:2222`. Used for
 *  pane subtitles and tooltips. */
export function formatHostTarget(host: SshHost): string {
  const userPart = host.user ? `${host.user}@` : "";
  const portPart = host.port && host.port !== 22 ? `:${host.port}` : "";
  return `${userPart}${host.host}${portPart}`;
}
