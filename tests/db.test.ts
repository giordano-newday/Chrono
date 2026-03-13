import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { Database } from "bun:sqlite";
import { openDb, addCommand, queryUp, querySearch, importHistory, getStats, dedup, resetHistory } from "../src/db";
import { SCHEMA_SQL } from "../src/constants";
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

  test("migrates existing whitespace-variant duplicates", () => {
    const path = join(tempDir, "legacy.db");
    const legacyDb = new Database(path, { create: true });
    legacyDb.exec(SCHEMA_SQL);
    legacyDb.query(
      "INSERT INTO history (command, cwd, hostname, timestamp, duration, exit_code, session) VALUES (?, '/x', 'mac', ?, 100, 0, 's1')"
    ).run("dup-cmd ", 1000);
    legacyDb.query(
      "INSERT INTO history (command, cwd, hostname, timestamp, duration, exit_code, session) VALUES (?, '/x', 'mac', ?, 100, 0, 's2')"
    ).run("dup-cmd", 1001);
    legacyDb.close();

    db = openDb(path);

    const rows = db.query("SELECT command, session FROM history").all() as { command: string; session: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].command).toBe("dup-cmd");
    expect(rows[0].session).toBe("s2");
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

  test("replaces older duplicate, keeps newest", () => {
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

    const rows = db.query("SELECT * FROM history").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].timestamp).toBe(1700000001);
  });

  test("replaces older duplicate across sessions", () => {
    const base = {
      command: "git status",
      cwd: "/home/user/project",
      hostname: "mac",
      timestamp: 1700000000,
      duration: 100,
      exitCode: 0,
    };

    addCommand(db, { ...base, session: "session-1" });
    addCommand(db, { ...base, session: "session-2", timestamp: 1700000001 });

    const rows = db.query("SELECT * FROM history").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].session).toBe("session-2");
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

  test("normalizes whitespace and replaces trimmed duplicates", () => {
    const base = {
      cwd: "/home/user/project",
      hostname: "mac",
      timestamp: 1700000000,
      duration: 100,
      exitCode: 0,
      session: "abc-123",
    };

    addCommand(db, { ...base, command: "git status " });
    addCommand(db, { ...base, command: "git status", timestamp: 1700000001 });

    const rows = db.query("SELECT command, timestamp FROM history").all() as { command: string; timestamp: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].command).toBe("git status");
    expect(rows[0].timestamp).toBe(1700000001);
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

  test("prefers the newest inserted command when timestamps tie", () => {
    const base = { hostname: "mac", duration: 100, exitCode: 0, session: "s1" };
    addCommand(db, { ...base, command: "chrono-alpha", cwd: "/project", timestamp: 2000 });
    addCommand(db, { ...base, command: "chrono-bravo", cwd: "/project", timestamp: 2000 });
    addCommand(db, { ...base, command: "chrono-charlie", cwd: "/project", timestamp: 2000 });

    const result = queryUp(db, { prefix: "", cwd: "/project", offset: 0 });
    expect(result).toBe("chrono-charlie");
  });

  test("prefers the newest inserted prefix match when timestamps tie", () => {
    const base = { hostname: "mac", duration: 100, exitCode: 0, session: "s1" };
    addCommand(db, { ...base, command: "git chrono-alpha", cwd: "/project", timestamp: 2001 });
    addCommand(db, { ...base, command: "git chrono-bravo", cwd: "/project", timestamp: 2001 });

    const result = queryUp(db, { prefix: "git chrono", cwd: "/project", offset: 0 });
    expect(result).toBe("git chrono-bravo");
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

  test("orders search results oldest first so newest sits at the bottom", () => {
    const base = { hostname: "mac", duration: 100, exitCode: 0, session: "s1" };
    addCommand(db, { ...base, command: "search-alpha", cwd: "/project", timestamp: 1700000100 });
    addCommand(db, { ...base, command: "search-bravo", cwd: "/project", timestamp: 1700000100 });
    addCommand(db, { ...base, command: "search-charlie", cwd: "/project", timestamp: 1700000100 });

    const rows = querySearch(db, { scope: "global" })
      .filter((row) => row.command.startsWith("search-"));

    expect(rows.map((row) => row.command)).toEqual([
      "search-alpha",
      "search-bravo",
      "search-charlie",
    ]);
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

    const rows = db.query("SELECT * FROM history ORDER BY timestamp").all() as any[];
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

  test("merges continuation lines (backslash + newline) into one command", () => {
    const file = join(tempDir, "multiline_history");
    writeFileSync(
      file,
      ": 1700000000:0;docker run \\\n  --rm \\\n  -v /data:/data \\\n  nginx\n"
    );

    const count = importHistory(db, file);
    expect(count).toBe(1);

    const rows = db.query("SELECT * FROM history").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].command).toContain("docker run");
    expect(rows[0].command).toContain("nginx");
    expect(rows[0].command).toContain("--rm");
  });

  test("merges plain-format continuation lines", () => {
    const file = join(tempDir, "plain_multiline");
    writeFileSync(file, "echo hello \\\nworld\ngit status\n");

    const count = importHistory(db, file);
    expect(count).toBe(2);

    const rows = db.query("SELECT command FROM history ORDER BY id").all() as any[];
    expect(rows[0].command).toContain("hello");
    expect(rows[0].command).toContain("world");
    expect(rows[1].command).toBe("git status");
  });

  test("handles mixed single and multiline commands", () => {
    const file = join(tempDir, "mixed_history");
    writeFileSync(
      file,
      ": 1700000000:0;git status\n: 1700000001:0;docker run \\\n  --rm \\\n  nginx\n: 1700000002:0;ls -la\n"
    );

    const count = importHistory(db, file);
    expect(count).toBe(3);

    const rows = db.query("SELECT command FROM history ORDER BY timestamp").all() as any[];
    expect(rows[0].command).toBe("git status");
    expect(rows[1].command).toContain("docker run");
    expect(rows[1].command).toContain("nginx");
    expect(rows[2].command).toBe("ls -la");
  });
});

describe("getStats", () => {
  test("returns total count and top commands", () => {
    const base = { cwd: "/x", hostname: "mac", duration: 100, exitCode: 0, session: "s1" };
    addCommand(db, { ...base, command: "git status", timestamp: 1000 });
    addCommand(db, { ...base, command: "git diff", timestamp: 1001 });
    addCommand(db, { ...base, command: "git log", timestamp: 1002 });

    const stats = getStats(db);
    expect(stats.total).toBe(3);
    expect(stats.top).toHaveLength(3);
  });
});

describe("dedup", () => {
  // Insert directly via SQL to create duplicates (addCommand now dedupes on insert)
  const insertRaw = (cmd: string, cwd: string, ts: number, session: string) => {
    db.query(
      "INSERT INTO history (command, cwd, hostname, timestamp, duration, exit_code, session) VALUES (?, ?, 'mac', ?, 100, 0, ?)"
    ).run(cmd, cwd, ts, session);
  };

  test("removes older duplicates, keeps newest", () => {
    insertRaw("git status", "/a", 1000, "s1");
    insertRaw("git diff", "/a", 1001, "s1");
    insertRaw("git status", "/b", 1002, "s2");

    const removed = dedup(db);
    expect(removed).toBe(1);

    const rows = db.query("SELECT * FROM history ORDER BY timestamp").all() as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].command).toBe("git diff");
    expect(rows[1].command).toBe("git status");
    expect(rows[1].timestamp).toBe(1002);
  });

  test("keeps the newest metadata (cwd, session) for each command", () => {
    insertRaw("npm test", "/old", 1000, "s1");
    insertRaw("npm test", "/new", 2000, "s2");

    dedup(db);

    const rows = db.query("SELECT * FROM history").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].cwd).toBe("/new");
    expect(rows[0].timestamp).toBe(2000);
  });

  test("returns 0 when no duplicates exist", () => {
    insertRaw("git status", "/a", 1000, "s1");
    insertRaw("git diff", "/a", 1001, "s1");

    const removed = dedup(db);
    expect(removed).toBe(0);

    const rows = db.query("SELECT * FROM history").all();
    expect(rows).toHaveLength(2);
  });

  test("handles many duplicates of the same command", () => {
    for (let i = 0; i < 5; i++) {
      insertRaw("ls -la", `/dir${i}`, 1000 + i, `s${i}`);
    }

    const removed = dedup(db);
    expect(removed).toBe(4);

    const rows = db.query("SELECT * FROM history").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].timestamp).toBe(1004);
  });

  test("keeps the newest inserted duplicate when timestamps tie", () => {
    insertRaw("same-ts", "/old", 3000, "s1");
    insertRaw("same-ts", "/new", 3000, "s2");

    dedup(db);

    const rows = db.query("SELECT * FROM history").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].cwd).toBe("/new");
    expect(rows[0].session).toBe("s2");
  });

  test("collapses whitespace-variant duplicates", () => {
    insertRaw("same-cmd ", "/old", 4000, "s1");
    insertRaw("same-cmd", "/new", 4001, "s2");

    dedup(db);

    const rows = db.query("SELECT command, cwd, session FROM history").all() as { command: string; cwd: string; session: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].command).toBe("same-cmd");
    expect(rows[0].cwd).toBe("/new");
    expect(rows[0].session).toBe("s2");
  });
});

describe("resetHistory", () => {
  test("clears all history entries", () => {
    const base = { hostname: "mac", duration: 100, exitCode: 0, session: "s1" };
    addCommand(db, { ...base, command: "git status", cwd: "/a", timestamp: 1000 });
    addCommand(db, { ...base, command: "git diff", cwd: "/a", timestamp: 1001 });

    resetHistory(db);

    const rows = db.query("SELECT * FROM history").all();
    expect(rows).toHaveLength(0);
  });

  test("works on an already empty database", () => {
    resetHistory(db);
    const rows = db.query("SELECT * FROM history").all();
    expect(rows).toHaveLength(0);
  });
});
