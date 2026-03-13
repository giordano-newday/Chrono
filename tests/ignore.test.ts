import { describe, expect, test } from "bun:test";
import { shouldIgnore } from "../src/ignore";

describe("shouldIgnore", () => {
  test("does NOT ignore 'ls'", () => {
    expect(shouldIgnore("ls")).toBe(false);
  });

  test("does NOT ignore 'll'", () => {
    expect(shouldIgnore("ll")).toBe(false);
  });

  test("does NOT ignore 'la'", () => {
    expect(shouldIgnore("la")).toBe(false);
  });

  test("does NOT ignore 'pwd'", () => {
    expect(shouldIgnore("pwd")).toBe(false);
  });

  test("does NOT ignore 'cd'", () => {
    expect(shouldIgnore("cd")).toBe(false);
  });

  test("does NOT ignore 'clear'", () => {
    expect(shouldIgnore("clear")).toBe(false);
  });

  test("does NOT ignore 'exit'", () => {
    expect(shouldIgnore("exit")).toBe(false);
  });

  test("does NOT ignore 'history'", () => {
    expect(shouldIgnore("history")).toBe(false);
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
