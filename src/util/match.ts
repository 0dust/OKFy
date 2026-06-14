import { minimatch } from "minimatch";

export function matchesPattern(value: string, pattern: string): boolean {
  if (pattern.startsWith("/") && pattern.endsWith("/") && pattern.length > 2) {
    try {
      return new RegExp(pattern.slice(1, -1)).test(value);
    } catch {
      return false;
    }
  }
  try {
    return minimatch(value, pattern, { dot: true });
  } catch {
    return false;
  }
}

export function matchesAnyPattern(value: string, patterns: string[] | undefined): boolean {
  return Boolean(patterns?.some((pattern) => matchesPattern(value, pattern)));
}
