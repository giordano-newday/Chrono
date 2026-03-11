# chrono

> A minimal, SQLite-backed shell history manager for zsh — smarter `↑` and fuzzy `Ctrl+R`, nothing more.

-----

## Overview

**chrono** replaces zsh’s default history with a SQLite database and two improved navigation primitives: a smart `↑` arrow that surfaces context-aware results, and a `Ctrl+R` fuzzy search powered by fzf. It is built with TypeScript and compiled to a single native binary via Bun.

-----

## Goals

- Replace the default zsh history file with a structured, queryable SQLite store
- Make `↑` arrow smarter: filter by prefix, prioritise current directory
- Make `Ctrl+R` a full fuzzy search experience via fzf
- Stay simple — no sync, no cloud, no daemon, no dependencies beyond Bun and fzf

-----

## Non-Goals

- Cross-machine sync
- A TUI or web UI
- Support for shells other than zsh
- Encryption or remote storage

-----

## Architecture

```
~/.chrono/
 history.db          # SQLite database
 bin/chrono          # compiled Bun binary
 chrono.zsh          # zsh plugin (sourced from .zshrc)

~/<repo>/
 src/
   index.ts          # CLI entry point
   db.ts             # SQLite read/write operations
   search.ts         # fzf integration + up-arrow logic
 install.sh          # one-shot install script
 package.json
 tsconfig.json
```

The binary is the single source of truth for all history operations. The zsh plugin is a thin layer of hooks and key bindings that delegate to it.

-----

## Database Schema

```sql
CREATE TABLE history (
 id        INTEGER PRIMARY KEY AUTOINCREMENT,
 command   TEXT    NOT NULL,
 cwd       TEXT    NOT NULL DEFAULT '',
 hostname  TEXT    NOT NULL DEFAULT '',
 timestamp INTEGER NOT NULL,          -- Unix seconds
 duration  INTEGER,                   -- Milliseconds
 exit_code INTEGER,
 session   TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX idx_history_command   ON history(command);
CREATE INDEX idx_history_cwd       ON history(cwd);
CREATE INDEX idx_history_timestamp ON history(timestamp);
CREATE INDEX idx_history_session   ON history(session);
```

WAL mode is enabled for safe concurrent writes from background recording.

-----

## CLI Interface

### `chrono add "<command>" [duration_ms] [exit_code]`

Records a command. Called by the `preexec`/`precmd` zsh hooks.

- Skips empty commands and noise patterns (`ls`, `cd`, `clear`, `exit`, etc.)
- Deduplicates consecutive identical commands within the same session
- Runs in the background (`&!`) so it does not block the prompt

### `chrono up "<prefix>" <offset>`

Returns the Nth most recent command matching the given prefix (0-indexed).

- If prefix is empty, sorts current-directory entries first, then falls back to global
- If prefix is non-empty, filters to commands starting with that string
- Exits with code `0` and writes the command to stdout; exits `1` if no match

### `chrono search [global|directory|session]`

Opens an interactive fzf search. Writes the selected command to stdout.

- Displays each entry with: exit status indicator, date, time, cwd, command
- Exits `0` with the selected command, or `1` if cancelled

### `chrono import`

Parses `~/.zsh_history` (both plain and extended format) and bulk-inserts into the database.

### `chrono stats`

Prints total command count and a top-10 frequency chart to stdout.

-----

## Zsh Integration

### Hooks

|Hook     |Behaviour                                                                        |
|---------|---------------------------------------------------------------------------------|
|`preexec`|Captures the command string and start time                                       |
|`precmd` |Finalises the entry with duration and exit code; calls `chrono add` in background|

### Key Bindings

|Key             |Action                                                           |
|----------------|-----------------------------------------------------------------|
|`↑` (and `^[OA`)|Smart history navigation — up through context-aware results      |
|`↓` (and `^[OB`)|Navigate back down; restore original buffer on reaching the start|
|`Ctrl+R`        |Full fzf fuzzy search                                            |

### Up Arrow Behaviour

1. On first press, the current buffer contents are captured as the **prefix**
1. Each subsequent press increments an offset counter and fetches the next match
1. If the buffer is empty, results are sorted so current-directory commands come first
1. Pressing `↓` decrements the counter; reaching zero restores the original buffer
1. The counter resets on `zle-line-init` (i.e. any new prompt)

-----

## Session Tracking

Each terminal instance generates a UUID on shell startup, stored in `$CHRONO_SESSION`. This allows filtering history to the current session and prevents duplicate suppression from affecting unrelated terminals.

-----

## Ignored Commands

Commands matching the following pattern are never recorded:

```
/^(ls|ll|la|pwd|cd|clear|exit|history|\s+)$/
```

This list is hardcoded in v1 and configurable in future versions.

-----

## Dependencies

|Tool                                  |Purpose                             |Install                                   |
|--------------------------------------|------------------------------------|------------------------------------------|
|[Bun](https://bun.sh)                 |TypeScript runtime + binary compiler|`curl -fsSL https://bun.sh/install | bash`|
|[fzf](https://github.com/junegunn/fzf)|Fuzzy search UI                     |`brew install fzf`                        |

-----

## Install

```bash
git clone <repo> ~/chrono-src
cd ~/chrono-src
chmod +x install.sh
./install.sh
source ~/.zshrc
```

The install script will:

1. Build the binary with `bun build --compile`
1. Copy binary and zsh plugin to `~/.chrono/`
1. Offer to import `~/.zsh_history`
1. Append `source "$HOME/.chrono/chrono.zsh"` to `~/.zshrc` (if not already present)

-----

## Future Ideas

These are explicitly out of scope for v1 but worth considering:

- **Configurable ignore list** via `~/.chrono/config.toml`
- **Filter mode cycling** in fzf (`Ctrl+R` toggles global → directory → session)
- **Exit code colouring** in fzf preview (green ✓ / red ✗)
- **Per-project tagging** based on git repo name
- **rsync-based sync** for single-user multi-machine setups
- **`chrono clean`** command to prune old or failed entries