use anyhow::{Context, Result};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::ipc::Channel;

pub type SessionId = String;

pub struct PtySession {
    pub id: SessionId,
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
}

impl PtySession {
    pub fn spawn(
        id: SessionId,
        cwd: Option<String>,
        env: HashMap<String, String>,
        cols: u16,
        rows: u16,
        on_data: Channel<Vec<u8>>,
    ) -> Result<Self> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .context("openpty failed")?;

        let shell = pick_shell();
        let mut cmd = CommandBuilder::new(shell.program);
        for arg in shell.args {
            cmd.arg(arg);
        }
        if let Some(cwd) = cwd.as_deref() {
            if Path::new(cwd).is_dir() {
                cmd.cwd(cwd);
            }
        }
        // Inherit a reasonable env, then overlay caller-supplied + shell-integration vars.
        for (k, v) in std::env::vars() {
            cmd.env(k, v);
        }
        for (k, v) in env {
            cmd.env(k, v);
        }
        // Tell the shell to source our integration script.
        let integration = crate::shell_integration::scripts::write_integration_script()?;
        cmd.env("TEAMSHIP_SHELL_INTEGRATION", &integration);
        // Bash-specific: BASH_ENV is sourced for non-interactive bash; we use it as a hook then
        // PROMPT_COMMAND-style emission inside the script handles interactive sessions.
        cmd.env("BASH_ENV", &integration);

        let child = pair
            .slave
            .spawn_command(cmd)
            .context("spawn shell failed")?;

        let mut reader = pair.master.try_clone_reader().context("clone reader")?;
        let writer = pair.master.take_writer().context("take writer")?;
        let master: Box<dyn MasterPty + Send> = pair.master;

        // Reader pump → channel
        let id_for_thread = id.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        if on_data.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                    Err(e) => {
                        eprintln!("pty[{id_for_thread}] read error: {e}");
                        break;
                    }
                }
            }
        });

        Ok(Self {
            id,
            master: Arc::new(Mutex::new(master)),
            writer: Arc::new(Mutex::new(writer)),
            child: Arc::new(Mutex::new(child)),
        })
    }

    pub fn write(&self, data: &[u8]) -> Result<()> {
        let mut w = self.writer.lock().unwrap();
        w.write_all(data).context("pty write")?;
        w.flush().context("pty flush")?;
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        let m = self.master.lock().unwrap();
        m.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .context("pty resize")?;
        Ok(())
    }

    pub fn kill(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
        }
    }
}

impl Drop for PtySession {
    fn drop(&mut self) {
        self.kill();
    }
}

struct ShellChoice {
    program: String,
    args: Vec<String>,
}

#[cfg(unix)]
fn pick_shell() -> ShellChoice {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    // Force interactive + login so PROMPT_COMMAND etc. fire.
    ShellChoice { program: shell, args: vec!["-il".into()] }
}

#[cfg(windows)]
fn pick_shell() -> ShellChoice {
    // Prefer ComSpec; fall back to pwsh/powershell/cmd by env hint.
    if let Ok(comspec) = std::env::var("COMSPEC") {
        return ShellChoice { program: comspec, args: vec![] };
    }
    ShellChoice { program: "cmd.exe".into(), args: vec![] }
}
