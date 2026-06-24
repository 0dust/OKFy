import { load } from "js-yaml";

export type ParsedFrontmatter = {
  data: Record<string, unknown>;
  content: string;
};

const FRONTMATTER_PATTERN =
  /^---[ \t]*\r?\n(?:---[ \t]*(?:\r?\n|$)|([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$))/;
const UTF8_BOM = "\uFEFF";

function stripLeadingBom(raw: string): string {
  return raw.startsWith(UTF8_BOM) ? raw.slice(1) : raw;
}

export function hasFrontmatter(raw: string): boolean {
  return stripLeadingBom(raw).startsWith("---");
}

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const normalized = stripLeadingBom(raw);
  if (!normalized.startsWith("---")) return { data: {}, content: normalized };
  const match = normalized.match(FRONTMATTER_PATTERN);
  if (!match) throw new Error("Malformed YAML frontmatter.");
  const loaded = load(match[1] ?? "");
  return {
    data: isRecord(loaded) ? loaded : {},
    content: normalized.slice(match[0].length)
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
