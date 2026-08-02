import fs from "node:fs/promises";
import path from "node:path";
import { parseFrontmatter, type ParsedFrontmatter } from "./frontmatter.js";
import { isConceptMarkdownPath, isReservedOkfPath } from "./okf.js";
import { listMarkdownFiles } from "./util/markdown-files.js";
import { stripMdExtension, toPosixPath } from "./util/path.js";
import type { Concept } from "./types.js";

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export function conceptFromParsed(
  bundleDir: string,
  absolutePath: string,
  parsed: ParsedFrontmatter
): Concept {
  const relPath = toPosixPath(path.relative(bundleDir, absolutePath));
  if (isReservedOkfPath(relPath)) throw new Error(`Reserved OKF file is not a concept: ${relPath}`);
  const id = stripMdExtension(relPath);
  const frontmatter = parsed.data;
  const aliases = stringArray(frontmatter.aliases);
  return {
    id,
    path: relPath,
    frontmatter,
    type: typeof frontmatter.type === "string" ? frontmatter.type : "",
    title: typeof frontmatter.title === "string" ? frontmatter.title : undefined,
    description: typeof frontmatter.description === "string" ? frontmatter.description : undefined,
    resource: typeof frontmatter.resource === "string" ? frontmatter.resource : undefined,
    tags: stringArray(frontmatter.tags),
    ...(aliases.length ? { aliases } : {}),
    body: parsed.content.trim()
  };
}

export function conceptFromRaw(bundleDir: string, absolutePath: string, raw: string): Concept {
  return conceptFromParsed(bundleDir, absolutePath, parseFrontmatter(raw));
}

export async function readConceptFile(bundleDir: string, absolutePath: string): Promise<Concept> {
  return conceptFromRaw(bundleDir, absolutePath, await fs.readFile(absolutePath, "utf8"));
}

export async function readBundle(bundleDir: string): Promise<Map<string, Concept>> {
  const files = await listMarkdownFiles(bundleDir);
  const concepts = new Map<string, Concept>();
  for (const file of files) {
    const relPath = toPosixPath(path.relative(bundleDir, file));
    if (!isConceptMarkdownPath(relPath)) continue;
    const concept = await readConceptFile(bundleDir, file);
    concepts.set(concept.id, concept);
    concepts.set(concept.path, concept);
  }
  return concepts;
}
