import path from "node:path";
import { pathToFileURL } from "node:url";
import { BundleSearch } from "./search.js";
import { inspectBundle, validateBundle } from "./validate.js";
import type { Concept, ValidationIssue } from "./types.js";
import type { RefreshState } from "./source-store.js";
import type { WorkspaceSourceRecord } from "./workspace.js";

export type InspectorValidationStatus = "valid" | "invalid" | "unavailable";
export type InspectorAvailabilityStatus = "available" | "unavailable";

export interface InspectorTarget {
  kind: "bundle" | "workspace";
  bundleDir?: string;
  workspaceName?: string;
  sourceNames?: string[];
}

export interface InspectorError {
  message: string;
  code?: string;
  [key: string]: unknown;
}

export interface InspectorReadinessSource {
  sourceName: string;
  name: string;
  label: string;
  kind: string;
  seedUrl: string;
  bundleDir: string;
  availabilityStatus: InspectorAvailabilityStatus;
  validationStatus: InspectorValidationStatus;
  conceptCount: number;
  warningCount: number;
  brokenLinkCount: number;
  orphanConcepts: string[];
  freshnessStatus?: string;
  refreshInProgress: boolean;
  lastSuccessfulRefreshAt: string | null;
  nextRefreshAllowedAt: string | null;
  lastRefreshError: InspectorError | null;
}

export interface InspectorReadiness {
  availabilityStatus: InspectorAvailabilityStatus;
  validationStatus: InspectorValidationStatus;
  sourceCount: number;
  usableSourceCount: number;
  conceptCount: number;
  warningCount: number;
  brokenLinkCount: number;
  brokenLinks: number;
  orphanConcepts: string[];
  refreshInProgress: boolean;
  freshnessStatus?: string;
  freshnessStatuses: Record<string, number>;
  lastSuccessfulRefreshAt: string | null;
  nextRefreshAllowedAt: string | null;
  lastRefreshError: InspectorError | null;
  sources: InspectorReadinessSource[];
}

export interface InspectorConcept {
  id: string;
  ref: string;
  path: string;
  title?: string;
  type: string;
  tags: string[];
  description?: string;
  resource?: string;
  resourceUrl?: string;
  sourceName?: string;
  sourceKind?: string;
  seedUrl?: string;
  outbound: string[];
  outboundLinks: string[];
  backlinks: string[];
  citation: {
    ref: string;
    conceptPath: string;
    sourceResource?: string;
    sourceName?: string;
  };
}

export interface InspectorEdge {
  from: string;
  to: string;
  kind: "internal_link";
  label: "Markdown link";
  sourceName?: string;
}

export interface InspectorAgentStep {
  tool: "bundle_summary" | "search_concepts" | "read_concept" | "get_neighbors";
  name: "bundle_summary" | "search_concepts" | "read_concept" | "get_neighbors";
  purpose: string;
  example: string;
}

export interface InspectorReport {
  schemaVersion: 1;
  title: string;
  generatedBy: "okfy";
  target: InspectorTarget;
  readiness: InspectorReadiness;
  sources: InspectorReadinessSource[];
  concepts: InspectorConcept[];
  edges: InspectorEdge[];
  agentPreview: {
    sequence: InspectorAgentStep[];
    tools: Array<{ name: InspectorAgentStep["tool"]; purpose: string }>;
    citationGuidance: string;
    suggestedQuestions: string[];
  };
}

export interface BuildBundleInspectorOptions {
  title?: string;
}

export interface BuildWorkspaceInspectorOptions {
  workspaceName?: string;
  all?: boolean;
  title?: string;
}

export async function buildBundleInspectorReport(
  bundleDir: string,
  options: BuildBundleInspectorOptions = {}
): Promise<InspectorReport> {
  const resolved = path.resolve(bundleDir);
  const sourceName = bundleSourceName(resolved);
  const record = localBundleRecord(resolved, sourceName);
  return buildInspectorReport([record], {
    target: { kind: "bundle", bundleDir: resolved },
    title: options.title ?? `${path.basename(resolved)} OKFY Inspector`,
    prefixSingleSourceRefs: false
  });
}

export async function buildWorkspaceInspectorReport(
  records: WorkspaceSourceRecord[],
  options: BuildWorkspaceInspectorOptions = {}
): Promise<InspectorReport> {
  return buildInspectorReport(records, {
    target: {
      kind: "workspace",
      workspaceName: options.workspaceName,
      sourceNames: records.map((record) => record.name)
    },
    title: options.title ?? `${options.workspaceName ?? "Workspace"} OKFY Inspector`,
    prefixSingleSourceRefs: true
  });
}

