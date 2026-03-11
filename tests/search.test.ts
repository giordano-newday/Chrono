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
