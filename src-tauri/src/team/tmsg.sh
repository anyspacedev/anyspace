#!/usr/bin/env bash
# AnySpace team coordination — tmsg helper.
# Dual-mode: sourced by the OSC 133 integration when $ANYSPACE_TEAM_TMSG is set
# (defines a `tmsg` shell function for the prompt user) AND directly executable
# from PATH so subprocesses launched by agent CLIs can resolve `tmsg` by name.
# Required env (set by team launcher): ANYSPACE_TEAM_DIR ANYSPACE_TEAM_ID
#                                      ANYSPACE_AGENT_LABEL ANYSPACE_BOARD_PATH
#                                      ANYSPACE_MESSAGES_PATH

__tmsg_slug() {
  printf '%s' "$1" | tr ' ' '_' | tr -c 'A-Za-z0-9_-' '_' | tr -s '_'
}

__tmsg_uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr 'A-Z' 'a-z'
  elif [ -r /proc/sys/kernel/random/uuid ]; then
    cat /proc/sys/kernel/random/uuid
  else
    # Fallback: 16 random hex bytes from /dev/urandom
    od -An -N16 -tx1 /dev/urandom 2>/dev/null | tr -d ' \n' | sed -E 's/(.{8})(.{4})(.{4})(.{4})(.{12})/\1-\2-\3-\4-\5/'
  fi
}

__tmsg_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Append-safe write under a per-team lock so concurrent senders don't interleave.
__tmsg_append() {
  local file="$1"; shift
  local lock="${ANYSPACE_TEAM_DIR}/.lock"
  mkdir -p "$(dirname "$lock")" 2>/dev/null
  if command -v flock >/dev/null 2>&1; then
    ( flock -x 9
      printf '%s' "$*" >> "$file"
    ) 9>"$lock"
  else
    printf '%s' "$*" >> "$file"
  fi
}

__tmsg_require_env() {
  if [ -z "${ANYSPACE_TEAM_DIR:-}" ] || [ -z "${ANYSPACE_AGENT_LABEL:-}" ] \
     || [ -z "${ANYSPACE_MESSAGES_PATH:-}" ]; then
    printf 'tmsg: not in a team workspace (ANYSPACE_TEAM_DIR / ANYSPACE_AGENT_LABEL missing)\n' >&2
    return 1
  fi
}

__tmsg_send() {
  __tmsg_require_env || return 1
  local to="" body="" type="message"
  while [ $# -gt 0 ]; do
    case "$1" in
      --to) to="$2"; shift 2 ;;
      --body) body="$2"; shift 2 ;;
      --type) type="$2"; shift 2 ;;
      *) printf 'tmsg send: unknown arg %s\n' "$1" >&2; return 2 ;;
    esac
  done
  if [ -z "$to" ] || [ -z "$body" ]; then
    printf 'usage: tmsg send --to <Label|@all|@operator> [--type message|status|escalation|done] --body "..."\n' >&2
    return 2
  fi
  local id ts from
  id="$(__tmsg_uuid)"
  ts="$(__tmsg_iso)"
  from="$ANYSPACE_AGENT_LABEL"

  # Escape double quotes inside attribute values to keep header parseable.
  local from_e to_e type_e
  from_e="${from//\"/\\\"}"
  to_e="${to//\"/\\\"}"
  type_e="${type//\"/\\\"}"

  local block
  block="$(printf '\n<!-- msg id="%s" from="%s" to="%s" type="%s" ts="%s" -->\n%s\n<!-- /msg -->\n' \
    "$id" "$from_e" "$to_e" "$type_e" "$ts" "$body")"
  __tmsg_append "$ANYSPACE_MESSAGES_PATH" "$block"
  printf '%s\n' "$id"
}

