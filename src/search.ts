import type { Database } from "bun:sqlite";
import type { SearchRow } from "./db";
import { querySearch } from "./db";

export function formatSearchRow(row: SearchRow): string {
  const date = new Date(row.timestamp * 1000);
  const dateStr = date.toISOString().slice(0, 10);
  const timeStr = date.toTimeString().slice(0, 5);

  const displayCmd = collapseCommand(row.command);

  return `${dateStr} ${timeStr}  ${displayCmd}`;
}

/**
 * Collapse a multiline command into a single line for display.
 * - Continuation lines (ending with \) are joined with a space
 * - Real newlines (separate statements) are joined with "; "
 */
export function collapseCommand(command: string): string {
  if (!command.includes("\n")) return command;

  // Replace shell continuation (\<newline><whitespace>) with single space
  let result = command.replace(/\s*\\\n\s*/g, " ");

  // Replace remaining real newlines with "; "
  result = result.replace(/\n/g, "; ");

  return result;
}

export function parseSelectedLine(line: string): string {
  if (!line) return "";
  // Format: "2026-03-12 11:02  git status"
  // Skip past "YYYY-MM-DD HH:MM  " (18 chars)
  const match = line.match(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}  (.+)$/);
  return match ? match[1].trim() : line.trim();
}

export function buildFzfArgs(): string[] {
  return [
    "--ansi",
    "--no-sort",
    "--layout=reverse-list",
    "--sync",
    "--bind",
    "start:last",
    "--pointer=❯",
  ];
}

export async function runFzfSearch(
  db: Database,
  scope: string = "global",
  cwd?: string,
  session?: string,
): Promise<string | null> {
  const rows = querySearch(db, { scope, cwd, session });
  if (rows.length === 0) return null;

  const lines = rows.map(formatSearchRow);
  const input = lines.join("\n");

  const proc = Bun.spawn(["fzf", ...buildFzfArgs()], {
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
