// Embeds shell init scripts that emit OSC 133 sequences for command-block parsing.
//
// OSC 133 reference (de-facto):
//   ESC ] 133 ; A ST    -> prompt start
//   ESC ] 133 ; B ST    -> prompt end / cmd start
//   ESC ] 133 ; C ST    -> command output start
//   ESC ] 133 ; D ; <exit> ST -> command finished

use anyhow::{Context, Result};
use std::path::PathBuf;

/// Returns a path to a script that, when sourced by bash/zsh/fish, installs
/// hooks that emit OSC 133 sequences. The launcher sets BASH_ENV / ZDOTDIR /
/// equivalent to make the chosen shell pick this up.
pub fn write_integration_script() -> Result<String> {
    let dir = std::env::temp_dir().join("teamship-shell-integration");
    std::fs::create_dir_all(&dir).context("create integration dir")?;
    let path: PathBuf = dir.join("integration.sh");
    if !path.exists() {
        std::fs::write(&path, BASH_ZSH_INTEGRATION).context("write integration script")?;
    }
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

# Initial prompt-start so the very first prompt is also wrapped in a block.
__teamship_emit "A"
"##;
