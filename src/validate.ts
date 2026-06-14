import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { buildGraph, extractInternalLinks } from "./graph.js";
import { readBundle } from "./reader.js";
import type { BundleStats, ValidationIssue, ValidationReport } from "./types.js";

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

function issue(severity: "error" | "warning", code: string, message: string, file?: string): ValidationIssue {
  return { severity, code, message, path: file };
}

export async function validateBundle(bundleDir: string): Promise<ValidationReport> {
  const issues: ValidationIssue[] = [];
  let files: string[] = [];
  try {
    files = await listMarkdownFiles(bundleDir);
  } catch (error: any) {
    return {
      valid: false,
      issues: [issue("error", "bundle_unreadable", error?.message ?? "Bundle cannot be read.")],
      conceptCount: 0
    };
  }

  const seenIds = new Set<string>();
  for (const file of files) {
    const rel = path.relative(bundleDir, file).split(path.sep).join("/");
    if (rel.includes("..") || path.isAbsolute(rel)) {
      issues.push(issue("error", "unsafe_path", "Concept path is unsafe.", rel));
    }
    const raw = await fs.readFile(file, "utf8");
    if (!raw.startsWith("---")) {
      issues.push(issue("error", "missing_frontmatter", "Concept file must start with YAML frontmatter.", rel));
      continue;
    }
    let parsed: matter.GrayMatterFile<string>;
    try {
      parsed = matter(raw);
    } catch (error: any) {
      issues.push(issue("error", "malformed_frontmatter", error?.message ?? "Malformed YAML frontmatter.", rel));
      continue;
    }
    const data = parsed.data as Record<string, unknown>;
    if (typeof data.type !== "string" || data.type.trim() === "") {
      issues.push(issue("error", "missing_type", "Frontmatter type must be a non-empty string.", rel));
    }
    for (const key of ["title", "description", "resource", "timestamp"]) {
      if (data[key] !== undefined && typeof data[key] !== "string") {
        issues.push(issue("error", "bad_field_shape", `${key} must be a string when present.`, rel));
      }
    }
    if (data.tags !== undefined && (!Array.isArray(data.tags) || data.tags.some((tag) => typeof tag !== "string"))) {
      issues.push(issue("error", "bad_field_shape", "tags must be an array of strings when present.", rel));
    }
    if (parsed.content.trim().length === 0) {
      issues.push(issue("error", "empty_concept", "Concept body must not be empty.", rel));
    }
    const id = rel.replace(/\.md$/i, "");
    if (seenIds.has(id)) issues.push(issue("error", "duplicate_concept_id", `Duplicate concept id: ${id}`, rel));
    seenIds.add(id);
  }

  const concepts = await readBundle(bundleDir).catch(() => new Map());
  const canonicalIds = new Set([...concepts.values()].map((concept) => concept.id));
  for (const concept of new Map([...concepts.values()].map((concept) => [concept.id, concept])).values()) {
    for (const target of extractInternalLinks(concept)) {
      if (!canonicalIds.has(target)) {
        issues.push(issue("error", "broken_internal_link", `Broken internal link to ${target}.`, concept.path));
      }
    }
  }

  const dirs = new Set(files.map((file) => path.dirname(file)));
  for (const dir of dirs) {
    const index = path.join(dir, "index.md");
    if (!files.includes(index)) {
      issues.push(
        issue(
          "warning",
          "missing_folder_index",
          "Folder has concepts but no index.md.",
          path.relative(bundleDir, dir).split(path.sep).join("/") || "."
        )
      );
    }
  }

  return {
    valid: !issues.some((item) => item.severity === "error"),
    issues,
    conceptCount: files.length
  };
}

export async function inspectBundle(bundleDir: string): Promise<BundleStats> {
  const conceptsByAnyKey = await readBundle(bundleDir);
  const graph = buildGraph(conceptsByAnyKey);
  const concepts = [...graph.concepts.values()];
  const typeDistribution: Record<string, number> = {};
  const tagDistribution: Record<string, number> = {};
  const sourceDomains: Record<string, number> = {};
  for (const concept of concepts) {
    typeDistribution[concept.type] = (typeDistribution[concept.type] ?? 0) + 1;
    for (const tag of concept.tags) tagDistribution[tag] = (tagDistribution[tag] ?? 0) + 1;
    if (concept.resource?.startsWith("http")) {
      const domain = new URL(concept.resource).hostname;
      sourceDomains[domain] = (sourceDomains[domain] ?? 0) + 1;
    }
  }
  const topLinkedConcepts = concepts
    .map((concept) => ({
      id: concept.id,
      title: concept.title,
      count: (graph.backlinks.get(concept.id) ?? []).length
    }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    .slice(0, 10);
  const linkCount = [...graph.outbound.values()].reduce((sum, links) => sum + links.length, 0);
  const validation = await validateBundle(bundleDir);
  return {
    title: concepts.find((concept) => concept.id === "index")?.title ?? path.basename(bundleDir),
    conceptCount: concepts.length,
    typeDistribution,
    tagDistribution,
    linkCount,
    brokenLinks: validation.issues.filter((item) => item.code === "broken_internal_link").length,
    orphanConcepts: concepts
      .filter((concept) => concept.id !== "index")
      .filter((concept) => (graph.backlinks.get(concept.id) ?? []).length === 0)
      .map((concept) => concept.id)
      .sort(),
    topLinkedConcepts,
    sourceDomains
  };
}
