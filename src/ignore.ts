const IGNORED_PATTERN = /^(ls|ll|la|pwd|cd|clear|exit|history|\s*)$/;

export function shouldIgnore(command: string): boolean {
  return IGNORED_PATTERN.test(command.trim()) || command.trim() === "";
}
