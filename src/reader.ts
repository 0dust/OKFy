import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { isConceptMarkdownPath, isReservedOkfPath } from "./okf.js";
import { stripMdExtension, toPosixPath } from "./util/path.js";
import type { Concept } from "./types.js";

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const result: string[] = [];
  async function walk(current: string): Promise<void> {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && entry.name.endsWith(".md")) result.push(absolute);
    }
  }
  await walk(dir);
  return result.sort();
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

export async function readConceptFile(bundleDir: string, absolutePath: string): Promise<Concept> {
  const raw = await fs.readFile(absolutePath, "utf8");
  const parsed = matter(raw);
  const relPath = toPosixPath(path.relative(bundleDir, absolutePath));
  if (isReservedOkfPath(relPath)) throw new Error(`Reserved OKF file is not a concept: ${relPath}`);
  const id = stripMdExtension(relPath);
  const frontmatter = parsed.data as Record<string, unknown>;
  return {
    id,
    path: relPath,
    frontmatter,
    type: typeof frontmatter.type === "string" ? frontmatter.type : "",
    title: typeof frontmatter.title === "string" ? frontmatter.title : undefined,
    description: typeof frontmatter.description === "string" ? frontmatter.description : undefined,
    resource: typeof frontmatter.resource === "string" ? frontmatter.resource : undefined,
    tags: stringArray(frontmatter.tags),
    body: parsed.content.trim()
  };
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
