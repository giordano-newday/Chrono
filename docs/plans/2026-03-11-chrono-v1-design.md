# Chrono v1 — Design Document

> Minimal, SQLite-backed shell history manager for zsh.

## Decisions

| Decision | Choice |
|---|---|
| Runtime & compiler | Bun (`bun build --compile`) |
| SQLite driver | `bun:sqlite` (built-in) |
| Fuzzy search | fzf via stdin pipe (no preview pane) |
| Testing | Unit tests with `bun:test` for db, search, ignore |
| History import | Auto-import `~/.zsh_history` during install |
| Config | None for v1 — hardcoded defaults |

## Project Structure

```
chrono/
  src/
    index.ts          # CLI entry: parses argv, dispatches subcommands
    db.ts             # SQLite wrapper: open, migrate, add, query, import
    search.ts         # fzf spawning + up-arrow query logic
    ignore.ts         # command ignore-list matching
    constants.ts      # paths, schema SQL, defaults
  tests/
    db.test.ts
    search.test.ts
    ignore.test.ts
  install.sh
  chrono.zsh
  package.json
  tsconfig.json
```

## Database Layer (db.ts)

- **openDb()** — Opens `~/.chrono/history.db`, enables WAL mode, runs schema migration.
- **addCommand()** — Inserts a row. Skips if most recent entry in same session is identical.
- **queryUp(prefix, cwd, offset)** — If prefix non-empty: `WHERE command LIKE ?%`. If empty: sort current-dir first, then global. `LIMIT 1 OFFSET ?`.
- **querySearch(scope, cwd, session)** — Returns formatted rows. Scope filters: global (none), directory (`WHERE cwd = ?`), session (`WHERE session = ?`).
- **importHistory(filePath)** — Parses plain and extended zsh_history formats. Bulk-inserts in a transaction.
- **getStats()** — Total count + top-10 frequency.

### Schema

```sql
CREATE TABLE history (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  command   TEXT    NOT NULL,
  cwd       TEXT    NOT NULL DEFAULT '',
  hostname  TEXT    NOT NULL DEFAULT '',
  timestamp INTEGER NOT NULL,
  duration  INTEGER,
  exit_code INTEGER,
  session   TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX idx_history_command   ON history(command);
CREATE INDEX idx_history_cwd       ON history(cwd);
CREATE INDEX idx_history_timestamp ON history(timestamp);
CREATE INDEX idx_history_session   ON history(session);
```

## Search Layer (search.ts)

- Spawns fzf via `Bun.spawn()` with `stdin: "pipe"`.
- Streams formatted history lines to fzf stdin.
- Extracts selected command from fzf stdout (after last delimiter).
- Returns `null` on cancellation (fzf exit code non-zero).

## CLI (index.ts)

Raw `process.argv` parsing — no framework for 5 subcommands.

| Subcommand | Behaviour |
|---|---|
| `add "<cmd>" [dur] [exit]` | Reads `$PWD`, `$HOST`, `$CHRONO_SESSION` from env. Calls `addCommand()`. |
| `up "<prefix>" <offset>` | Calls `queryUp()`. Prints result or exits 1. |
| `search [scope]` | Calls `querySearch()` → pipes to fzf → prints selection. |
| `import` | Calls `importHistory()` on `~/.zsh_history`. |
| `stats` | Calls `getStats()`, prints formatted output. |

## Zsh Plugin (chrono.zsh)

### Session

```zsh
export CHRONO_SESSION=$(uuidgen)
```

### Hooks

- **preexec** — Saves command (`$1`) and start time (`$EPOCHSECONDS`).
- **precmd** — Computes duration, captures `$?`, calls `chrono add ... &!`.

### Key Bindings

- **↑ / ^[OA]** → `chrono-up` widget. Captures buffer as prefix on first press. Increments offset each press. Stops on exit 1.
- **↓ / ^[OB]** → `chrono-down` widget. Decrements offset. Restores original buffer at 0.
- **Ctrl+R** → `chrono-search` widget. Runs `chrono search`, sets buffer to result.
- **zle-line-init** → Resets offset and saved prefix.

## Ignored Commands

```
/^(ls|ll|la|pwd|cd|clear|exit|history|\s+)$/
```

Hardcoded in `ignore.ts` for v1.

## Install Script (install.sh)

1. Check for bun and fzf; print instructions if missing.
2. `bun install && bun build src/index.ts --compile --outfile chrono`
3. `mkdir -p ~/.chrono/bin` and copy binary + `chrono.zsh`.
4. If `~/.zsh_history` exists, run `chrono import`.
5. Append `source "$HOME/.chrono/chrono.zsh"` to `~/.zshrc` if not present.
