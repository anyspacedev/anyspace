// SSH_ASKPASS helper. OpenSSH invokes the program named by $SSH_ASKPASS to
// obtain the password when one is required. We write a tiny shell script
// that prints the password and exits, set 0700 perms on Unix, and arm a
// background thread to delete it after a short delay so the secret
// doesn't linger on disk.

use anyhow::{anyhow, Context, Result};
use std::path::PathBuf;
use std::thread;
use std::time::Duration;
use uuid::Uuid;

const HEREDOC_TAG: &str = "ANYSPACE_PW_EOF";
// Upper bound, not the typical case. ssh normally reads askpass within a
// second or two, but on Windows the full path from `ssh_askpass_prepare`
// returning to the spawned ssh actually calling askpass crosses a WSL
// cold-start, bash init, Terminal.tsx's 600ms settle, the user pressing
// Enter on the auto-typed command, and a TCP/handshake round trip — all
// easily >8s on a slow box. 5 minutes covers any reasonable interactive
// negotiation; the password is already on a 0700 file in the user's own
// temp dir, so a few extra minutes is a tolerable security tradeoff.
const CLEANUP_DELAY_SECS: u64 = 300;

pub fn prepare_askpass(password: &str) -> Result<String> {
    // Defense in depth: a password containing the heredoc terminator would
    // break out of the quoted heredoc. The UUID-tagged variant is unique
    // enough in practice; we still bail loudly if someone tries.
    if password.lines().any(|l| l == HEREDOC_TAG) {
        return Err(anyhow!("password contains reserved heredoc delimiter"));
    }

    let dir = std::env::temp_dir();
    std::fs::create_dir_all(&dir).context("create temp dir")?;
    let path: PathBuf = dir.join(format!("anyspace-askpass-{}.sh", Uuid::new_v4()));

    // Single-quoted heredoc disables expansion inside the body, so any
    // `$`, backslash, or backtick in the password reaches ssh verbatim.
    let body = format!(
        "#!/bin/sh\ncat <<'{tag}'\n{password}\n{tag}\n",
        tag = HEREDOC_TAG,
        password = password,
    );
    std::fs::write(&path, body).context("write askpass script")?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&path)
            .context("stat askpass script")?
            .permissions();
        perms.set_mode(0o700);
        std::fs::set_permissions(&path, perms).context("chmod askpass script")?;
    }

    // Best-effort cleanup. SSH invokes askpass once at the start of the
    // connection; an 8-second window covers the handshake even on slow
    // links. After that the script is unlinked.
    let cleanup_path = path.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_secs(CLEANUP_DELAY_SECS));
        let _ = std::fs::remove_file(&cleanup_path);
    });

    Ok(path.to_string_lossy().into_owned())
}
