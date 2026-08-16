import fs from "node:fs/promises";
import path from "node:path";
import GithubSlugger from "github-slugger";
import { hasFrontmatter, parseFrontmatter, type ParsedFrontmatter } from "./frontmatter.js";
import { buildGraph, buildGraphFromSemantics } from "./graph.js";
import {
  IMPORT_DIAGNOSTICS_FILE,
  readImportDiagnostics,
  type PersistedImportDiagnostic
} from "./import-diagnostics.js";
import { internalLinksFromSemantics } from "./internal-links.js";
import { parseMarkdown } from "./markdown-ast.js";
import { isConceptMarkdownPath, isReservedOkfPath } from "./okf.js";
import { conceptFromParsed, readBundle } from "./reader.js";
import {
  compareVaultDiagnostics,
  fragmentIndexContains,
  indexDocumentFragments,
  missingFragmentDiagnostic,
  splitMarkdownFragmentTarget,
  type DocumentFragmentIndex
} from "./vault-diagnostics.js";
import { resolveVaultDocuments } from "./vault-index.js";
import { listMarkdownFiles } from "./util/markdown-files.js";
import { toPosixPath } from "./util/path.js";
import type {
  BundleStats,
  Concept,
  DocumentDiagnostic,
  KnowledgeGraph,
  NormalizedDocument,
  ValidationIssue,
  ValidationReport
} from "./types.js";

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

