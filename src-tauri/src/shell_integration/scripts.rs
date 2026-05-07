// Embeds shell init scripts that emit OSC 133 sequences for command-block parsing.
//
// OSC 133 reference (de-facto):
//   ESC ] 133 ; A ST    -> prompt start
//   ESC ] 133 ; B ST    -> prompt end / cmd start
//   ESC ] 133 ; C ST    -> command output start
//   ESC ] 133 ; D ; <exit> ST -> command finished
//
// Why we need wrapper rc files:
//   `BASH_ENV` is bash-only and only fires for *non-interactive* bash.
//   Interactive zsh/bash sessions ignore it entirely, so the integration
//   script never gets sourced and no OSC 133 sequences are emitted. We work
//   around this with the standard ZDOTDIR-redirect trick for zsh and the
//   --rcfile trick for bash. Both wrappers replay the user's real init
//   chain before sourcing the integration so the user's prompt/aliases
//   are preserved.

use anyhow::{Context, Result};
use std::path::PathBuf;

fn integration_root() -> Result<PathBuf> {
    let dir = std::env::temp_dir().join("teamship-shell-integration");
    std::fs::create_dir_all(&dir).context("create integration dir")?;
    Ok(dir)
}

/// Writes the OSC 133 hook script and returns its absolute path. Always
/// overwrites so updates to the script take effect on next spawn.
pub fn write_integration_script() -> Result<String> {
    let dir = integration_root()?;
    let path = dir.join("integration.sh");
    std::fs::write(&path, BASH_ZSH_INTEGRATION).context("write integration script")?;
    Ok(path.to_string_lossy().to_string())
}

/// Materializes a ZDOTDIR wrapper directory containing .zshenv/.zprofile/
/// .zshrc/.zlogin that delegate to the user's real init files (via
/// `$TEAMSHIP_USER_ZDOTDIR`) and then source the integration script.
/// Returns the wrapper directory path — caller sets `ZDOTDIR=<this>`.
pub fn write_zsh_wrapper_dir() -> Result<String> {
    let dir = integration_root()?.join("zsh");
    std::fs::create_dir_all(&dir).context("create zsh wrapper dir")?;
    std::fs::write(dir.join(".zshenv"), ZSH_WRAPPER_ZSHENV).context("write wrapper .zshenv")?;
    std::fs::write(dir.join(".zprofile"), ZSH_WRAPPER_ZPROFILE).context("write wrapper .zprofile")?;
    std::fs::write(dir.join(".zshrc"), ZSH_WRAPPER_ZSHRC).context("write wrapper .zshrc")?;
    std::fs::write(dir.join(".zlogin"), ZSH_WRAPPER_ZLOGIN).context("write wrapper .zlogin")?;
    Ok(dir.to_string_lossy().to_string())
}

/// Writes a bash rcfile wrapper that replays login + interactive init then
/// sources the integration script. Returns its path — caller invokes bash
/// with `--rcfile <this> -i` (and drops `-l`, since `--rcfile` is ignored
/// for login shells; the long option must come before `-i` or bash 5.2
/// rejects it as `--: invalid option`).
pub fn write_bash_wrapper_rc() -> Result<String> {
    let dir = integration_root()?;
    let path = dir.join("bashrc-wrapper.sh");
    std::fs::write(&path, BASH_WRAPPER_RC).context("write bash wrapper rc")?;
    Ok(path.to_string_lossy().to_string())
}

const BASH_ZSH_INTEGRATION: &str = r##"# Teamship shell integration (OSC 133)
# Source-safe in bash and zsh.

__teamship_emit() { printf '\033]133;%s\007' "$1"; }
__teamship_emit_d() { printf '\033]133;D;%s\007' "$1"; }

if [ -n "$ZSH_VERSION" ]; then
  autoload -Uz add-zsh-hook 2>/dev/null
  __teamship_precmd() {
    local last_status=$?
    __teamship_emit_d "$last_status"
    __teamship_emit "A"
  }
  __teamship_preexec() {
    __teamship_emit "B"
    __teamship_emit "C"
  }
  add-zsh-hook precmd __teamship_precmd 2>/dev/null
  add-zsh-hook preexec __teamship_preexec 2>/dev/null
elif [ -n "$BASH_VERSION" ]; then
  __teamship_last_exit=0
  __teamship_prompt_command() {
    __teamship_last_exit=$?
    __teamship_emit_d "$__teamship_last_exit"
    __teamship_emit "A"
  }
  __teamship_debug_trap() {
    # Run only just before the user's command, not for inner subshell calls.
    if [ -n "$COMP_LINE" ] || [ "$BASH_COMMAND" = "$PROMPT_COMMAND" ]; then
      return
    fi
    __teamship_emit "B"
    __teamship_emit "C"
  }
  PROMPT_COMMAND="__teamship_prompt_command;${PROMPT_COMMAND:-}"
  trap '__teamship_debug_trap' DEBUG
