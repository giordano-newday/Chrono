#!/usr/bin/env zsh

# chrono — zsh integration plugin
# Source this file from ~/.zshrc

# ── Session ───────────────────────────────────────────────
export CHRONO_SESSION=$(uuidgen 2>/dev/null || cat /proc/sys/kernel/random/uuid 2>/dev/null || echo $$)

# ── Binary path ───────────────────────────────────────────
CHRONO_BIN="${CHRONO_BIN:-$HOME/.chrono/bin/chrono}"

# ── Hooks ─────────────────────────────────────────────────

_chrono_preexec_timestamp=0
_chrono_preexec_command=""

chrono_preexec() {
  _chrono_preexec_command="$1"
  _chrono_preexec_timestamp=$EPOCHSECONDS
}

chrono_precmd() {
  local exit_code=$?
  local cmd="$_chrono_preexec_command"
  _chrono_preexec_command=""

  [[ -z "$cmd" ]] && return

  local duration=0
  if (( _chrono_preexec_timestamp > 0 )); then
    duration=$(( (EPOCHSECONDS - _chrono_preexec_timestamp) * 1000 ))
  fi
  _chrono_preexec_timestamp=0

  "$CHRONO_BIN" add "$cmd" "$duration" "$exit_code" </dev/null >/dev/null 2>&1
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec chrono_preexec
add-zsh-hook precmd chrono_precmd

# ── Up/Down Arrow ─────────────────────────────────────────

_chrono_up_prefix=""
_chrono_up_offset=0
_chrono_up_original=""

chrono-up() {
  if (( _chrono_up_offset == 0 )); then
    _chrono_up_prefix="$BUFFER"
    _chrono_up_original="$BUFFER"
  fi

  local result
  result=$("$CHRONO_BIN" up "$_chrono_up_prefix" "$_chrono_up_offset" 2>/dev/null)
  local ret=$?

  if [[ $ret -eq 0 && -n "$result" ]]; then
    BUFFER="$result"
    CURSOR=${#BUFFER}
    (( _chrono_up_offset++ ))
  else
    zle up-line-or-history
  fi
}

chrono-down() {
  if (( _chrono_up_offset > 0 )); then
    (( _chrono_up_offset-- ))
  fi

  if (( _chrono_up_offset == 0 )); then
    BUFFER="$_chrono_up_original"
    CURSOR=${#BUFFER}
    return
  fi

  local actual_offset=$(( _chrono_up_offset - 1 ))
  local result
  result=$("$CHRONO_BIN" up "$_chrono_up_prefix" "$actual_offset" 2>/dev/null)
  local ret=$?

  if [[ $ret -eq 0 && -n "$result" ]]; then
    BUFFER="$result"
    CURSOR=${#BUFFER}
  else
    zle down-line-or-history
  fi
}

# ── Ctrl+R ────────────────────────────────────────────────

chrono-search() {
  local result
  result=$("$CHRONO_BIN" search 2>/dev/null)

  if [[ $? -eq 0 && -n "$result" ]]; then
    BUFFER="$result"
    CURSOR=${#BUFFER}
  fi

  zle reset-prompt
}

# ── Widget and Key Binding Setup ──────────────────────────
# Register widgets once at source time
zle -N chrono-up
zle -N chrono-down
zle -N chrono-search

# Apply bindings via precmd to run AFTER all other plugins (oh-my-zsh,
# zsh-autosuggestions) have finished. Re-applied every prompt to survive
# re-wrapping by zsh-autosuggestions (which also re-binds on every precmd).
_chrono_apply_bindings() {
  _chrono_up_prefix=""
  _chrono_up_offset=0
  _chrono_up_original=""

  bindkey -M emacs '^[[A' chrono-search
  bindkey -M emacs '^[OA' chrono-search
  bindkey -M emacs '^[[B' chrono-down
  bindkey -M emacs '^[OB' chrono-down
  bindkey -M emacs '^R' chrono-search

  bindkey -M viins '^[[A' chrono-search
  bindkey -M viins '^[OA' chrono-search
  bindkey -M viins '^[[B' chrono-down
  bindkey -M viins '^[OB' chrono-down
  bindkey -M viins '^R' chrono-search

  bindkey -M vicmd '^[[A' chrono-search
  bindkey -M vicmd '^[OA' chrono-search
  bindkey -M vicmd '^[[B' chrono-down
  bindkey -M vicmd '^[OB' chrono-down
}

add-zsh-hook precmd _chrono_apply_bindings