# Read MESSAGES.md, print blocks addressed to me (or @all) that I haven't consumed yet.
# With --consume, append the printed IDs to my .consumed file.
__tmsg_check() {
  __tmsg_require_env || return 1
  local consume=0
  if [ "${1:-}" = "--consume" ]; then consume=1; fi

  local me="$ANYSPACE_AGENT_LABEL"
  local me_slug; me_slug="$(__tmsg_slug "$me")"
  local consumed_dir="${ANYSPACE_TEAM_DIR}/.consumed"
  local consumed_file="${consumed_dir}/${me_slug}.txt"
  mkdir -p "$consumed_dir"
  : > "${consumed_file}.tmp" 2>/dev/null
  rm -f "${consumed_file}.tmp" 2>/dev/null
  [ -f "$consumed_file" ] || : > "$consumed_file"

  if [ ! -f "$ANYSPACE_MESSAGES_PATH" ]; then return 0; fi

  awk -v me="$me" -v consumed_file="$consumed_file" -v consume="$consume" '
    function trim(s) { sub(/^[ \t\r\n]+/,"",s); sub(/[ \t\r\n]+$/,"",s); return s }
    function attr(s, k,    re, m) {
      re = k "=\"[^\"]*\""
      if (match(s, re)) {
        m = substr(s, RSTART, RLENGTH)
        sub(k "=\"", "", m)
        sub(/"$/, "", m)
        return m
      }
      return ""
    }
    BEGIN {
      while ((getline line < consumed_file) > 0) consumed[line] = 1
      close(consumed_file)
      in_block = 0; new_count = 0
    }
    /<!-- msg / {
      id = attr($0, "id"); from = attr($0, "from"); to = attr($0, "to");
      type = attr($0, "type"); ts = attr($0, "ts"); body = ""; in_block = 1; next
    }
    /<!-- \/msg -->/ {
      if (in_block) {
        if (id != "" && !(id in consumed) && (to == me || to == "@all")) {
          printf("---\nFrom: %s\nType: %s\nID: %s\nTime: %s\n%s\n", from, type, id, ts, trim(body))
          new_ids[new_count++] = id
        }
        in_block = 0
      }
      next
    }
    {
      if (in_block) body = body $0 "\n"
    }
    END {
      if (consume == 1 && new_count > 0) {
        for (i = 0; i < new_count; i++) print new_ids[i] >> consumed_file
      }
    }
  ' "$ANYSPACE_MESSAGES_PATH"
}

# Write an RPC request and block on its response file.
__tmsg_rpc() {
  __tmsg_require_env || return 1
  local action="$1"; shift
  local rpc_dir="${ANYSPACE_TEAM_DIR}/.rpc"
  mkdir -p "$rpc_dir"
  local id ts
  id="$(__tmsg_uuid)"
  ts="$(__tmsg_iso)"
  local req="${rpc_dir}/${id}.req"
  local res="${rpc_dir}/${id}.res"
  local payload="$1"

  printf '%s' "$payload" > "${req}.tmp"
  mv "${req}.tmp" "$req"

  local timeout="${ANYSPACE_RPC_TIMEOUT:-15}"
  local elapsed=0
  while [ ! -f "$res" ]; do
    sleep 0.2
    elapsed=$(awk -v e="$elapsed" 'BEGIN { printf "%.1f", e + 0.2 }')
    if awk -v e="$elapsed" -v t="$timeout" 'BEGIN { exit !(e+0 >= t+0) }'; then
      printf 'tmsg %s: timed out after %ss\n' "$action" "$timeout" >&2
      rm -f "$req"
      return 1
    fi
  done
  cat "$res"
  rm -f "$req" "$res"
}

__tmsg_pane_new()   { __tmsg_pane "new"   "$@"; }
__tmsg_pane_close() { __tmsg_pane "close" "$@"; }
__tmsg_pane_read()  { __tmsg_pane "read"  "$@"; }
__tmsg_pane_write() { __tmsg_pane "write" "$@"; }

__tmsg_pane() {
  local sub="$1"; shift
  local label="" role="" body="" lastn=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --label) label="$2"; shift 2 ;;
      --role)  role="$2";  shift 2 ;;
      --body)  body="$2";  shift 2 ;;
      --last-n) lastn="$2"; shift 2 ;;
      *) printf 'tmsg pane %s: unknown arg %s\n' "$sub" "$1" >&2; return 2 ;;
    esac
  done
  local from="${ANYSPACE_AGENT_LABEL}"
  # Hand-rolled JSON to avoid a jq dep — quote the few user strings we use.
  local q_label q_role q_body q_from
  q_label="${label//\\/\\\\}"; q_label="${q_label//\"/\\\"}"
  q_role="${role//\\/\\\\}";   q_role="${q_role//\"/\\\"}"
  q_body="${body//\\/\\\\}";   q_body="${q_body//\"/\\\"}"
  q_body="${q_body//$'\n'/\\n}"
  q_from="${from//\\/\\\\}";   q_from="${q_from//\"/\\\"}"
  local payload
  payload="$(printf '{"action":"pane.%s","from":"%s","label":"%s","role":"%s","body":"%s","lastN":%s}' \
    "$sub" "$q_from" "$q_label" "$q_role" "$q_body" "${lastn:-null}")"
  __tmsg_rpc "pane.$sub" "$payload"
}

__tmsg_roster() {
  __tmsg_require_env || return 1
  if [ -f "${ANYSPACE_BOARD_PATH:-}" ]; then
    awk '/^## Roster/{flag=1; next} /^## /{flag=0} flag' "$ANYSPACE_BOARD_PATH"
  fi
}

__tmsg_board() {
  __tmsg_require_env || return 1
  [ -f "${ANYSPACE_BOARD_PATH:-}" ] && cat "$ANYSPACE_BOARD_PATH"
}

tmsg() {
  local sub="${1:-}"
  if [ -z "$sub" ]; then
    cat <<'EOF'
tmsg — team coordination helper

  tmsg send --to <Label|@all|@operator> [--type message|status|escalation|done] --body "..."
  tmsg check [--consume]
  tmsg roster
  tmsg board
  tmsg pane new   --role <role> --label <label>
  tmsg pane close --label <label>
  tmsg pane read  --label <label> [--last-n N]
  tmsg pane write --label <label> --body "..."
EOF
    return 0
  fi
  shift
  case "$sub" in
    send)   __tmsg_send "$@" ;;
    check)  __tmsg_check "$@" ;;
    roster) __tmsg_roster ;;
    board)  __tmsg_board ;;
    pane)
      local psub="${1:-}"; shift 2>/dev/null
      case "$psub" in
        new)   __tmsg_pane_new "$@" ;;
        close) __tmsg_pane_close "$@" ;;
        read)  __tmsg_pane_read "$@" ;;
        write) __tmsg_pane_write "$@" ;;
        *) printf 'tmsg pane: unknown subcommand %s\n' "$psub" >&2; return 2 ;;
      esac
      ;;
    *) printf 'tmsg: unknown subcommand %s\n' "$sub" >&2; return 2 ;;
  esac
}

export -f tmsg 2>/dev/null

# When executed directly (kernel uses the shebang → bash), run the dispatcher.
# When sourced (by integration.sh under bash *or* zsh), this guard is skipped:
#   - bash source: BASH_SOURCE[0] != $0
#   - zsh source:  BASH_VERSION unset
if [ -n "${BASH_VERSION:-}" ] && [ "${BASH_SOURCE[0]:-}" = "${0:-}" ]; then
  tmsg "$@"
fi