fi

# Team mode: prepend the per-launch bin dir to PATH so subprocesses (claude,
# codex, …) launched from this shell can resolve `tmsg` by name. PATH is
# exported, so any process this shell spawns inherits the modified PATH
# directly — no re-sourcing required in the child.
if [ -n "${TEAMSHIP_TEAM_BIN_DIR:-}" ] && [ -d "$TEAMSHIP_TEAM_BIN_DIR" ]; then
  case ":$PATH:" in
    *":$TEAMSHIP_TEAM_BIN_DIR:"*) ;;
    *) export PATH="$TEAMSHIP_TEAM_BIN_DIR:$PATH" ;;
  esac
fi

# Team mode: also source the tmsg helper so the operator's interactive shell
# resolves `tmsg` as a no-fork shell function (function lookup precedes PATH).
if [ -n "$TEAMSHIP_TEAM_TMSG" ] && [ -f "$TEAMSHIP_TEAM_TMSG" ]; then
  # shellcheck disable=SC1090
  source "$TEAMSHIP_TEAM_TMSG"
fi

# Initial prompt-start so the very first prompt is also wrapped in a block.
__teamship_emit "A"
"##;

// .zshenv runs first for every zsh — login or not. Save the wrapper's
// ZDOTDIR, swap to the user's, source their .zshenv, then restore so zsh
// keeps reading the rest (.zprofile/.zshrc/.zlogin) from this wrapper dir.
const ZSH_WRAPPER_ZSHENV: &str = r##"# Teamship zsh wrapper — sources user's real .zshenv.
WRAPPER_ZDOTDIR="$ZDOTDIR"
USER_ZDOTDIR="${TEAMSHIP_USER_ZDOTDIR:-$HOME}"
if [ -f "$USER_ZDOTDIR/.zshenv" ]; then
  ZDOTDIR="$USER_ZDOTDIR"
  source "$USER_ZDOTDIR/.zshenv"
fi
ZDOTDIR="$WRAPPER_ZDOTDIR"
unset WRAPPER_ZDOTDIR USER_ZDOTDIR
"##;

const ZSH_WRAPPER_ZPROFILE: &str = r##"USER_ZDOTDIR="${TEAMSHIP_USER_ZDOTDIR:-$HOME}"
[ -f "$USER_ZDOTDIR/.zprofile" ] && ZDOTDIR="$USER_ZDOTDIR" source "$USER_ZDOTDIR/.zprofile"
unset USER_ZDOTDIR
"##;

// Source the user's .zshrc first so their prompt/hooks are in place, then
// load the integration so our hooks win precmd/preexec ordering and emit
// OSC 133 right before/after the user's prompt prints.
const ZSH_WRAPPER_ZSHRC: &str = r##"USER_ZDOTDIR="${TEAMSHIP_USER_ZDOTDIR:-$HOME}"
[ -f "$USER_ZDOTDIR/.zshrc" ] && ZDOTDIR="$USER_ZDOTDIR" source "$USER_ZDOTDIR/.zshrc"
unset USER_ZDOTDIR
[ -n "$TEAMSHIP_SHELL_INTEGRATION" ] && source "$TEAMSHIP_SHELL_INTEGRATION"
"##;

const ZSH_WRAPPER_ZLOGIN: &str = r##"USER_ZDOTDIR="${TEAMSHIP_USER_ZDOTDIR:-$HOME}"
[ -f "$USER_ZDOTDIR/.zlogin" ] && ZDOTDIR="$USER_ZDOTDIR" source "$USER_ZDOTDIR/.zlogin"
unset USER_ZDOTDIR
"##;

// bash --rcfile is ignored for login shells, so callers must drop -l. We
// replay the login init chain manually here, then the interactive .bashrc,
// then the integration script.
const BASH_WRAPPER_RC: &str = r##"# Teamship bash wrapper — replays user init then loads OSC 133 integration.
[ -f /etc/profile ] && source /etc/profile
for __ts_f in "$HOME/.bash_profile" "$HOME/.bash_login" "$HOME/.profile"; do
  if [ -f "$__ts_f" ]; then source "$__ts_f"; break; fi
done
unset __ts_f
[ -f /etc/bash.bashrc ] && source /etc/bash.bashrc
[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"
[ -n "$TEAMSHIP_SHELL_INTEGRATION" ] && source "$TEAMSHIP_SHELL_INTEGRATION"
"##;
