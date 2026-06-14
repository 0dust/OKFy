import path from "node:path";

const RESERVED_FILENAMES = new Set(["index.md", "log.md"]);

export function toOkfPath(input: string): string {
  return input.split(path.sep).join("/");
}

export function isReservedOkfPath(input: string): boolean {
  return RESERVED_FILENAMES.has(path.posix.basename(toOkfPath(input)).toLowerCase());
}

export function isConceptMarkdownPath(input: string): boolean {
  return input.toLowerCase().endsWith(".md") && !isReservedOkfPath(input);
}