async function buildInspectorReport(
  records: WorkspaceSourceRecord[],
  options: {
    target: InspectorTarget;
    title: string;
    prefixSingleSourceRefs: boolean;
  }
): Promise<InspectorReport> {
  const sourceReports = await Promise.all(
    records.map((record) =>
      sourceReport(record, {
        prefixRefs: options.prefixSingleSourceRefs || records.length > 1
      })
    )
  );
  const sources = sourceReports.map((report) => report.source);
  const concepts = sourceReports.flatMap((report) => report.concepts);
  const edges = sourceReports.flatMap((report) => report.edges);
  const readiness = summarizeReadiness(sources);
  return {
    schemaVersion: 1,
    title: options.title,
    generatedBy: "okfy",
    target: options.target,
    readiness,
    sources,
    concepts,
    edges,
    agentPreview: agentPreview(sources, concepts)
  };
}

async function sourceReport(
  record: WorkspaceSourceRecord,
  options: { prefixRefs: boolean }
): Promise<{
  source: InspectorReadinessSource;
  concepts: InspectorConcept[];
  edges: InspectorEdge[];
}> {
  const baseSource = sourceBase(record);
  if (record.loadError) {
    return {
      source: unavailableSource(baseSource, record.loadError, record.state),
      concepts: [],
      edges: []
    };
  }

  let search: BundleSearch;
  try {
    search = await BundleSearch.fromBundle(record.bundleDir);
  } catch (error) {
    return {
      source: unavailableSource(baseSource, error, record.state),
      concepts: [],
      edges: []
    };
  }

  const [validation, stats] = await Promise.all([
    validateBundle(record.bundleDir),
    inspectBundle(record.bundleDir)
  ]);
  const refFor = (id: string): string => (options.prefixRefs ? `${record.name}:${id}` : id);
  const concepts = [...search.graph.concepts.values()]
    .sort((first, second) => first.id.localeCompare(second.id))
    .map((concept) => inspectorConcept(concept, search, record, refFor, options.prefixRefs));
  return {
    source: {
      ...baseSource,
      availabilityStatus: "available",
      validationStatus: validation.valid ? "valid" : "invalid",
      conceptCount: stats.conceptCount,
      warningCount: validation.warningCount,
      brokenLinkCount: brokenLinkCount(validation.issues),
      orphanConcepts: stats.orphanConcepts.map(refFor),
      freshnessStatus: record.state?.status ?? "fresh",
      refreshInProgress: Boolean(record.state?.refreshInProgress),
      lastSuccessfulRefreshAt: record.state?.lastSuccessfulRefreshAt ?? null,
      nextRefreshAllowedAt: record.state?.nextRefreshAllowedAt ?? null,
      lastRefreshError: normalizeError(record.state?.lastError ?? null)
    },
    concepts,
    edges: collapsedEdges(search, record.name, refFor, options.prefixRefs)
  };
}

function inspectorConcept(
  concept: Concept,
  search: BundleSearch,
  record: WorkspaceSourceRecord,
  refFor: (id: string) => string,
  includeSource: boolean
): InspectorConcept {
  const ref = refFor(concept.id);
  return {
    id: concept.id,
    ref,
    path: concept.path,
    title: concept.title,
    type: concept.type,
    tags: [...concept.tags],
    description: concept.description,
    resource: concept.resource,
    resourceUrl: concept.resource,
    ...(includeSource
      ? {
          sourceName: record.name,
          sourceKind: record.manifest.kind,
          seedUrl: record.manifest.source.seedUrl
        }
      : {}),
    outbound: (search.graph.outbound.get(concept.id) ?? []).map(refFor).sort(),
    outboundLinks: (search.graph.outbound.get(concept.id) ?? []).map(refFor).sort(),
    backlinks: (search.graph.backlinks.get(concept.id) ?? []).map(refFor).sort(),
    citation: {
      ref,
      conceptPath: concept.path,
      sourceResource: concept.resource,
      ...(includeSource ? { sourceName: record.name } : {})
    }
  };
}