function conceptSourcePath(concept: Concept): string {
  const resourcePath = concept.resource?.split(/[?#]/, 1)[0] ?? "";
  if (resourcePath && !/^[a-z][a-z0-9+.-]*:/i.test(resourcePath)) return resourcePath;
  return concept.path;
}

function semanticDocument(concept: Concept): NormalizedDocument {
  const sourcePath = conceptSourcePath(concept);
  const parsed = parseMarkdown(concept.body, { mdx: /\.mdx$/i.test(sourcePath) });
  return {
    sourceId: sourcePath,
    sourcePath,
    outputPath: concept.path,
    title: concept.title ?? path.posix.basename(concept.path, path.posix.extname(concept.path)),
    markdown: parsed.content,
    resource: concept.resource,
    headings: parsed.headings.map(({ depth, text, slug }) => ({ depth, text, slug })),
    links: parsed.markdownLinks,
    tags: concept.tags,
    type: concept.type,
    aliases: concept.aliases,
    semanticLinks: parsed.semanticLinks,
    blockIds: [...parsed.blockIds, ...parsed.htmlAnchors]
  };
}

function markdownDestination(
  sourceConcept: string,
  target: string
): { targetConcept: string; fragment: string } | undefined {
  const destination = splitMarkdownFragmentTarget(target);
  if (!destination) return undefined;
  const targetConcept = destination.targetPath.startsWith("/")
    ? path.posix.normalize(destination.targetPath.slice(1))
    : path.posix.normalize(
        path.posix.join(path.posix.dirname(sourceConcept), destination.targetPath)
      );
  if (!targetConcept || targetConcept === ".." || targetConcept.startsWith("../")) return undefined;
  return { targetConcept, fragment: destination.fragment.normalize("NFC") };
}

function persistedLinkKey(
  source: string,
  target: string,
  fragment: string,
  fragmentKind: "heading" | "block",
  emittedLinkRaw: string
): string {
  return `${source}\0${target}\0${fragment}\0${fragmentKind}\0${emittedLinkRaw}`;
}

function persistedLinkCounts(
  conceptsByPath: Map<string, Concept>,
  documentsByConceptId: Map<string, NormalizedDocument>,
  relevantKeys: Set<string>,
  sourceConceptPaths: Set<string>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const sourceConceptPath of sourceConceptPaths) {
    const concept = conceptsByPath.get(sourceConceptPath);
    if (!concept) continue;
    const document = documentsByConceptId.get(concept.id);
    for (const link of document?.semanticLinks ?? []) {
      if (link.kind !== "markdown") continue;
      const destination = markdownDestination(concept.path, link.target);
      if (!destination) continue;
      for (const fragmentKind of ["heading", "block"] as const) {
        const key = persistedLinkKey(
          concept.path,
          destination.targetConcept,
          destination.fragment,
          fragmentKind,
          link.raw
        );
        if (!relevantKeys.has(key)) continue;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function sourceFragment(
  rawTarget: string
): { kind: "heading" | "block"; emitted: string } | undefined {
  const hash = rawTarget.indexOf("#");
  if (hash < 0 || hash === rawTarget.length - 1) return undefined;
  const requested = rawTarget
    .slice(hash + 1)
    .trim()
    .normalize("NFC");
  if (!requested) return undefined;
  if (requested.startsWith("^")) {
    const emitted = requested.slice(1);
    return emitted ? { kind: "block", emitted } : undefined;
  }
  return { kind: "heading", emitted: new GithubSlugger().slug(requested) || requested };
}

function persistedImportDiagnostics(
  concepts: Concept[],
  documentsByConceptId: Map<string, NormalizedDocument>,
  entries: PersistedImportDiagnostic[]
): DocumentDiagnostic[] {
  if (entries.length === 0) return [];
  const conceptsByPath = new Map(concepts.map((concept) => [concept.path, concept]));
  const groups = new Map<string, PersistedImportDiagnostic[]>();

  for (const entry of entries) {
    const fragment = sourceFragment(entry.rawTarget);
    const emittedFragment = entry.emittedFragment.normalize("NFC");
    if (
      !conceptsByPath.has(entry.sourceConceptPath) ||
      !conceptsByPath.has(entry.targetConceptPath) ||
      !fragment ||
      fragment.kind !== entry.fragmentKind ||
      fragment.emitted !== emittedFragment
    ) {
      continue;
    }
    const key = persistedLinkKey(
      entry.sourceConceptPath,
      entry.targetConceptPath,
      emittedFragment,
      entry.fragmentKind,
      entry.emittedLinkRaw
    );
    const group = groups.get(key);
    if (group) group.push(entry);
    else groups.set(key, [entry]);
  }

  const relevantKeys = new Set(groups.keys());
  const sourceConceptPaths = new Set(
    [...groups.values()].map((group) => group[0]!.sourceConceptPath)
  );
  const linkCounts = persistedLinkCounts(
    conceptsByPath,
    documentsByConceptId,
    relevantKeys,
    sourceConceptPaths
  );
  const targetFragmentIndexes = new Map<string, DocumentFragmentIndex>();
  for (const targetConceptPath of new Set(
    [...groups.values()].map((group) => group[0]!.targetConceptPath)
  )) {
    const target = conceptsByPath.get(targetConceptPath);
    const targetDocument = target ? documentsByConceptId.get(target.id) : undefined;
    if (targetDocument) {
      targetFragmentIndexes.set(targetConceptPath, indexDocumentFragments(targetDocument));
    }
  }
  const diagnostics: DocumentDiagnostic[] = [];

  for (const [key, group] of groups) {
    const linkCount = linkCounts.get(key) ?? 0;
    const baselines = new Set(group.map((entry) => entry.baselineLinkCount));
    if (baselines.size !== 1) continue;
    const baselineLinkCount = group[0]!.baselineLinkCount;
    if (baselineLinkCount <= 0 || linkCount !== baselineLinkCount) continue;
    const replayCount = Math.min(linkCount, group.length);
    for (const entry of group.slice(0, replayCount)) {
      const targetFragments = targetFragmentIndexes.get(entry.targetConceptPath);
      if (
        !entry.targetFragmentPresent &&
        targetFragments &&
        fragmentIndexContains(targetFragments, entry.emittedFragment, entry.fragmentKind)
      ) {
        continue;
      }
      diagnostics.push(
        missingFragmentDiagnostic(entry.sourcePath, entry.rawTarget, entry.targetPath)
      );
    }
  }

  return diagnostics;
}

function semanticValidation(
  concepts: Concept[],
  persistedDiagnostics: PersistedImportDiagnostic[] = []
): {
  documentsByConceptId: Map<string, NormalizedDocument>;
  issues: ValidationIssue[];
} {
  const documentsByConceptId = new Map<string, NormalizedDocument>();
  const issues: ValidationIssue[] = [];
  for (const concept of concepts) {
    try {
      documentsByConceptId.set(concept.id, semanticDocument(concept));
    } catch (error: any) {
      const sourcePath = conceptSourcePath(concept);
      issues.push(
        issue(
          "error",
          "malformed_markdown",
          `Malformed Markdown in ${sourcePath}: ${error?.message ?? "Unable to parse document."}`,
          concept.path
        )
      );
    }
  }
  const diagnostics = resolveVaultDocuments([...documentsByConceptId.values()]);
  const replayedDiagnostics = persistedImportDiagnostics(
    concepts,
    documentsByConceptId,
    persistedDiagnostics
  );
  if (replayedDiagnostics.length > 0) {
    diagnostics.push(...replayedDiagnostics);
    diagnostics.sort(compareVaultDiagnostics);
  }
  return {
    documentsByConceptId,
    issues: [
      ...issues,
      ...diagnostics.map((diagnostic) => ({
        severity: diagnostic.severity,
        code: diagnostic.code,
        message: diagnostic.message,
        path: diagnostic.sourcePath,
        rawTarget: diagnostic.rawTarget,
        ...(diagnostic.candidates ? { candidates: diagnostic.candidates } : {})
      }))
    ]
  };
}

export type BundleAnalysis = {
  validation: ValidationReport;
  conceptsByAnyKey: Map<string, Concept>;
  graph: KnowledgeGraph;
  inspectionError?: unknown;
};

function reportFor(issues: ValidationIssue[], conceptCount: number, reservedFileCount: number) {
  return {
    valid: !issues.some((item) => item.severity === "error"),
    issues,
    conceptCount,
    reservedFileCount,
    warningCount: issues.filter((item) => item.severity === "warning").length
  } satisfies ValidationReport;
}

export async function analyzeBundle(bundleDir: string): Promise<BundleAnalysis> {
  const issues: ValidationIssue[] = [];
  let files: string[] = [];
  try {
    files = await listMarkdownFiles(bundleDir);
  } catch (error: any) {
    const validation: ValidationReport = {
      valid: false,
      issues: [issue("error", "bundle_unreadable", error?.message ?? "Bundle cannot be read.")],
      conceptCount: 0,
      reservedFileCount: 0,
      warningCount: 0
    };
    return {
      validation,
      conceptsByAnyKey: new Map(),
      graph: buildGraph(new Map()),
      inspectionError: error
    };
  }

  const conceptFiles = files.filter((file) =>
    isConceptMarkdownPath(toPosixPath(path.relative(bundleDir, file)))
  );
  const reservedFiles = files.filter((file) =>
    isReservedOkfPath(toPosixPath(path.relative(bundleDir, file)))
  );
  const parsedConcepts = new Map<string, ParsedFrontmatter>();
  let inspectionError: unknown;

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
    let parsed: ParsedFrontmatter;
    try {
      parsed = parseFrontmatter(raw);
    } catch (error: any) {
      inspectionError ??= error;
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
    parsedConcepts.set(file, parsed);
    if (!hasFrontmatter(raw)) {
      issues.push(
        issue("error", "missing_frontmatter", "Concept file must start with YAML frontmatter.", rel)
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

  const concepts = new Map<string, Concept>();
  if (inspectionError === undefined) {
    for (const file of conceptFiles) {
      const concept = conceptFromParsed(bundleDir, file, parsedConcepts.get(file)!);
      concepts.set(concept.id, concept);
      concepts.set(concept.path, concept);
    }
  }
  const canonicalConcepts = [
    ...new Map([...concepts.values()].map((concept) => [concept.id, concept])).values()
  ].sort((first, second) => first.id.localeCompare(second.id));
  const importDiagnostics = await readImportDiagnostics(bundleDir);
  if (importDiagnostics.error) {
    issues.push(
      issue(
        "warning",
        "invalid_import_diagnostics",
        importDiagnostics.error,
        IMPORT_DIAGNOSTICS_FILE
      )
    );
  }
  const semantic = semanticValidation(canonicalConcepts, importDiagnostics.entries);
  issues.push(...semantic.issues);
  const canonicalIds = new Set(canonicalConcepts.map((concept) => concept.id));
  for (const concept of canonicalConcepts) {
    for (const target of internalLinksFromSemantics(
      concept.path,
      semantic.documentsByConceptId.get(concept.id)?.semanticLinks ?? []
    )) {
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

  const semanticLinksByConceptId = new Map(
    canonicalConcepts.map((concept) => [
      concept.id,
      semantic.documentsByConceptId.get(concept.id)?.semanticLinks ?? []
    ])
  );
  return {
    validation: reportFor(issues, conceptFiles.length, reservedFiles.length),
    conceptsByAnyKey: concepts,
    graph: buildGraphFromSemantics(concepts, semanticLinksByConceptId),
    ...(inspectionError === undefined ? {} : { inspectionError })
  };
}

export async function validateBundle(bundleDir: string): Promise<ValidationReport> {
  return (await analyzeBundle(bundleDir)).validation;
}

export async function inspectBundle(
  bundleDir: string,
  options: {
    analysis?: BundleAnalysis;
    validation?: ValidationReport;
    graph?: KnowledgeGraph;
  } = {}
): Promise<BundleStats> {
  const analysis =
    options.analysis ??
    (options.validation || options.graph ? undefined : await analyzeBundle(bundleDir));
  if (analysis?.inspectionError) throw analysis.inspectionError;
  const graph = options.graph ?? analysis?.graph ?? buildGraph(await readBundle(bundleDir));
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
  const validation =
    options.validation ?? analysis?.validation ?? (await validateBundle(bundleDir));
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
