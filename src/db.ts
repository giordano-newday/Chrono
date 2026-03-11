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