function collapsedEdges(
  search: BundleSearch,
  sourceName: string,
  refFor: (id: string) => string,
  includeSource: boolean
): InspectorEdge[] {
  const seen = new Set<string>();
  const edges: InspectorEdge[] = [];
  for (const concept of [...search.graph.concepts.values()].sort((a, b) =>
    a.id.localeCompare(b.id)
  )) {
    for (const target of search.graph.outbound.get(concept.id) ?? []) {
      const from = refFor(concept.id);
      const to = refFor(target);
      const key = [from, to].sort().join("\u0000");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        from,
        to,
        kind: "internal_link",
        label: "Markdown link",
        ...(includeSource ? { sourceName } : {})
      });
    }
  }
  return edges.sort(
    (first, second) =>
      (first.sourceName ?? "").localeCompare(second.sourceName ?? "") ||
      first.from.localeCompare(second.from) ||
      first.to.localeCompare(second.to)
  );
}

function sourceBase(record: WorkspaceSourceRecord): Omit<
  InspectorReadinessSource,
  | "availabilityStatus"
  | "validationStatus"
  | "conceptCount"
  | "warningCount"
  | "brokenLinkCount"
  | "orphanConcepts"
  | "freshnessStatus"
  | "refreshInProgress"
  | "lastSuccessfulRefreshAt"
  | "nextRefreshAllowedAt"
  | "lastRefreshError"
> {
  return {
    sourceName: record.name,
    name: record.name,
    label: record.name,
    kind: record.manifest.kind,
    seedUrl: record.manifest.source.seedUrl,
    bundleDir: record.bundleDir
  };
}

function unavailableSource(
  baseSource: ReturnType<typeof sourceBase>,
  error: unknown,
  state: RefreshState | undefined
): InspectorReadinessSource {
  return {
    ...baseSource,
    availabilityStatus: "unavailable",
    validationStatus: "unavailable",
    conceptCount: state?.bundle?.conceptCount ?? 0,
    warningCount: state?.bundle?.warningCount ?? 0,
    brokenLinkCount: 0,
    orphanConcepts: [],
    freshnessStatus: state?.status ?? "failed",
    refreshInProgress: Boolean(state?.refreshInProgress),
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null,
    lastRefreshError: normalizeError(error)
  };
}

function summarizeReadiness(sources: InspectorReadinessSource[]): InspectorReadiness {
  const sourceCount = sources.length;
  const usableSourceCount = sources.filter(
    (source) => source.availabilityStatus === "available"
  ).length;
  const conceptCount = sum(sources, "conceptCount");
  const warningCount = sum(sources, "warningCount");
  const brokenLinkCount = sum(sources, "brokenLinkCount");
  const orphanConcepts = sources.flatMap((source) => source.orphanConcepts).sort();
  const freshnessStatuses: Record<string, number> = {};
  for (const source of sources) {
    if (source.freshnessStatus) {
      freshnessStatuses[source.freshnessStatus] =
        (freshnessStatuses[source.freshnessStatus] ?? 0) + 1;
    }
  }
  const failedSource = sources.find((source) => source.lastRefreshError);
  return {
    availabilityStatus: usableSourceCount > 0 ? "available" : "unavailable",
    validationStatus: sources.some((source) => source.validationStatus !== "valid")
      ? "invalid"
      : "valid",
    sourceCount,
    usableSourceCount,
    conceptCount,
    warningCount,
    brokenLinkCount,
    brokenLinks: brokenLinkCount,
    orphanConcepts,
    refreshInProgress: sources.some((source) => source.refreshInProgress),
    freshnessStatus: aggregateFreshnessStatus(sources),
    freshnessStatuses: Object.fromEntries(
      Object.entries(freshnessStatuses).sort(([first], [second]) => first.localeCompare(second))
    ),
    lastSuccessfulRefreshAt: latest(
      sources.map((source) => source.lastSuccessfulRefreshAt).filter(isString)
    ),
    nextRefreshAllowedAt: earliest(
      sources.map((source) => source.nextRefreshAllowedAt).filter(isString)
    ),
    lastRefreshError: failedSource?.lastRefreshError ?? null,
    sources
  };
}

function aggregateFreshnessStatus(sources: InspectorReadinessSource[]): string | undefined {
  const statuses = new Set(sources.map((source) => source.freshnessStatus).filter(isString));
  for (const status of ["failed", "missing", "refreshing", "stale", "fresh"]) {
    if (statuses.has(status)) return status;
  }
  return undefined;
}

