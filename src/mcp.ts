import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { BundleSearch } from "./search.js";
import { inspectBundle, validateBundle } from "./validate.js";
import { WorkspaceError, WorkspaceSearch, type WorkspaceSearchSource, type WorkspaceSourceRecord } from "./workspace.js";

export type RefreshMode = "off" | "stale-while-refresh" | "blocking";
export type FreshnessStatus = "fresh" | "stale" | "missing" | "failed" | "refreshing";

export const MCP_TOOL_NAMES = [
  "search_concepts",
  "read_concept",
  "get_neighbors",
  "list_types",
  "list_tags",
  "bundle_summary"
] as const;

const [
  SEARCH_CONCEPTS_TOOL,
  READ_CONCEPT_TOOL,
  GET_NEIGHBORS_TOOL,
  LIST_TYPES_TOOL,
  LIST_TAGS_TOOL,
  BUNDLE_SUMMARY_TOOL
] = MCP_TOOL_NAMES;
const REFRESHABLE_TOOL_NAMES = new Set<string>(MCP_TOOL_NAMES.filter((tool) => tool !== BUNDLE_SUMMARY_TOOL));

export type SourceMetadata = {
  name: string;
  kind: string;
  seedUrl: string;
};

export type RefreshErrorDetails = {
  code?: string;
  message: string;
  [key: string]: unknown;
};

export type FreshnessState = {
  freshnessStatus?: FreshnessStatus;
  status?: FreshnessStatus;
  lastSuccessfulRefreshAt?: string | null;
  refreshInProgress?: boolean;
  lastRefreshError?: RefreshErrorDetails | string | Error | null;
  lastError?: RefreshErrorDetails | string | Error | null;
  nextRefreshAllowedAt?: string | null;
};

export type RefreshContext = {
  mode: Exclude<RefreshMode, "off">;
  bundleDir: string;
  source?: SourceMetadata;
  freshness: FreshnessState;
};

export type RefreshResult = {
  bundleDir?: string;
  freshness?: FreshnessState;
};

export type RefreshHooks = {
  mode?: RefreshMode;
  getFreshness?: () => FreshnessState | Promise<FreshnessState>;
  refreshIfNeeded?: (context: RefreshContext) => void | RefreshResult | Promise<void | RefreshResult>;
};

export type ServeOptions = {
  bundleDir: string;
  name?: string;
  maxResultChars?: number;
  search?: BundleSearch;
  source?: SourceMetadata;
  refresh?: RefreshHooks;
};

export type WorkspaceServeSource = {
  record: WorkspaceSourceRecord;
  search?: BundleSearch;
  refresh?: RefreshHooks;
};

export type WorkspaceServeOptions = {
  sources: WorkspaceServeSource[];
  name?: string;
  maxResultChars?: number;
  availableSourceNames?: string[];
};

