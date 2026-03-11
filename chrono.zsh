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

  "$CHRONO_BIN" add "$cmd" "$duration" "$exit_code" &!
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

  if [[ $? -eq 0 && -n "$result" ]]; then
    BUFFER="$result"
    CURSOR=${#BUFFER}
    (( _chrono_up_offset++ ))
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

  if [[ $? -eq 0 && -n "$result" ]]; then
    BUFFER="$result"
    CURSOR=${#BUFFER}
  fi
}

chrono-reset() {
  _chrono_up_prefix=""
  _chrono_up_offset=0
  _chrono_up_original=""
}

zle -N chrono-up
zle -N chrono-down
zle -N zle-line-init chrono-reset

bindkey '^[[A' chrono-up      # Up arrow
bindkey '^[OA' chrono-up      # Up arrow (alternate)
bindkey '^[[B' chrono-down    # Down arrow
bindkey '^[OB' chrono-down    # Down arrow (alternate)

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

zle -N chrono-search
bindkey '^R' chrono-search
