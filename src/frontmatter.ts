import { load } from "js-yaml";

export type ParsedFrontmatter = {
  data: Record<string, unknown>;
  content: string;
};

const UTF8_BOM = "\uFEFF";

function stripLeadingBom(raw: string): string {
  return raw.startsWith(UTF8_BOM) ? raw.slice(1) : raw;
}

export function hasFrontmatter(raw: string): boolean {
  return /^---[ \t]*(?:\r?\n|$)/.test(stripLeadingBom(raw));
}

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const normalized = stripLeadingBom(raw);
  if (!hasFrontmatter(normalized)) return { data: {}, content: normalized };
  const openingEnd = normalized.indexOf("\n");
  if (openingEnd < 0) throw new Error("Malformed YAML frontmatter.");

  let lineStart = openingEnd + 1;
  let closingEnd = -1;
  let yamlEnd = -1;
  while (lineStart <= normalized.length) {
    const nextNewline = normalized.indexOf("\n", lineStart);
    const lineEnd = nextNewline < 0 ? normalized.length : nextNewline;
    const line = normalized.slice(lineStart, lineEnd).replace(/\r$/, "");
    if (/^---[ \t]*$/.test(line)) {
      yamlEnd = lineStart;
      closingEnd = nextNewline < 0 ? lineEnd : nextNewline + 1;
      break;
    }
    if (nextNewline < 0) break;
    lineStart = nextNewline + 1;
  }

  if (closingEnd < 0 || yamlEnd < 0) throw new Error("Malformed YAML frontmatter.");
  const yaml = normalized.slice(openingEnd + 1, yamlEnd).replace(/\r?\n$/, "");
  const loaded = load(yaml);
  return {
    data: isRecord(loaded) ? loaded : {},
    content: normalized.slice(closingEnd)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