function json(value: unknown, maxChars = 12000): { content: Array<{ type: "text"; text: string }> } {
  let text = JSON.stringify(value, null, 2);
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}\n...truncated`;
  return { content: [{ type: "text", text }] };
}

const searchSchema = z.object({
  query: z.string(),
  type: z.string().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(50).optional()
});
const readSchema = z.object({ id: z.string(), max_chars: z.number().int().positive().optional() });
const neighborsSchema = z.object({ id: z.string(), depth: z.number().int().min(1).max(2).optional() });
const sourceFilterSchema = z.object({ source: z.string().optional() });
const workspaceSearchSchema = searchSchema.extend({ source: z.string().optional() });
const workspaceReadSchema = readSchema.extend({ source: z.string().optional() });
const workspaceNeighborsSchema = neighborsSchema.extend({ source: z.string().optional() });

function errorDetails(error: unknown): RefreshErrorDetails {
  if (error instanceof Error) return { message: error.message };
  if (typeof error === "string") return { message: error };
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    return {
      ...record,
      message: typeof record.message === "string" ? record.message : "Refresh failed."
    };
  }
  return { message: "Refresh failed." };
}

function nullableErrorDetails(error: FreshnessState["lastRefreshError"]): RefreshErrorDetails | null {
  if (error === undefined || error === null) return null;
  return errorDetails(error);
}

function normalizeFreshness(state: FreshnessState | undefined): {
  freshnessStatus?: FreshnessStatus;
  lastSuccessfulRefreshAt: string | null;
  refreshInProgress: boolean;
  lastRefreshError: RefreshErrorDetails | null;
  nextRefreshAllowedAt: string | null;
} {
  return {
    freshnessStatus: state?.freshnessStatus ?? state?.status,
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    refreshInProgress: Boolean(state?.refreshInProgress),
    lastRefreshError: nullableErrorDetails(state?.lastRefreshError ?? state?.lastError),
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null
  };
}

function shouldRefresh(status: FreshnessStatus | undefined, hasSearch: boolean): boolean {
  if (!hasSearch) return status !== "fresh";
  return status === "stale" || status === "missing" || status === "failed";
}

function refreshableTool(name: string): boolean {
  return REFRESHABLE_TOOL_NAMES.has(name);
}

export async function createMcpServer(options: ServeOptions): Promise<Server> {
  let activeBundleDir = options.bundleDir;
  let search: BundleSearch | undefined = options.search;
  let observedFreshness: FreshnessState | undefined;
  let lastRefreshError: RefreshErrorDetails | null = null;
  let inFlightRefresh: Promise<void> | undefined;

  if (!search) {
    try {
      search = await BundleSearch.fromBundle(activeBundleDir);
    } catch (error) {
      if (!options.source) throw error;
      lastRefreshError = errorDetails(error);
    }
  }

  const server = new Server(
    { name: options.name ?? "okfy", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
  const maxResultChars = options.maxResultChars ?? 12000;
  const refreshMode = (): RefreshMode => options.refresh?.mode ?? (options.source ? "stale-while-refresh" : "off");

  async function getFreshness(): Promise<FreshnessState> {
    if (options.refresh?.getFreshness) {
      observedFreshness = await options.refresh.getFreshness();
      return observedFreshness;
    }
    observedFreshness ??= { freshnessStatus: search ? "fresh" : "missing", refreshInProgress: false, lastRefreshError: null };
    return observedFreshness;
  }

  function sourceSummaryFields(): Record<string, unknown> {
    if (!options.source) return {};
    const normalized = normalizeFreshness(observedFreshness);
    const lastError = lastRefreshError ?? normalized.lastRefreshError;
    const status = lastError
      ? "failed"
      : (normalized.freshnessStatus ?? (search ? "fresh" : "missing"));
    return {
      sourceName: options.source.name,
      sourceKind: options.source.kind,
      seedUrl: options.source.seedUrl,
      freshnessStatus: status,
      lastSuccessfulRefreshAt: normalized.lastSuccessfulRefreshAt,
      refreshInProgress: Boolean(inFlightRefresh) || normalized.refreshInProgress,
      lastRefreshError: lastError,
      nextRefreshAllowedAt: normalized.nextRefreshAllowedAt
    };
  }

  function bundleUnavailable() {
    const details = lastRefreshError ?? errorDetails("No OKF bundle is available.");
    return json(
      {
        error: {
          code: "bundle_unavailable",
          message: details.message,
          sourceName: options.source?.name,
          seedUrl: options.source?.seedUrl,
          lastRefreshError: details
        }
      },
      maxResultChars
    );
  }

  function startRefresh(mode: Exclude<RefreshMode, "off">, freshness: FreshnessState): Promise<void> | undefined {
    if (!options.refresh?.refreshIfNeeded) return undefined;
    if (inFlightRefresh) return inFlightRefresh;
    inFlightRefresh = (async () => {
      try {
        const result = await options.refresh?.refreshIfNeeded?.({
          mode,
          bundleDir: activeBundleDir,
          source: options.source,
          freshness
        });
        if (result?.freshness) observedFreshness = result.freshness;
        const nextBundleDir = result?.bundleDir ?? activeBundleDir;
        const nextSearch = await BundleSearch.fromBundle(nextBundleDir);
        activeBundleDir = nextBundleDir;
        search = nextSearch;
        lastRefreshError = null;
      } catch (error) {
        lastRefreshError = errorDetails(error);
      } finally {
        inFlightRefresh = undefined;
      }
    })();
    return inFlightRefresh;
  }

  async function prepareBundleForTool(toolName: string): Promise<void> {
    const mode = refreshMode();
    if (mode === "off" || !refreshableTool(toolName)) return;

    const freshness = await getFreshness();
    const normalized = normalizeFreshness(freshness);
    if (!shouldRefresh(normalized.freshnessStatus, Boolean(search))) return;

    const refresh = startRefresh(mode, freshness);
    if (!refresh) return;
    if (mode === "blocking" || !search) await refresh;
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: SEARCH_CONCEPTS_TOOL,
        description: "Search OKF concepts by query, type, and tags.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            type: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            limit: { type: "number", default: 10 }
          },
          required: ["query"]
        }
      },
      {
        name: READ_CONCEPT_TOOL,
        description: "Read one OKF concept by id or path.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" }, max_chars: { type: "number" } },
          required: ["id"]
        }
      },
      {
        name: GET_NEIGHBORS_TOOL,
        description: "Return outbound links and backlinks for a concept.",
        inputSchema: {
          type: "object",
          properties: { id: { type: "string" }, depth: { type: "number", default: 1 } },
          required: ["id"]
        }
      },
      { name: LIST_TYPES_TOOL, description: "List concept types and counts.", inputSchema: { type: "object", properties: {} } },
      { name: LIST_TAGS_TOOL, description: "List concept tags and counts.", inputSchema: { type: "object", properties: {} } },
      { name: BUNDLE_SUMMARY_TOOL, description: "Return bundle stats and validation status.", inputSchema: { type: "object", properties: {} } }
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    try {
      if (request.params.name === BUNDLE_SUMMARY_TOOL && options.source) await getFreshness();
      await prepareBundleForTool(request.params.name);
      if (request.params.name === SEARCH_CONCEPTS_TOOL) {
        if (!search) return bundleUnavailable();
        const parsed = searchSchema.parse(args);
        return json(search.search(parsed.query, parsed), maxResultChars);
      }
      if (request.params.name === READ_CONCEPT_TOOL) {
        if (!search) return bundleUnavailable();
        const parsed = readSchema.parse(args);
        const concept = search.getConcept(parsed.id);
        if (!concept) return json({ error: { code: "unknown_concept", message: `No concept found for ${parsed.id}` } });
        const max = parsed.max_chars ?? maxResultChars;
        return json(
          {
            frontmatter: concept.frontmatter,
            markdown_body: concept.body.slice(0, max),
            outbound_links: search.graph.outbound.get(concept.id) ?? [],
            backlinks: search.graph.backlinks.get(concept.id) ?? [],
            source_resource: concept.resource
          },
          maxResultChars
        );
      }
      if (request.params.name === GET_NEIGHBORS_TOOL) {
        if (!search) return bundleUnavailable();
        const currentSearch = search;
        const parsed = neighborsSchema.parse(args);
        const root = currentSearch.getConcept(parsed.id);
        if (!root) return json({ error: { code: "unknown_concept", message: `No concept found for ${parsed.id}` } });
        const depth = parsed.depth ?? 1;
        const seen = new Set([root.id]);
        let frontier = [root.id];
        const edges: Array<{ from: string; to: string; direction: "outbound" | "backlink"; relationship_text?: string }> = [];
        for (let level = 0; level < depth; level += 1) {
          const next: string[] = [];
          for (const id of frontier) {
            for (const to of currentSearch.graph.outbound.get(id) ?? []) {
              edges.push({ from: id, to, direction: "outbound", relationship_text: "Markdown link" });
              if (!seen.has(to)) next.push(to);
              seen.add(to);
            }
            for (const from of currentSearch.graph.backlinks.get(id) ?? []) {
              edges.push({ from, to: id, direction: "backlink", relationship_text: "Backlink" });
              if (!seen.has(from)) next.push(from);
              seen.add(from);
            }
          }
          frontier = next;
        }
        return json({
          root: root.id,
          concepts: [...seen].map((id) => {
            const concept = currentSearch.graph.concepts.get(id);
            return { id, title: concept?.title, type: concept?.type, resource: concept?.resource };
          }),
          edges
        });
      }
      if (request.params.name === LIST_TYPES_TOOL) {
        if (!search) return bundleUnavailable();
        const stats = await inspectBundle(activeBundleDir);
        return json(stats.typeDistribution);
      }
      if (request.params.name === LIST_TAGS_TOOL) {
        if (!search) return bundleUnavailable();
        const stats = await inspectBundle(activeBundleDir);
        return json(stats.tagDistribution);
      }
      if (request.params.name === BUNDLE_SUMMARY_TOOL) {
        if (!search) return bundleUnavailable();
        const [stats, validation] = await Promise.all([inspectBundle(activeBundleDir), validateBundle(activeBundleDir)]);
        return json({
          ...stats,
          reservedFileCount: validation.reservedFileCount,
          warningCount: validation.warningCount,
          validationStatus: validation.valid ? "valid" : "invalid",
          validationIssues: validation.issues,
          ...sourceSummaryFields()
        });
      }
      return json({ error: { code: "unknown_tool", message: `Unknown tool: ${request.params.name}` } });
    } catch (error: any) {
      return json({ error: { code: "tool_error", message: error?.message ?? "Tool failed." } });
    }
  });
  return server;
}

type WorkspaceSourceRuntime = {
  record: WorkspaceSourceRecord;
  activeBundleDir: string;
  search?: BundleSearch;
  observedFreshness?: FreshnessState;
  lastRefreshError: RefreshErrorDetails | null;
  inFlightRefresh?: Promise<void>;
  refresh?: RefreshHooks;
};

export async function createWorkspaceMcpServer(options: WorkspaceServeOptions): Promise<Server> {
  const maxResultChars = options.maxResultChars ?? 12000;
  const runtimes: WorkspaceSourceRuntime[] = await Promise.all(
    options.sources.map(async (source) => {
      const runtime: WorkspaceSourceRuntime = {
        record: source.record,
        activeBundleDir: source.record.bundleDir,
        search: source.search,
        lastRefreshError: null,
        refresh: source.refresh
      };
      if (!runtime.search) {
        runtime.search = await BundleSearch.fromBundle(runtime.activeBundleDir);
      }
      return runtime;
    })
  );
  const selectedNames = new Set(runtimes.map((runtime) => runtime.record.name));
  const availableNames = new Set([...(options.availableSourceNames ?? []), ...selectedNames]);

  const server = new Server(
    { name: options.name ?? "okfy", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );

  function runtimeForSource(sourceName: string): WorkspaceSourceRuntime {
    if (selectedNames.has(sourceName)) return runtimes.find((runtime) => runtime.record.name === sourceName)!;
    if (availableNames.has(sourceName)) {
      throw new WorkspaceError("source_not_in_workspace", `Source "${sourceName}" is not selected in this workspace.`, {
        source: sourceName,
        workspaceSources: [...selectedNames]
      });
    }
    throw new WorkspaceError("unknown_source", `Unknown source "${sourceName}".`, { source: sourceName });
  }

  function workspaceSearch(): WorkspaceSearch {
    return new WorkspaceSearch(
      runtimes.map(
        (runtime): WorkspaceSearchSource => ({
          record: runtime.record,
          bundleDir: runtime.activeBundleDir,
          search: runtime.search,
          loadError: runtime.lastRefreshError
        })
      ),
      { availableSourceNames: [...availableNames] }
    );
  }

  async function getRuntimeFreshness(runtime: WorkspaceSourceRuntime): Promise<FreshnessState> {
    if (runtime.refresh?.getFreshness) {
      runtime.observedFreshness = await runtime.refresh.getFreshness();
      return runtime.observedFreshness;
    }
    runtime.observedFreshness ??= { freshnessStatus: runtime.search ? "fresh" : "missing", refreshInProgress: false, lastRefreshError: null };
    return runtime.observedFreshness;
  }

  function runtimeRefreshMode(runtime: WorkspaceSourceRuntime): RefreshMode {
    return runtime.refresh?.mode ?? "stale-while-refresh";
  }

  function sourceSummaryFields(runtime: WorkspaceSourceRuntime): Record<string, unknown> {
    const normalized = normalizeFreshness(runtime.observedFreshness);
    const lastError = runtime.lastRefreshError ?? normalized.lastRefreshError;
    const refreshing = Boolean(runtime.inFlightRefresh) || normalized.refreshInProgress;
    const status = refreshing
      ? "refreshing"
      : lastError
      ? "failed"
      : (normalized.freshnessStatus ?? (runtime.search ? "fresh" : "missing"));
    return {
      sourceName: runtime.record.name,
      sourceKind: runtime.record.manifest.kind,
      seedUrl: runtime.record.manifest.source.seedUrl,
      freshnessStatus: status,
      lastSuccessfulRefreshAt: normalized.lastSuccessfulRefreshAt,
      refreshInProgress: refreshing,
      lastRefreshError: lastError,
      nextRefreshAllowedAt: normalized.nextRefreshAllowedAt
    };
  }

  function startRuntimeRefresh(
    runtime: WorkspaceSourceRuntime,
    mode: Exclude<RefreshMode, "off">,
    freshness: FreshnessState
  ): Promise<void> | undefined {
    if (!runtime.refresh?.refreshIfNeeded) return undefined;
    if (runtime.inFlightRefresh) return runtime.inFlightRefresh;
    runtime.inFlightRefresh = (async () => {
      try {
        const result = await runtime.refresh?.refreshIfNeeded?.({
          mode,
          bundleDir: runtime.activeBundleDir,
          source: {
            name: runtime.record.name,
            kind: runtime.record.manifest.kind,
            seedUrl: runtime.record.manifest.source.seedUrl
          },
          freshness
        });
        if (result?.freshness) runtime.observedFreshness = result.freshness;
        const nextBundleDir = result?.bundleDir ?? runtime.activeBundleDir;
        runtime.search = await BundleSearch.fromBundle(nextBundleDir);
        runtime.activeBundleDir = nextBundleDir;
        runtime.lastRefreshError = null;
      } catch (error) {
        runtime.lastRefreshError = errorDetails(error);
      } finally {
        runtime.inFlightRefresh = undefined;
      }
    })();
    return runtime.inFlightRefresh;
  }

  async function prepareRuntime(
    runtime: WorkspaceSourceRuntime,
    toolName: string,
    sourceFiltered: boolean,
    workspaceHadUsableSource: boolean
  ): Promise<void> {
    try {
      const mode = runtimeRefreshMode(runtime);
      if (mode === "off" || !refreshableTool(toolName)) return;

      const freshness = await getRuntimeFreshness(runtime);
      const normalized = normalizeFreshness(freshness);
      if (!shouldRefresh(normalized.freshnessStatus, Boolean(runtime.search))) return;

      const refresh = startRuntimeRefresh(runtime, mode, freshness);
      if (!refresh) return;
      const shouldAwait = sourceFiltered ? mode === "blocking" || !runtime.search : !workspaceHadUsableSource && !runtime.search;
      if (shouldAwait) await refresh;
    } catch (error) {
      runtime.lastRefreshError = errorDetails(error);
    }
  }

  async function prepareWorkspaceForTool(toolName: string, sourceName?: string): Promise<void> {
    if (!refreshableTool(toolName)) return;
    const selected = sourceName ? [runtimeForSource(sourceName)] : runtimes;
    const workspaceHadUsableSource = selected.some((runtime) => runtime.search);
    await Promise.all(selected.map((runtime) => prepareRuntime(runtime, toolName, Boolean(sourceName), workspaceHadUsableSource)));
  }

  function workspaceUnavailable() {
    return json(
      {
        error: {
          code: "bundle_unavailable",
          message: "No usable OKF bundle is available in this workspace.",
          sources: runtimes.map((runtime) => ({
            sourceName: runtime.record.name,
            seedUrl: runtime.record.manifest.source.seedUrl,
            lastRefreshError: runtime.lastRefreshError
          }))
        }
      },
      maxResultChars
    );
  }

  async function sourceSummary(runtime: WorkspaceSourceRuntime): Promise<Record<string, unknown>> {
    try {
      await getRuntimeFreshness(runtime);
    } catch (error) {
      runtime.lastRefreshError = errorDetails(error);
    }
    const freshness = sourceSummaryFields(runtime);
    if (!runtime.search) {
      return unavailableSourceSummary(runtime);
    }
    let stats: Awaited<ReturnType<typeof inspectBundle>>;
    let validation: Awaited<ReturnType<typeof validateBundle>>;
    try {
      [stats, validation] = await Promise.all([inspectBundle(runtime.activeBundleDir), validateBundle(runtime.activeBundleDir)]);
    } catch (error) {
      runtime.lastRefreshError = errorDetails(error);
      return unavailableSourceSummary(runtime);
    }
    return {
      ...freshness,
      bundleDir: runtime.activeBundleDir,
      conceptCount: stats.conceptCount,
      reservedFileCount: validation.reservedFileCount,
      warningCount: validation.warningCount,
      validationStatus: validation.valid ? "valid" : "invalid",
      validationIssues: validation.issues,
      typeDistribution: stats.typeDistribution,
      tagDistribution: stats.tagDistribution,
      linkCount: stats.linkCount,
      brokenLinks: stats.brokenLinks,
      orphanConcepts: stats.orphanConcepts,
      sourceDomains: stats.sourceDomains
    };
  }

  function unavailableSourceSummary(runtime: WorkspaceSourceRuntime): Record<string, unknown> {
    return {
      ...sourceSummaryFields(runtime),
      bundleDir: runtime.activeBundleDir,
      conceptCount: runtime.search?.graph.concepts.size ?? runtime.record.state?.bundle?.conceptCount ?? 0,
      reservedFileCount: 0,
      warningCount: runtime.record.state?.bundle?.warningCount ?? 0,
      validationStatus: "unavailable",
      validationIssues: []
    };
  }

  async function workspaceSummary(sourceName?: string): Promise<Record<string, unknown>> {
    const selected = sourceName ? [runtimeForSource(sourceName)] : runtimes;
    const sources = await Promise.all(selected.map(sourceSummary));
    const usableSourceCount = selected.filter((runtime) => runtime.search).length;
    const conceptCount = sources.reduce((sum, source) => sum + numberField(source.conceptCount), 0);
    const reservedFileCount = sources.reduce((sum, source) => sum + numberField(source.reservedFileCount), 0);
    const warningCount = sources.reduce((sum, source) => sum + numberField(source.warningCount), 0);
    let typeDistribution: Record<string, number> = {};
    let tagDistribution: Record<string, number> = {};
    try {
      const workspace = workspaceSearch();
      typeDistribution = workspace.listTypes(sourceName);
      tagDistribution = workspace.listTags(sourceName);
    } catch (error) {
      if (!(error instanceof WorkspaceError) || error.code !== "no_usable_sources") throw error;
    }

    return {
      workspace: true,
      sourceCount: selected.length,
      usableSourceCount,
      conceptCount,
      reservedFileCount,
      warningCount,
      validationStatus: sources.some((source) => source.validationStatus !== "valid") ? "invalid" : "valid",
      typeDistribution,
      tagDistribution,
      sources
    };
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: SEARCH_CONCEPTS_TOOL,
        description: "Search workspace OKF concepts by query, source, type, and tags.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
            source: { type: "string" },
            type: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            limit: { type: "number", default: 10 }
          },
          required: ["query"]
        }
      },
      {
        name: READ_CONCEPT_TOOL,
        description: "Read one workspace OKF concept by source and id. Id-only reads work when the id is unique.",
        inputSchema: {
          type: "object",
          properties: { source: { type: "string" }, id: { type: "string" }, max_chars: { type: "number" } },
          required: ["id"]
        }
      },
      {
        name: GET_NEIGHBORS_TOOL,
        description: "Return outbound links and backlinks for a workspace concept.",
        inputSchema: {
          type: "object",
          properties: { source: { type: "string" }, id: { type: "string" }, depth: { type: "number", default: 1 } },
          required: ["id"]
        }
      },
      {
        name: LIST_TYPES_TOOL,
        description: "List workspace concept types and counts.",
        inputSchema: { type: "object", properties: { source: { type: "string" } } }
      },
      {
        name: LIST_TAGS_TOOL,
        description: "List workspace concept tags and counts.",
        inputSchema: { type: "object", properties: { source: { type: "string" } } }
      },
      {
        name: BUNDLE_SUMMARY_TOOL,
        description: "Return workspace stats, per-source validation, and freshness status.",
        inputSchema: { type: "object", properties: { source: { type: "string" } } }
      }
    ]
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    try {
      const sourceName = sourceFilterSchema.partial().parse(args).source;
      if (request.params.name === BUNDLE_SUMMARY_TOOL) {
        return json(await workspaceSummary(sourceName), maxResultChars);
      }

      await prepareWorkspaceForTool(request.params.name, sourceName);
      const workspace = workspaceSearch();
      if (workspace.usableSourceNames().length === 0) return workspaceUnavailable();

      if (request.params.name === SEARCH_CONCEPTS_TOOL) {
        const parsed = workspaceSearchSchema.parse(args);
        return json(workspace.search(parsed.query, parsed), maxResultChars);
      }
      if (request.params.name === READ_CONCEPT_TOOL) {
        const parsed = workspaceReadSchema.parse(args);
        const { source, concept } = workspace.getConcept(parsed);
        const max = parsed.max_chars ?? maxResultChars;
        return json(
          {
            sourceName: source.record.name,
            sourceKind: source.record.manifest.kind,
            seedUrl: source.record.manifest.source.seedUrl,
            ref: `${source.record.name}:${concept.id}`,
            frontmatter: concept.frontmatter,
            markdown_body: concept.body.slice(0, max),
            outbound_links: source.search!.graph.outbound.get(concept.id) ?? [],
            backlinks: source.search!.graph.backlinks.get(concept.id) ?? [],
            source_resource: concept.resource
          },
          maxResultChars
        );
      }
      if (request.params.name === GET_NEIGHBORS_TOOL) {
        const parsed = workspaceNeighborsSchema.parse(args);
        const { source, concept: root } = workspace.getConcept(parsed);
        const currentSearch = source.search!;
        const depth = parsed.depth ?? 1;
        const seen = new Set([root.id]);
        let frontier = [root.id];
        const edges: Array<{ from: string; to: string; direction: "outbound" | "backlink"; relationship_text?: string; sourceName: string }> = [];
        for (let level = 0; level < depth; level += 1) {
          const next: string[] = [];
          for (const id of frontier) {
            for (const to of currentSearch.graph.outbound.get(id) ?? []) {
              edges.push({ from: id, to, direction: "outbound", relationship_text: "Markdown link", sourceName: source.record.name });
              if (!seen.has(to)) next.push(to);
              seen.add(to);
            }
            for (const from of currentSearch.graph.backlinks.get(id) ?? []) {
              edges.push({ from, to: id, direction: "backlink", relationship_text: "Backlink", sourceName: source.record.name });
              if (!seen.has(from)) next.push(from);
              seen.add(from);
            }
          }
          frontier = next;
        }
        return json({
          sourceName: source.record.name,
          sourceKind: source.record.manifest.kind,
          seedUrl: source.record.manifest.source.seedUrl,
          root: root.id,
          ref: `${source.record.name}:${root.id}`,
          concepts: [...seen].map((id) => {
            const concept = currentSearch.graph.concepts.get(id);
            return { sourceName: source.record.name, id, ref: `${source.record.name}:${id}`, title: concept?.title, type: concept?.type, resource: concept?.resource };
          }),
          edges
        });
      }
      if (request.params.name === LIST_TYPES_TOOL) {
        const parsed = sourceFilterSchema.parse(args);
        return json(workspace.listTypes(parsed.source), maxResultChars);
      }
      if (request.params.name === LIST_TAGS_TOOL) {
        const parsed = sourceFilterSchema.parse(args);
        return json(workspace.listTags(parsed.source), maxResultChars);
      }
      return json({ error: { code: "unknown_tool", message: `Unknown tool: ${request.params.name}` } });
    } catch (error: any) {
      if (error instanceof WorkspaceError) return json({ error: error.toJSON() }, maxResultChars);
      return json({ error: { code: "tool_error", message: error?.message ?? "Tool failed." } }, maxResultChars);
    }
  });

  return server;
}

function numberField(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

export async function serveMcpStdio(options: ServeOptions): Promise<void> {
  const server = await createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export async function serveWorkspaceMcpStdio(options: WorkspaceServeOptions): Promise<void> {
  const server = await createWorkspaceMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
