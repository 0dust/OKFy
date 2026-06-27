import fs from "node:fs/promises";
import path from "node:path";
import { hasFrontmatter, parseFrontmatter, type ParsedFrontmatter } from "./frontmatter.js";
import { buildGraph, extractInternalLinks } from "./graph.js";
import { isConceptMarkdownPath, isReservedOkfPath } from "./okf.js";
import { readBundle } from "./reader.js";
import { listMarkdownFiles } from "./util/markdown-files.js";
import { toPosixPath } from "./util/path.js";
import type { BundleStats, ValidationIssue, ValidationReport } from "./types.js";

function issue(
  severity: "error" | "warning",
  code: string,
  message: string,
  file?: string
): ValidationIssue {
  return { severity, code, message, path: file };
}

function firstContentLine(content: string): string {
  return (
    content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function validateIndexFile(raw: string, rel: string, issues: ValidationIssue[]): void {
  let body = raw;
  if (hasFrontmatter(raw)) {
    if (rel !== "index.md") {
      issues.push(
        issue(
          "error",
          "reserved_index_frontmatter",
          "Only bundle-root index.md may contain okf_version frontmatter.",
          rel
        )
      );
      return;
    }
    let parsed: ParsedFrontmatter;
    try {
      parsed = parseFrontmatter(raw);
    } catch (error: any) {
      issues.push(
        issue(
          "error",
          "malformed_frontmatter",
          error?.message ?? "Malformed YAML frontmatter.",
          rel
        )
      );
      return;
    }
    const keys = Object.keys(parsed.data);
    if (
      keys.length !== 1 ||
      keys[0] !== "okf_version" ||
      typeof parsed.data.okf_version !== "string"
    ) {
      issues.push(
        issue(
          "error",
          "reserved_index_frontmatter",
          "Root index.md frontmatter may contain only string okf_version.",
          rel
        )
      );
    }
    body = parsed.content;
  }
  const firstLine = firstContentLine(body);
  if (!firstLine.startsWith("# ")) {
    issues.push(
      issue(
        "error",
        "invalid_index_structure",
        "index.md must be a markdown directory listing headed by a section title.",
        rel
      )
    );
  }
}

function validateLogFile(raw: string, rel: string, issues: ValidationIssue[]): void {
  if (hasFrontmatter(raw)) {
    issues.push(
      issue("error", "reserved_log_frontmatter", "log.md must not contain YAML frontmatter.", rel)
    );
    return;
  }
  const firstLine = firstContentLine(raw);
  if (!firstLine.startsWith("# ")) {
    issues.push(
      issue(
        "error",
        "invalid_log_structure",
        "log.md must be a markdown update log headed by a title.",
        rel
      )
    );
  }
  for (const line of raw.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading && !/^\d{4}-\d{2}-\d{2}\b/.test(heading[1] ?? "")) {
      issues.push(
        issue("error", "invalid_log_date", "log.md date headings must use YYYY-MM-DD.", rel)
      );
    }
  }
}

function validateReservedFile(raw: string, rel: string, issues: ValidationIssue[]): void {
  const name = path.posix.basename(rel).toLowerCase();
  if (name === "index.md") validateIndexFile(raw, rel, issues);
  if (name === "log.md") validateLogFile(raw, rel, issues);
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
      conceptCount: 0,
      reservedFileCount: 0,
      warningCount: 0
    };
  }

  const conceptFiles = files.filter((file) =>
    isConceptMarkdownPath(toPosixPath(path.relative(bundleDir, file)))
  );
  const reservedFiles = files.filter((file) =>
    isReservedOkfPath(toPosixPath(path.relative(bundleDir, file)))
  );

  for (const file of reservedFiles) {
    const rel = toPosixPath(path.relative(bundleDir, file));
    const raw = await fs.readFile(file, "utf8");
    validateReservedFile(raw, rel, issues);
  }

  for (const file of files) {
    const rel = toPosixPath(path.relative(bundleDir, file));
    if (!isConceptMarkdownPath(rel)) continue;
    if (rel.includes("..") || path.isAbsolute(rel)) {
      issues.push(issue("error", "unsafe_path", "Concept path is unsafe.", rel));
    }
    const raw = await fs.readFile(file, "utf8");
    if (!hasFrontmatter(raw)) {
      issues.push(
        issue("error", "missing_frontmatter", "Concept file must start with YAML frontmatter.", rel)
      );
      continue;
    }
    let parsed: ParsedFrontmatter;
    try {
      parsed = parseFrontmatter(raw);
    } catch (error: any) {
      issues.push(
        issue(
          "error",
          "malformed_frontmatter",
          error?.message ?? "Malformed YAML frontmatter.",
          rel
        )
      );
      continue;
    }
    const data = parsed.data;
    if (typeof data.type !== "string" || data.type.trim() === "") {
      issues.push(
        issue("error", "missing_type", "Frontmatter type must be a non-empty string.", rel)
      );
    }
    for (const key of ["title", "description", "resource", "timestamp"]) {
      if (data[key] !== undefined && typeof data[key] !== "string") {
        issues.push(
          issue("warning", "bad_field_shape", `${key} should be a string when present.`, rel)
        );
      }
    }
    if (
      data.tags !== undefined &&
      (!Array.isArray(data.tags) || data.tags.some((tag) => typeof tag !== "string"))
    ) {
      issues.push(
        issue("warning", "bad_field_shape", "tags should be an array of strings when present.", rel)
      );
    }
  }

  const concepts = await readBundle(bundleDir).catch(() => new Map());
  const canonicalIds = new Set([...concepts.values()].map((concept) => concept.id));
  for (const concept of new Map(
    [...concepts.values()].map((concept) => [concept.id, concept])
  ).values()) {
    for (const target of extractInternalLinks(concept)) {
      if (!canonicalIds.has(target)) {
        issues.push(
          issue(
            "warning",
            "broken_internal_link",
            `Broken internal link to ${target}.`,
            concept.path
          )
        );
      }
    }
  }

  const dirs = new Set(conceptFiles.map((file) => path.dirname(file)));
  for (const dir of dirs) {
    const index = path.join(dir, "index.md");
    if (!files.includes(index)) {
      issues.push(
        issue(
          "warning",
          "missing_folder_index",
          "Folder has concepts but no index.md.",
          toPosixPath(path.relative(bundleDir, dir)) || "."
        )
      );
    }
  }

  return {
    valid: !issues.some((item) => item.severity === "error"),
    issues,
    conceptCount: conceptFiles.length,
    reservedFileCount: reservedFiles.length,
    warningCount: issues.filter((item) => item.severity === "warning").length
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
    title: path.basename(bundleDir),
    conceptCount: concepts.length,
    reservedFileCount: validation.reservedFileCount,
    warningCount: validation.warningCount,
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