function agentPreview(
  sources: InspectorReadinessSource[],
  concepts: InspectorConcept[]
): InspectorReport["agentPreview"] {
  const firstConcept = concepts[0];
  const firstSource = sources.find((source) => source.availabilityStatus === "available");
  const sourceHint = sources.length > 1 && firstSource ? `, "source": "${firstSource.name}"` : "";
  const readId = firstConcept?.id ?? "concept-id";
  const sequence: InspectorAgentStep[] = [
    {
      tool: "bundle_summary",
      name: "bundle_summary",
      purpose: "Start with validation, source freshness, and available concept counts.",
      example: "bundle_summary({})"
    },
    {
      tool: "search_concepts",
      name: "search_concepts",
      purpose: "Search for the docs concept that matches the task before reading.",
      example: `search_concepts({ "query": "setup"${sourceHint}, "limit": 5 })`
    },
    {
      tool: "read_concept",
      name: "read_concept",
      purpose: "Read only the selected concept and cite its source resource.",
      example: `read_concept({ "id": "${readId}"${sourceHint} })`
    },
    {
      tool: "get_neighbors",
      name: "get_neighbors",
      purpose: "Traverse outbound links and backlinks when adjacent docs matter.",
      example: `get_neighbors({ "id": "${readId}"${sourceHint}, "depth": 1 })`
    }
  ];
  return {
    sequence,
    tools: sequence.map((step) => ({ name: step.tool, purpose: step.purpose })),
    citationGuidance:
      sources.length > 1
        ? "Use source filters when the library is known, then cite source_resource URLs from read_concept results."
        : "Cite source_resource URLs from read_concept results when available.",
    suggestedQuestions: suggestedQuestions(sources, concepts)
  };
}

function suggestedQuestions(
  sources: InspectorReadinessSource[],
  concepts: InspectorConcept[]
): string[] {
  const firstSource = sources.find((source) => source.availabilityStatus === "available");
  const firstConcept = concepts[0];
  const questions = [
    firstSource
      ? `In ${firstSource.name}, what should I read first to get started?`
      : "What concepts are available in this OKF bundle?",
    firstConcept
      ? `Read ${firstConcept.ref} and cite the source URL.`
      : "Search the OKF bundle and cite the most relevant source URL.",
    "What related concepts should I inspect next with get_neighbors?"
  ];
  return [...new Set(questions)];
}

function localBundleRecord(bundleDir: string, sourceName: string): WorkspaceSourceRecord {
  const timestamp = "1970-01-01T00:00:00.000Z";
  return {
    name: sourceName,
    dir: bundleDir,
    bundleDir,
    manifest: {
      schemaVersion: 1,
      okfyVersion: "local",
      name: sourceName,
      kind: "local",
      createdAt: timestamp,
      updatedAt: timestamp,
      source: {
        seedUrl: pathToFileURL(bundleDir).href
      },
      crawl: {
        maxPages: 0,
        maxDepth: 0,
        include: [],
        exclude: [],
        sameOrigin: true,
        respectRobots: true,
        concurrency: 1,
        allowPrivateNetwork: false
      },
      refresh: {
        mode: "off",
        maxAgeSeconds: 0,
        minIntervalSeconds: 0
      },
      bundle: {
        dir: bundleDir
      }
    }
  };
}

function bundleSourceName(bundleDir: string): string {
  return (
    path
      .basename(bundleDir)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^[._-]+|[._-]+$/g, "") || "bundle"
  );
}

function brokenLinkCount(issues: ValidationIssue[]): number {
  return issues.filter((issue) => issue.code === "broken_internal_link").length;
}

function normalizeError(error: unknown): InspectorError | null {
  if (!error) return null;
  if (error instanceof Error) {
    const details: InspectorError = { message: error.message };
    if ("code" in error && typeof error.code === "string") details.code = error.code;
    return details;
  }
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    return {
      ...record,
      message: typeof record.message === "string" ? record.message : "Inspector source failed."
    };
  }
  return { message: String(error) };
}

function sum(sources: InspectorReadinessSource[], key: "conceptCount" | "warningCount" | "brokenLinkCount"): number {
  return sources.reduce((total, source) => total + source[key], 0);
}

function latest(values: string[]): string | null {
  return values.sort().at(-1) ?? null;
}

function earliest(values: string[]): string | null {
  return values.sort()[0] ?? null;
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
