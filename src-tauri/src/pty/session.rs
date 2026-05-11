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
        program: Option<crate::pty::commands::SpawnProgram>,
        on_data: Channel<Vec<u8>>,
    ) -> Result<Self> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
            .context("openpty failed")?;

        // Compute the shell-integration env unconditionally — even program-
        // overridden spawns (ssh, etc) keep the vars set on the child; they're
        // harmless for non-shells and useful if the override is something like
        // a bash login that does source it.
        let integration = crate::shell_integration::scripts::write_integration_script()?;

        // Per-shell wiring. BASH_ENV alone never worked for *interactive* bash
        // or any zsh — see shell_integration/scripts.rs for the full story.
        let mut zsh_wrapper: Option<String> = None;
        let mut zsh_user_zdotdir: Option<String> = None;

        let mut cmd = if let Some(prog) = program {
            // Program-override path: spawn the requested binary directly. On
            // Windows we still need to go through WSL (cmd.exe / PowerShell
            // can't reach the system ssh; bash inside WSL can), so the
            // override is prepended with `wsl.exe -e`. On unix the binary
            // runs natively.
            #[cfg(windows)]
            {
                let mut c = CommandBuilder::new("wsl.exe");
                c.arg("-e");
                c.arg(&prog.cmd);
                for arg in &prog.args {
                    c.arg(arg);
                }
                c
            }
            #[cfg(not(windows))]
            {
                let mut c = CommandBuilder::new(&prog.cmd);
                for arg in &prog.args {
                    c.arg(arg);
                }
                c
            }
        } else {
            let shell = pick_shell()?;
            let mut shell_args: Vec<String> = shell.args.clone();

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
                // On Windows we run bash *inside WSL*, so the wrapper path
                // (Windows-native) needs to be re-expressed in `/mnt/<drive>/`
                // form for the Linux-side bash to find it. The `wsl.exe -e bash`
                // prefix from pick_shell() must be preserved or wsl.exe itself
                // tries to interpret `--rcfile` and bails.
                // Long options must precede short ones — `bash -i --rcfile X`
                // makes bash 5.2 bail with `--: invalid option`.
                #[cfg(windows)]
                {
                    let wrapper =
                        crate::shell_integration::scripts::to_wsl_path(Path::new(&wrapper));
                    shell_args = vec![
                        "-e".into(),
                        "bash".into(),
                        "--rcfile".into(),
                        wrapper,
                        "-i".into(),
                    ];
                }
                #[cfg(not(windows))]
                {
                    shell_args = vec!["--rcfile".into(), wrapper, "-i".into()];
                }
            }

            let mut c = CommandBuilder::new(shell.program);
            for arg in &shell_args {
                c.arg(arg);
            }
            c
        };
        if let Some(cwd) = cwd.as_deref() {
            if Path::new(cwd).is_dir() {
                cmd.cwd(cwd);
            }
        }
        // Inherit a reasonable env, then overlay caller-supplied + shell-integration vars.
        for (k, v) in std::env::vars() {
            cmd.env(k, v);
        }
        // xterm.js speaks xterm-256color. When Anyspace launches from a .desktop
        // entry / app launcher / Finder, the parent process often has no TERM
        // (or an inherited "dumb"/"unknown") — without this, ncurses tools like
        // top/vim/htop bail with "Error opening terminal: unknown".
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        for (k, v) in env {
            cmd.env(k, v);
        }
        // Path to the OSC 133 hook script — sourced by every wrapper rc.
        cmd.env("ANYSPACE_SHELL_INTEGRATION", &integration);
        // BASH_ENV still helps non-interactive bash subshells emit blocks too.
        cmd.env("BASH_ENV", &integration);
        if let Some(w) = zsh_wrapper {
            cmd.env("ZDOTDIR", w);
        }
        if let Some(u) = zsh_user_zdotdir {
            cmd.env("ANYSPACE_USER_ZDOTDIR", u);
        }

        // WSL doesn't forward Windows env vars into Linux by default — they
        // only reach bash if listed in `WSLENV`. The `/p` suffix tells WSL
        // to translate the value from a Windows path to the matching
        // `/mnt/<drive>` form. Path-typed keys get `/p`; ID/URL/string keys
        // are forwarded verbatim. We append to any pre-existing WSLENV so
        // user-configured forwards survive.
        #[cfg(windows)]
        {
            let path_keys = [
                "ANYSPACE_SHELL_INTEGRATION",
                "BASH_ENV",
                "ANYSPACE_TEAM_BIN_DIR",
                "ANYSPACE_TEAM_TMSG",
                "ANYSPACE_TASK_FILE",
                // SSH password auth: ssh inside WSL reads the askpass script
                // path from this env var, and the script itself lives on the
                // Windows host's $TMPDIR — `/p` translates `C:\...` to `/mnt/c/...`.
                "SSH_ASKPASS",
            ];
            let plain_keys = [
                "TERM",
                "COLORTERM",
                "ANYSPACE_PANE_ID",
                "ANYSPACE_TAB_ID",
                "ANYSPACE_API_URL",
                "ANYSPACE_API_TOKEN",
                // SSH password auth knobs — string-typed, no translation.
                "SSH_ASKPASS_REQUIRE",
                "DISPLAY",
            ];
            let mut parts: Vec<String> = std::env::var("WSLENV")
                .ok()
                .filter(|s| !s.is_empty())
                .into_iter()
                .collect();
            parts.extend(path_keys.iter().map(|k| format!("{k}/p")));
            parts.extend(plain_keys.iter().map(|k| (*k).to_string()));
            cmd.env("WSLENV", parts.join(":"));
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
fn pick_shell() -> Result<ShellChoice> {
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
    Ok(ShellChoice { program: shell, args: vec!["-il".into()], kind })
}

#[cfg(windows)]
fn pick_shell() -> Result<ShellChoice> {
    // Windows requires WSL — cmd.exe and PowerShell can't source the OSC 133
    // bash/zsh integration script that Super Brain, command blocks, and
    // tmsg.sh all depend on. Probe the canonical wsl.exe path; if missing,
    // surface a sentinel error the frontend recognizes (Terminal.tsx renders
    // an install-prompt overlay instead of falling back to a degraded shell).
    let wsl = Path::new(r"C:\Windows\System32\wsl.exe");
    if wsl.exists() {
        return Ok(ShellChoice {
            program: "wsl.exe".into(),
            args: vec!["-e".into(), "bash".into(), "-il".into()],
            kind: ShellKind::Bash,
        });
    }
    Err(anyhow::anyhow!("WSL_NOT_INSTALLED"))
}
