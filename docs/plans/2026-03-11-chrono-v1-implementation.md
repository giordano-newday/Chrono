# Chrono v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a SQLite-backed zsh history manager that replaces default history with smart ↑ arrow and fzf-powered Ctrl+R.

**Architecture:** A single Bun-compiled TypeScript binary handles all history operations (add, query, search, import, stats). A thin zsh plugin provides hooks (preexec/precmd) and keybindings (↑/↓/Ctrl+R) that delegate to the binary. Data lives in `~/.chrono/history.db` using WAL mode.

**Tech Stack:** TypeScript, Bun (runtime + compiler + SQLite via `bun:sqlite` + test runner via `bun:test`), fzf (fuzzy search UI), zsh

---

## Task 0: Install Dependencies & Scaffold Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`

**Step 1: Install Bun and fzf**

```bash
brew install oven-sh/bun/bun
brew install fzf
```

Verify:
```bash
bun --version   # expect 1.x
fzf --version   # expect 0.x
```

**Step 2: Create package.json**

```json
{
  "name": "chrono",
  "version": "1.0.0",
  "description": "SQLite-backed shell history manager for zsh",
  "type": "module",
  "scripts": {
    "build": "bun build src/index.ts --compile --outfile chrono",
    "test": "bun test",
    "dev": "bun run src/index.ts"
  },
  "devDependencies": {}
}
```

**Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun-types"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": ".",
    "lib": ["ESNext"]
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

**Step 4: Initialize and install**

```bash
bun install
bun add -d bun-types
```

**Step 5: Create directory structure**

```bash
mkdir -p src tests
```

**Step 6: Commit**

```bash
git add package.json tsconfig.json bun.lock
git commit -m "chore: scaffold project with Bun toolchain"
```

---

## Task 1: Constants Module

**Files:**
- Create: `src/constants.ts`

**Step 1: Create constants.ts**

```typescript
import { homedir } from "node:os";
import { join } from "node:path";

export const CHRONO_DIR = join(homedir(), ".chrono");
export const DB_PATH = join(CHRONO_DIR, "history.db");
export const BIN_DIR = join(CHRONO_DIR, "bin");
export const ZSH_PLUGIN_PATH = join(CHRONO_DIR, "chrono.zsh");

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS history (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  command   TEXT    NOT NULL,
  cwd       TEXT    NOT NULL DEFAULT '',
  hostname  TEXT    NOT NULL DEFAULT '',
  timestamp INTEGER NOT NULL,
  duration  INTEGER,
  exit_code INTEGER,
  session   TEXT    NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_history_command   ON history(command);
CREATE INDEX IF NOT EXISTS idx_history_cwd       ON history(cwd);
CREATE INDEX IF NOT EXISTS idx_history_timestamp ON history(timestamp);
CREATE INDEX IF NOT EXISTS idx_history_session   ON history(session);
`;
```

**Step 2: Commit**

```bash
git add src/constants.ts
git commit -m "feat: add constants module with paths and schema"
```

---

## Task 2: Ignore Module (TDD)

**Files:**
- Create: `tests/ignore.test.ts`
- Create: `src/ignore.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, expect, test } from "bun:test";
import { shouldIgnore } from "../src/ignore";

