import type { Database } from "bun:sqlite";
import type { SearchRow } from "./db";
import { querySearch } from "./db";

export function formatSearchRow(row: SearchRow): string {
  const exitIndicator =
    row.exit_code === null ? "?" : row.exit_code === 0 ? "✓" : "✗";

  const date = new Date(row.timestamp * 1000);
  const dateStr = date.toISOString().slice(0, 10);
  const timeStr = date.toTimeString().slice(0, 5);

  const displayCmd = collapseCommand(row.command);

  return `  ${exitIndicator}  ${dateStr}  ${timeStr}  ${row.cwd}  │ ${displayCmd}`;
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
