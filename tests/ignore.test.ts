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