describe("shouldIgnore", () => {
  test("ignores 'ls'", () => {
    expect(shouldIgnore("ls")).toBe(true);
  });

  test("ignores 'll'", () => {
    expect(shouldIgnore("ll")).toBe(true);
  });

  test("ignores 'la'", () => {
    expect(shouldIgnore("la")).toBe(true);
  });

  test("ignores 'pwd'", () => {
    expect(shouldIgnore("pwd")).toBe(true);
  });

  test("ignores 'cd'", () => {
    expect(shouldIgnore("cd")).toBe(true);
  });

  test("ignores 'clear'", () => {
    expect(shouldIgnore("clear")).toBe(true);
  });

  test("ignores 'exit'", () => {
    expect(shouldIgnore("exit")).toBe(true);
  });

  test("ignores 'history'", () => {
    expect(shouldIgnore("history")).toBe(true);
  });

  test("ignores whitespace-only commands", () => {
    expect(shouldIgnore("   ")).toBe(true);
    expect(shouldIgnore("  ")).toBe(true);
  });

  test("ignores empty string", () => {
    expect(shouldIgnore("")).toBe(true);
  });

  test("does NOT ignore 'ls -la'", () => {
    expect(shouldIgnore("ls -la")).toBe(false);
  });

  test("does NOT ignore 'cd ~/projects'", () => {
    expect(shouldIgnore("cd ~/projects")).toBe(false);
  });

  test("does NOT ignore 'git commit -m fix'", () => {
    expect(shouldIgnore("git commit -m fix")).toBe(false);
  });

  test("does NOT ignore 'npm run build'", () => {
    expect(shouldIgnore("npm run build")).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test tests/ignore.test.ts
```

Expected: FAIL — `Cannot find module "../src/ignore"`

**Step 3: Write minimal implementation**

```typescript
const IGNORED_PATTERN = /^(ls|ll|la|pwd|cd|clear|exit|history|\s*)$/;

export function shouldIgnore(command: string): boolean {
  return IGNORED_PATTERN.test(command.trim()) || command.trim() === "";
}
```

**Step 4: Run tests to verify they pass**

```bash
bun test tests/ignore.test.ts
```

Expected: All 14 tests PASS

**Step 5: Commit**

```bash
git add src/ignore.ts tests/ignore.test.ts
git commit -m "feat: add ignore module with TDD tests"
```

---

## Task 3: Database Module (TDD)

**Files:**
- Create: `tests/db.test.ts`
- Create: `src/db.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { openDb, addCommand, queryUp, querySearch, importHistory, getStats } from "../src/db";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let db: Database;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "chrono-test-"));
  db = openDb(join(tempDir, "test.db"));
});

