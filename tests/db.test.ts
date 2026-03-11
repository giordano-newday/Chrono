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
});

describe("getStats", () => {
  test("returns total count and top commands", () => {
    const base = { cwd: "/x", hostname: "mac", duration: 100, exitCode: 0, session: "s1" };
    addCommand(db, { ...base, command: "git status", timestamp: 1000 });
    addCommand(db, { ...base, command: "git diff", timestamp: 1001 });
    addCommand(db, { ...base, command: "git status", timestamp: 1002 });

    const stats = getStats(db);
    expect(stats.total).toBe(3);
    expect(stats.top[0].command).toBe("git status");
    expect(stats.top[0].count).toBe(2);
  });
});
