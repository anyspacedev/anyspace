use anyhow::{Context, Result};
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::ipc::Channel;
use tauri::{AppHandle, Emitter};

pub type SessionId = String;

pub struct PtySession {
    master: Arc<Mutex<Box<dyn MasterPty + Send>>>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
}

impl PtySession {
    pub fn spawn(
        app: AppHandle,
        id: &SessionId,
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

        // Compute final args + integration env up front so we can mutate args
        // for bash (--rcfile) before handing them to CommandBuilder.
        let integration = crate::shell_integration::scripts::write_integration_script()?;
        let mut shell_args: Vec<String> = shell.args.clone();

        // Per-shell wiring. BASH_ENV alone never worked for *interactive* bash
        // or any zsh — see shell_integration/scripts.rs for the full story.
        let mut zsh_wrapper: Option<String> = None;
        let mut zsh_user_zdotdir: Option<String> = None;
        if shell.kind == ShellKind::Zsh {
            zsh_wrapper = Some(crate::shell_integration::scripts::write_zsh_wrapper_dir()?);
            zsh_user_zdotdir = Some(
                std::env::var("ZDOTDIR")
                    .ok()
                    .filter(|s| !s.is_empty())
                    .or_else(|| std::env::var("HOME").ok())
                    .unwrap_or_default(),
            );
        } else if shell.kind == ShellKind::Bash {
            // bash --rcfile is ignored for login shells, so we drop -l and
            // replay the login init chain inside the wrapper rc file.
            let wrapper = crate::shell_integration::scripts::write_bash_wrapper_rc()?;
            // Long options must precede short ones — `bash -i --rcfile X`
            // makes bash 5.2 bail with `--: invalid option`.
            shell_args = vec!["--rcfile".into(), wrapper, "-i".into()];
        }

        let mut cmd = CommandBuilder::new(shell.program);
        for arg in &shell_args {
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
        // Path to the OSC 133 hook script — sourced by every wrapper rc.
        cmd.env("TEAMSHIP_SHELL_INTEGRATION", &integration);
        // BASH_ENV still helps non-interactive bash subshells emit blocks too.
        cmd.env("BASH_ENV", &integration);
        if let Some(w) = zsh_wrapper {
            cmd.env("ZDOTDIR", w);
        }
        if let Some(u) = zsh_user_zdotdir {
            cmd.env("TEAMSHIP_USER_ZDOTDIR", u);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .context("spawn shell failed")?;

        let mut reader = pair.master.try_clone_reader().context("clone reader")?;
        let writer = pair.master.take_writer().context("take writer")?;
        let master: Box<dyn MasterPty + Send> = pair.master;

        // Reader pump → channel. EOF (Ok(0)) means the child shell exited
        // (the slave fd closed) — emit `pty:exit:<id>` so the frontend can
        // close the pane synchronously instead of leaving it stuck on a
        // dead shell.
        let id_for_thread = id.to_string();
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
            let _ = app.emit(&format!("pty:exit:{id_for_thread}"), ());
        });

        Ok(Self {
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
    kind: ShellKind,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ShellKind {
    Zsh,
    Bash,
    Other,
}

#[cfg(unix)]
fn pick_shell() -> ShellChoice {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/bash".into());
    let kind = match Path::new(&shell)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_lowercase()
        .as_str()
    {
        "zsh" => ShellKind::Zsh,
        "bash" => ShellKind::Bash,
        _ => ShellKind::Other,
    };
    // Force interactive + login so PROMPT_COMMAND etc. fire. Bash gets
    // overridden later (the spawn path swaps -il for -i --rcfile so the
    // integration wrapper actually loads).
    ShellChoice { program: shell, args: vec!["-il".into()], kind }
}

#[cfg(windows)]
fn pick_shell() -> ShellChoice {
    // Prefer ComSpec; fall back to pwsh/powershell/cmd by env hint.
    if let Ok(comspec) = std::env::var("COMSPEC") {
        return ShellChoice { program: comspec, args: vec![], kind: ShellKind::Other };
    }
    ShellChoice { program: "cmd.exe".into(), args: vec![], kind: ShellKind::Other }
}