afterEach(() => {
  db.close();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("openDb", () => {
  test("creates the history table", () => {
    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type='table' AND name='history'")
      .all();
    expect(tables).toHaveLength(1);
  });

  test("enables WAL mode", () => {
    const result = db.query("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(result.journal_mode).toBe("wal");
  });

  test("creates all indexes", () => {
    const indexes = db
      .query("SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_history_%'")
      .all() as { name: string }[];
    const names = indexes.map((i) => i.name).sort();
    expect(names).toEqual([
      "idx_history_command",
      "idx_history_cwd",
      "idx_history_session",
      "idx_history_timestamp",
    ]);
  });
});

describe("addCommand", () => {
  test("inserts a command", () => {
    addCommand(db, {
      command: "git status",
      cwd: "/home/user/project",
      hostname: "mac",
      timestamp: 1700000000,
      duration: 120,
      exitCode: 0,
      session: "abc-123",
    });

    const rows = db.query("SELECT * FROM history").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].command).toBe("git status");
    expect(rows[0].cwd).toBe("/home/user/project");
    expect(rows[0].exit_code).toBe(0);
  });

  test("deduplicates consecutive identical commands in the same session", () => {
    const params = {
      command: "git status",
      cwd: "/home/user/project",
      hostname: "mac",
      timestamp: 1700000000,
      duration: 100,
      exitCode: 0,
      session: "abc-123",
    };

    addCommand(db, params);
    addCommand(db, { ...params, timestamp: 1700000001 });

    const rows = db.query("SELECT * FROM history").all();
    expect(rows).toHaveLength(1);
  });

  test("allows same command in different sessions", () => {
    const base = {
      command: "git status",
      cwd: "/home/user/project",
      hostname: "mac",
      timestamp: 1700000000,
      duration: 100,
      exitCode: 0,
    };

    addCommand(db, { ...base, session: "session-1" });
    addCommand(db, { ...base, session: "session-2" });

    const rows = db.query("SELECT * FROM history").all();
    expect(rows).toHaveLength(2);
  });

  test("allows different commands consecutively in same session", () => {
    const base = {
      cwd: "/home/user",
      hostname: "mac",
      timestamp: 1700000000,
      duration: 100,
      exitCode: 0,
      session: "abc-123",
    };

    addCommand(db, { ...base, command: "git status" });
    addCommand(db, { ...base, command: "git diff", timestamp: 1700000001 });

    const rows = db.query("SELECT * FROM history").all();
    expect(rows).toHaveLength(2);
  });
});

describe("queryUp", () => {
  beforeEach(() => {
    const base = { hostname: "mac", duration: 100, exitCode: 0, session: "s1" };
    addCommand(db, { ...base, command: "git status", cwd: "/project", timestamp: 1000 });
    addCommand(db, { ...base, command: "git diff", cwd: "/project", timestamp: 1001 });
    addCommand(db, { ...base, command: "git log", cwd: "/other", timestamp: 1002 });
    addCommand(db, { ...base, command: "npm install", cwd: "/project", timestamp: 1003 });
    addCommand(db, { ...base, command: "npm test", cwd: "/other", timestamp: 1004 });
  });

  test("returns most recent command with empty prefix (current dir first)", () => {
    const result = queryUp(db, { prefix: "", cwd: "/project", offset: 0 });
    expect(result).toBe("npm install");
  });

  test("returns second result with offset 1 (current dir first)", () => {
    const result = queryUp(db, { prefix: "", cwd: "/project", offset: 1 });
    expect(result).toBe("git diff");
  });

  test("falls back to other dirs after current dir is exhausted", () => {
    const result = queryUp(db, { prefix: "", cwd: "/project", offset: 3 });
    expect(result).toBe("npm test");
  });

  test("filters by prefix", () => {
    const result = queryUp(db, { prefix: "git", cwd: "/project", offset: 0 });
    expect(result).toBe("git log");
  });

  test("prefix second result", () => {
    const result = queryUp(db, { prefix: "git", cwd: "/project", offset: 1 });
    expect(result).toBe("git diff");
  });

  test("returns null when offset exceeds matches", () => {
    const result = queryUp(db, { prefix: "npm", cwd: "/project", offset: 10 });
    expect(result).toBeNull();
  });
});

describe("querySearch", () => {
  beforeEach(() => {
    const base = { hostname: "mac", duration: 100, session: "s1" };
    addCommand(db, { ...base, command: "git status", cwd: "/project", timestamp: 1700000000, exitCode: 0 });
    addCommand(db, { ...base, command: "npm test", cwd: "/other", timestamp: 1700000001, exitCode: 1 });
  });

  test("returns all entries for global scope", () => {
    const rows = querySearch(db, { scope: "global" });
    expect(rows).toHaveLength(2);
  });

  test("filters by cwd for directory scope", () => {
    const rows = querySearch(db, { scope: "directory", cwd: "/project" });
    expect(rows).toHaveLength(1);
    expect(rows[0].command).toBe("git status");
  });

  test("filters by session for session scope", () => {
    const base = { hostname: "mac", duration: 100, exitCode: 0 };
    addCommand(db, { ...base, command: "other cmd", cwd: "/x", timestamp: 1700000002, session: "s2" });

    const rows = querySearch(db, { scope: "session", session: "s1" });
    expect(rows).toHaveLength(2);
  });

  test("each row has required display fields", () => {
    const rows = querySearch(db, { scope: "global" });
    const row = rows[0];
    expect(row).toHaveProperty("command");
    expect(row).toHaveProperty("cwd");
    expect(row).toHaveProperty("timestamp");
    expect(row).toHaveProperty("exit_code");
  });
});

describe("importHistory", () => {
  test("imports plain format lines", () => {
    const file = join(tempDir, "plain_history");
    writeFileSync(file, "git status\nnpm test\nbun build\n");

    const count = importHistory(db, file);
    expect(count).toBe(3);

    const rows = db.query("SELECT * FROM history").all();
    expect(rows).toHaveLength(3);
  });

  test("imports extended format lines", () => {
    const file = join(tempDir, "extended_history");
    writeFileSync(
      file,
      ": 1700000000:0;git status\n: 1700000001:120;npm test\n"
    );

    const count = importHistory(db, file);
    expect(count).toBe(2);

    const rows = db.query("SELECT * FROM history ORDER BY timestamp") .all() as any[];
    expect(rows[0].command).toBe("git status");
    expect(rows[0].timestamp).toBe(1700000000);
    expect(rows[1].command).toBe("npm test");
  });

  test("skips empty lines", () => {
    const file = join(tempDir, "sparse_history");
    writeFileSync(file, "git status\n\n\nnpm test\n");

    const count = importHistory(db, file);
    expect(count).toBe(2);
  });

  test("returns 0 for non-existent file", () => {
    const count = importHistory(db, join(tempDir, "nope"));
    expect(count).toBe(0);
  });
});

describe("getStats", () => {
  test("returns total count and top commands", () => {
    const base = { cwd: "/x", hostname: "mac", duration: 100, exitCode: 0, session: "s1" };
    addCommand(db, { ...base, command: "git status", timestamp: 1000 });
    addCommand(db, { ...base, command: "git diff", timestamp: 1001 });
    addCommand(db, { ...base, command: "git status", timestamp: 1002 });

    // Need to allow the second "git status" — different timestamp breaks dedup
    // Actually dedup only checks the MOST RECENT in the session.
    // status(1000), diff(1001) — most recent is diff, so status(1002) is allowed.
    const stats = getStats(db);
    expect(stats.total).toBe(3);
    expect(stats.top[0].command).toBe("git status");
    expect(stats.top[0].count).toBe(2);
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test tests/db.test.ts
```

Expected: FAIL — `Cannot find module "../src/db"`

**Step 3: Write the implementation**

```typescript
import { Database } from "bun:sqlite";
import { SCHEMA_SQL } from "./constants";
import { existsSync, readFileSync } from "node:fs";

export interface CommandEntry {
  command: string;
  cwd: string;
  hostname: string;
  timestamp: number;
  duration?: number;
  exitCode?: number;
  session: string;
}

export interface SearchRow {
  id: number;
  command: string;
  cwd: string;
  timestamp: number;
  exit_code: number | null;
}

export interface Stats {
  total: number;
  top: { command: string; count: number }[];
}

export function openDb(path: string): Database {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA_SQL);
  return db;
}

export function addCommand(db: Database, entry: CommandEntry): void {
  const last = db
    .query("SELECT command FROM history WHERE session = ? ORDER BY id DESC LIMIT 1")
    .get(entry.session) as { command: string } | null;

  if (last && last.command === entry.command) {
    return;
  }

  db.query(
    `INSERT INTO history (command, cwd, hostname, timestamp, duration, exit_code, session)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.command,
    entry.cwd,
    entry.hostname,
    entry.timestamp,
    entry.duration ?? null,
    entry.exitCode ?? null,
    entry.session,
  );
}

export function queryUp(
  db: Database,
  params: { prefix: string; cwd: string; offset: number }
): string | null {
  const { prefix, cwd, offset } = params;

  let sql: string;
  let bindings: any[];

  if (prefix) {
    sql = `SELECT command FROM history
           WHERE command LIKE ? || '%'
           ORDER BY timestamp DESC
           LIMIT 1 OFFSET ?`;
    bindings = [prefix, offset];
  } else {
    sql = `SELECT command FROM history
           ORDER BY (cwd = ?) DESC, timestamp DESC
           LIMIT 1 OFFSET ?`;
    bindings = [cwd, offset];
  }

  const row = db.query(sql).get(...bindings) as { command: string } | null;
  return row?.command ?? null;
}

export function querySearch(
  db: Database,
  params: { scope?: string; cwd?: string; session?: string }
): SearchRow[] {
  const { scope = "global", cwd, session } = params;

  let where = "";
  const bindings: any[] = [];

  if (scope === "directory" && cwd) {
    where = "WHERE cwd = ?";
    bindings.push(cwd);
  } else if (scope === "session" && session) {
    where = "WHERE session = ?";
    bindings.push(session);
  }

  return db
    .query(
      `SELECT id, command, cwd, timestamp, exit_code
       FROM history ${where}
       ORDER BY timestamp DESC`
    )
    .all(...bindings) as SearchRow[];
}

export function importHistory(db: Database, filePath: string): number {
  if (!existsSync(filePath)) return 0;

  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim() !== "");

  const extendedPattern = /^:\s*(\d+):(\d+);(.+)$/;
  const hostname = process.env.HOST ?? process.env.HOSTNAME ?? "";
  let count = 0;

  const insert = db.query(
    `INSERT INTO history (command, cwd, hostname, timestamp, duration, exit_code, session)
     VALUES (?, '', ?, ?, ?, NULL, 'import')`
  );

  db.exec("BEGIN TRANSACTION");
  try {
    for (const line of lines) {
      const match = line.match(extendedPattern);
      if (match) {
        const timestamp = parseInt(match[1], 10);
        const duration = parseInt(match[2], 10) * 1000;
        const command = match[3];
        insert.run(command, hostname, timestamp, duration);
      } else {
        insert.run(line, hostname, Math.floor(Date.now() / 1000), null);
      }
      count++;
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }

  return count;
}

export function getStats(db: Database): Stats {
  const totalRow = db.query("SELECT COUNT(*) as total FROM history").get() as { total: number };

  const top = db
    .query(
      `SELECT command, COUNT(*) as count
       FROM history
       GROUP BY command
       ORDER BY count DESC
       LIMIT 10`
    )
    .all() as { command: string; count: number }[];

  return { total: totalRow.total, top };
}
```

**Step 4: Run tests to verify they pass**

```bash
bun test tests/db.test.ts
```

Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/db.ts tests/db.test.ts
git commit -m "feat: add database module with TDD tests"
```

---

## Task 4: Search Module (TDD)

**Files:**
- Create: `tests/search.test.ts`
- Create: `src/search.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, expect, test } from "bun:test";
import { formatSearchRow, parseSelectedLine } from "../src/search";
import type { SearchRow } from "../src/db";

describe("formatSearchRow", () => {
  test("formats a successful command", () => {
    const row: SearchRow = {
      id: 1,
      command: "git status",
      cwd: "/project",
      timestamp: 1700000000,
      exit_code: 0,
    };
    const line = formatSearchRow(row);
    expect(line).toContain("✓");
    expect(line).toContain("git status");
    expect(line).toContain("/project");
  });

  test("formats a failed command", () => {
    const row: SearchRow = {
      id: 2,
      command: "npm test",
      cwd: "/other",
      timestamp: 1700000001,
      exit_code: 1,
    };
    const line = formatSearchRow(row);
    expect(line).toContain("✗");
    expect(line).toContain("npm test");
  });

  test("formats unknown exit code", () => {
    const row: SearchRow = {
      id: 3,
      command: "echo hello",
      cwd: "/home",
      timestamp: 1700000002,
      exit_code: null,
    };
    const line = formatSearchRow(row);
    expect(line).toContain("?");
    expect(line).toContain("echo hello");
  });
});

describe("parseSelectedLine", () => {
  test("extracts command from formatted line", () => {
    const line = "  ✓  2023-11-14  22:13  /project  │ git status";
    const command = parseSelectedLine(line);
    expect(command).toBe("git status");
  });

  test("handles commands with pipes", () => {
    const line = "  ✓  2023-11-14  22:13  /project  │ cat file | grep foo";
    const command = parseSelectedLine(line);
    expect(command).toBe("cat file | grep foo");
  });

  test("returns empty string for empty input", () => {
    expect(parseSelectedLine("")).toBe("");
  });
});
```

**Step 2: Run tests to verify they fail**

```bash
bun test tests/search.test.ts
```

Expected: FAIL — `Cannot find module "../src/search"`

**Step 3: Write the implementation**

```typescript
import type { Database } from "bun:sqlite";
import type { SearchRow } from "./db";
import { querySearch } from "./db";

export function formatSearchRow(row: SearchRow): string {
  const exitIndicator =
    row.exit_code === null ? "?" : row.exit_code === 0 ? "✓" : "✗";

  const date = new Date(row.timestamp * 1000);
  const dateStr = date.toISOString().slice(0, 10);
  const timeStr = date.toTimeString().slice(0, 5);

  return `  ${exitIndicator}  ${dateStr}  ${timeStr}  ${row.cwd}  │ ${row.command}`;
}

export function parseSelectedLine(line: string): string {
  if (!line) return "";
  const delimiterIndex = line.indexOf("│");
  if (delimiterIndex === -1) return line.trim();
  return line.slice(delimiterIndex + 1).trim();
}

export async function runFzfSearch(
  db: Database,
  scope: string = "global",
  cwd?: string,
  session?: string,
): Promise<string | null> {
  const rows = querySearch(db, { scope, cwd, session });
  if (rows.length === 0) return null;

  const input = rows.map(formatSearchRow).join("\n");

  const proc = Bun.spawn(["fzf", "--ansi", "--no-sort", "--tac"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });

  proc.stdin.write(input);
  proc.stdin.end();

  const output = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) return null;

  return parseSelectedLine(output.trim());
}
```

**Step 4: Run tests to verify they pass**

```bash
bun test tests/search.test.ts
```

Expected: All 6 tests PASS

**Step 5: Commit**

```bash
git add src/search.ts tests/search.test.ts
git commit -m "feat: add search module with fzf integration and TDD tests"
```

---

## Task 5: CLI Entry Point

**Files:**
- Create: `src/index.ts`

**Step 1: Write the CLI dispatcher**

```typescript
import { mkdirSync, existsSync } from "node:fs";
import { CHRONO_DIR, DB_PATH } from "./constants";
import { openDb, addCommand, queryUp, importHistory, getStats } from "./db";
import { runFzfSearch } from "./search";
import { shouldIgnore } from "./ignore";

function ensureChronoDir(): void {
  if (!existsSync(CHRONO_DIR)) {
    mkdirSync(CHRONO_DIR, { recursive: true });
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const subcommand = args[0];

  if (!subcommand) {
    console.log("Usage: chrono <add|up|search|import|stats>");
    process.exit(1);
  }

  ensureChronoDir();
  const db = openDb(DB_PATH);

  try {
    switch (subcommand) {
      case "add": {
        const command = args[1];
        if (!command || shouldIgnore(command)) {
          process.exit(0);
        }
        addCommand(db, {
          command,
          cwd: process.env.PWD ?? process.cwd(),
          hostname: process.env.HOST ?? process.env.HOSTNAME ?? "",
          timestamp: Math.floor(Date.now() / 1000),
          duration: args[2] ? parseInt(args[2], 10) : undefined,
          exitCode: args[3] ? parseInt(args[3], 10) : undefined,
          session: process.env.CHRONO_SESSION ?? "",
        });
        break;
      }

      case "up": {
        const prefix = args[1] ?? "";
        const offset = parseInt(args[2] ?? "0", 10);
        const result = queryUp(db, {
          prefix,
          cwd: process.env.PWD ?? process.cwd(),
          offset,
        });
        if (result) {
          process.stdout.write(result);
        } else {
          process.exit(1);
        }
        break;
      }

      case "search": {
        const scope = args[1] ?? "global";
        const result = await runFzfSearch(
          db,
          scope,
          process.env.PWD ?? process.cwd(),
          process.env.CHRONO_SESSION,
        );
        if (result) {
          process.stdout.write(result);
        } else {
          process.exit(1);
        }
        break;
      }

      case "import": {
        const filePath = args[1] ?? `${process.env.HOME}/.zsh_history`;
        const count = importHistory(db, filePath);
        console.log(`Imported ${count} commands from ${filePath}`);
        break;
      }

      case "stats": {
        const stats = getStats(db);
        console.log(`Total commands: ${stats.total}\n`);
        console.log("Top 10:");
        const maxCount = stats.top[0]?.count ?? 0;
        const barWidth = 30;
        for (const { command, count } of stats.top) {
          const bar = "█".repeat(Math.round((count / maxCount) * barWidth));
          console.log(`  ${bar} ${count.toString().padStart(5)}  ${command}`);
        }
        break;
      }

      default:
        console.error(`Unknown subcommand: ${subcommand}`);
        process.exit(1);
    }
  } finally {
    db.close();
  }
}

main();
```

**Step 2: Smoke-test manually**

```bash
bun run src/index.ts
# Expected: "Usage: chrono <add|up|search|import|stats>"

bun run src/index.ts add "echo hello"
bun run src/index.ts stats
# Expected: "Total commands: 1" and top-10 chart
```

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add CLI entry point with all subcommands"
```

---

## Task 6: Zsh Plugin

**Files:**
- Create: `chrono.zsh`

**Step 1: Write the zsh plugin**

```zsh
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
```

**Step 2: Commit**

```bash
git add chrono.zsh
git commit -m "feat: add zsh plugin with hooks and keybindings"
```

---

## Task 7: Install Script

**Files:**
- Create: `install.sh`

**Step 1: Write install.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

CHRONO_DIR="$HOME/.chrono"
BIN_DIR="$CHRONO_DIR/bin"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🕐 chrono installer"
echo ""

# ── Check dependencies ────────────────────────────────────
if ! command -v bun &>/dev/null; then
  echo "❌ Bun is required but not installed."
  echo "   Install: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

if ! command -v fzf &>/dev/null; then
  echo "⚠️  fzf is not installed. 'chrono search' (Ctrl+R) will not work."
  echo "   Install: brew install fzf"
  echo ""
fi

# ── Build ─────────────────────────────────────────────────
echo "📦 Installing dependencies..."
cd "$SCRIPT_DIR"
bun install --frozen-lockfile 2>/dev/null || bun install

echo "🔨 Building chrono binary..."
bun build src/index.ts --compile --outfile chrono

# ── Install ───────────────────────────────────────────────
echo "📂 Installing to $CHRONO_DIR..."
mkdir -p "$BIN_DIR"
cp chrono "$BIN_DIR/chrono"
chmod +x "$BIN_DIR/chrono"
cp chrono.zsh "$CHRONO_DIR/chrono.zsh"

# ── Import history ────────────────────────────────────────
if [[ -f "$HOME/.zsh_history" ]]; then
  echo "📜 Importing existing zsh history..."
  "$BIN_DIR/chrono" import "$HOME/.zsh_history"
fi

# ── Hook into .zshrc ──────────────────────────────────────
ZSHRC="$HOME/.zshrc"
SOURCE_LINE='source "$HOME/.chrono/chrono.zsh"'

if ! grep -qF "$SOURCE_LINE" "$ZSHRC" 2>/dev/null; then
  echo "" >> "$ZSHRC"
  echo "# chrono — smart shell history" >> "$ZSHRC"
  echo "$SOURCE_LINE" >> "$ZSHRC"
  echo "✅ Added chrono to $ZSHRC"
else
  echo "✅ chrono already in $ZSHRC"
fi

echo ""
echo "🎉 Done! Run 'source ~/.zshrc' or open a new terminal."

# ── Clean up build artifact ───────────────────────────────
rm -f "$SCRIPT_DIR/chrono"
```

**Step 2: Make executable and commit**

```bash
chmod +x install.sh
git add install.sh
git commit -m "feat: add install script"
```

---

## Task 8: Run All Tests & Final Build Verification

**Step 1: Run the full test suite**

```bash
bun test
```

Expected: All tests pass across `db.test.ts`, `search.test.ts`, `ignore.test.ts`.

**Step 2: Build the binary**

```bash
bun build src/index.ts --compile --outfile chrono
```

Expected: Produces a `chrono` binary.

**Step 3: Smoke-test the binary**

```bash
./chrono add "echo hello from chrono"
./chrono stats
./chrono up "" 0
```

Expected: `stats` shows 1 command, `up` returns "echo hello from chrono".

**Step 4: Clean up and final commit**

```bash
rm -f chrono
echo "chrono" >> .gitignore
echo "node_modules" >> .gitignore
git add .gitignore
git commit -m "chore: add .gitignore and verify full build"
```

---

## Task Summary

| # | Task | Key Deliverable |
|---|---|---|
| 0 | Scaffold project | `package.json`, `tsconfig.json`, Bun installed |
| 1 | Constants module | `src/constants.ts` |
| 2 | Ignore module (TDD) | `src/ignore.ts` + tests |
| 3 | Database module (TDD) | `src/db.ts` + tests |
| 4 | Search module (TDD) | `src/search.ts` + tests |
| 5 | CLI entry point | `src/index.ts` |
| 6 | Zsh plugin | `chrono.zsh` |
| 7 | Install script | `install.sh` |
| 8 | Final verification | All tests pass, binary builds |
