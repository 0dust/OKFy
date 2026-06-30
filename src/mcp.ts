import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { packageVersion } from "./metadata.js";
import {
  BUNDLE_SUMMARY_TOOL,
  GET_NEIGHBORS_TOOL,
  LIST_TAGS_TOOL,
  LIST_TYPES_TOOL,
  READ_CONCEPT_TOOL,
  SEARCH_CONCEPTS_TOOL,
  mcpToolDefinitions,
  neighborsSchema,
  readSchema,
  refreshableTool,
  searchSchema,
  sourceFilterSchema,
  workspaceNeighborsSchema,
  workspaceReadSchema,
  workspaceSearchSchema
} from "./mcp-contract.js";
export { MCP_TOOL_NAMES } from "./mcp-contract.js";
import { argumentError, json, toolError } from "./mcp-results.js";
import {
  errorDetails,
  normalizeFreshness,
  shouldRefresh,
  type FreshnessState,
  type RefreshErrorDetails,
  type RefreshHooks,
  type RefreshMode,
  type SourceMetadata,
  type WorkspaceSourceRuntime
} from "./mcp-source-runtime.js";
export type {
  FreshnessState,
  FreshnessStatus,
  RefreshContext,
  RefreshErrorDetails,
  RefreshHooks,
  RefreshMode,
  RefreshResult,
  SourceMetadata
} from "./mcp-source-runtime.js";
import { BundleSearch } from "./search.js";
import { inspectBundle, validateBundle } from "./validate.js";
import {
  WorkspaceError,
  WorkspaceSearch,
  type WorkspaceSearchSource,
  type WorkspaceSourceRecord
} from "./workspace.js";

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

type NeighborEdge = {
  from: string;
  to: string;
  direction: "outbound" | "backlink";
  relationship_text?: string;
};

function collectNeighbors(
  search: BundleSearch,
  rootId: string,
  depth: number
): { conceptIds: string[]; edges: NeighborEdge[] } {
  const seen = new Set([rootId]);
  let frontier = [rootId];
  const edges: NeighborEdge[] = [];

  for (let level = 0; level < depth; level += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const to of search.graph.outbound.get(id) ?? []) {
        edges.push({
          from: id,
          to,
          direction: "outbound",
          relationship_text: "Markdown link"
        });
        if (!seen.has(to)) next.push(to);
        seen.add(to);
      }
      for (const from of search.graph.backlinks.get(id) ?? []) {
        edges.push({ from, to: id, direction: "backlink", relationship_text: "Backlink" });
        if (!seen.has(from)) next.push(from);
        seen.add(from);
      }
    }
    frontier = next;
  }

  return { conceptIds: [...seen], edges };
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
    { name: options.name ?? "okfy", version: packageVersion() },
    { capabilities: { tools: {} } }
  );
  const maxResultChars = options.maxResultChars ?? 12000;
  const refreshMode = (): RefreshMode =>
    options.refresh?.mode ?? (options.source ? "stale-while-refresh" : "off");

  async function getFreshness(): Promise<FreshnessState> {
    if (options.refresh?.getFreshness) {
      observedFreshness = await options.refresh.getFreshness();
      return observedFreshness;
    }
    observedFreshness ??= {
      freshnessStatus: search ? "fresh" : "missing",
      refreshInProgress: false,
      lastRefreshError: null
    };
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
    return toolError(
      {
        code: "bundle_unavailable",
        message: details.message,
        sourceName: options.source?.name,
        seedUrl: options.source?.seedUrl,
        lastRefreshError: details
      },
      maxResultChars
    );
  }

  function startRefresh(
    mode: Exclude<RefreshMode, "off">,
    freshness: FreshnessState
  ): Promise<void> | undefined {
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
    tools: mcpToolDefinitions("bundle")
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
        if (!concept)
          return toolError(
            { code: "unknown_concept", message: `No concept found for ${parsed.id}` },
            maxResultChars
          );
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
        if (!root)
          return toolError(
            { code: "unknown_concept", message: `No concept found for ${parsed.id}` },
            maxResultChars
          );
        const neighbors = collectNeighbors(currentSearch, root.id, parsed.depth ?? 1);
        return json(
          {
            root: root.id,
            concepts: neighbors.conceptIds.map((id) => {
              const concept = currentSearch.graph.concepts.get(id);
              return {
                id,
                title: concept?.title,
                type: concept?.type,
                resource: concept?.resource
              };
            }),
            edges: neighbors.edges
          },
          maxResultChars
        );
      }
      if (request.params.name === LIST_TYPES_TOOL) {
        if (!search) return bundleUnavailable();
        const stats = await inspectBundle(activeBundleDir);
        return json(stats.typeDistribution, maxResultChars);
      }
      if (request.params.name === LIST_TAGS_TOOL) {
        if (!search) return bundleUnavailable();
        const stats = await inspectBundle(activeBundleDir);
        return json(stats.tagDistribution, maxResultChars);
      }
      if (request.params.name === BUNDLE_SUMMARY_TOOL) {
        if (!search) return bundleUnavailable();
        const [stats, validation] = await Promise.all([
          inspectBundle(activeBundleDir),
          validateBundle(activeBundleDir)
        ]);
        return json(
          {
            ...stats,
            reservedFileCount: validation.reservedFileCount,
            warningCount: validation.warningCount,
            validationStatus: validation.valid ? "valid" : "invalid",
            validationIssues: validation.issues,
            ...sourceSummaryFields()
          },
          maxResultChars
        );
      }
      return toolError(
        { code: "unknown_tool", message: `Unknown tool: ${request.params.name}` },
        maxResultChars
      );
    } catch (error: any) {
      if (error instanceof z.ZodError) return toolError(argumentError(error), maxResultChars);
      return toolError(
        { code: "tool_error", message: error?.message ?? "Tool failed." },
        maxResultChars
      );
    }
  });
  return server;
}

export async function createWorkspaceMcpServer(options: WorkspaceServeOptions): Promise<Server> {
  const maxResultChars = options.maxResultChars ?? 12000;
  const runtimes: WorkspaceSourceRuntime[] = await Promise.all(
    options.sources.map(async (source) => {
      const runtime: WorkspaceSourceRuntime = {
        record: source.record,
        activeBundleDir: source.record.bundleDir,
        search: source.search,
        lastRefreshError: source.record.loadError ? errorDetails(source.record.loadError) : null,
        refresh: source.refresh
      };
      if (!runtime.search) {
        try {
          runtime.search = await BundleSearch.fromBundle(runtime.activeBundleDir);
        } catch (error) {
          runtime.lastRefreshError ??= errorDetails(error);
        }
      }
      return runtime;
    })
  );
  const selectedNames = new Set(runtimes.map((runtime) => runtime.record.name));
  const availableNames = new Set([...(options.availableSourceNames ?? []), ...selectedNames]);

  const server = new Server(
    { name: options.name ?? "okfy", version: packageVersion() },
    { capabilities: { tools: {} } }
  );

  function runtimeForSource(sourceName: string): WorkspaceSourceRuntime {
    if (selectedNames.has(sourceName))
      return runtimes.find((runtime) => runtime.record.name === sourceName)!;
    if (availableNames.has(sourceName)) {
      throw new WorkspaceError(
        "source_not_in_workspace",
        `Source "${sourceName}" is not selected in this workspace.`,
        {
          source: sourceName,
          workspaceSources: [...selectedNames]
        }
      );
    }
    throw new WorkspaceError("unknown_source", `Unknown source "${sourceName}".`, {
      source: sourceName
    });
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
    if (runtime.record.loadError) {
      const freshness = runtime.observedFreshness ?? {
        freshnessStatus: "failed",
        refreshInProgress: false,
        lastRefreshError: errorDetails(runtime.record.loadError)
      };
      runtime.observedFreshness = freshness;
      return freshness;
    }
    if (runtime.refresh?.getFreshness) {
      runtime.observedFreshness = await runtime.refresh.getFreshness();
      return runtime.observedFreshness;
    }
    runtime.observedFreshness ??= {
      freshnessStatus: runtime.search ? "fresh" : "missing",
      refreshInProgress: false,
      lastRefreshError: null
    };
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
      const shouldAwait = sourceFiltered
        ? mode === "blocking" || !runtime.search
        : !workspaceHadUsableSource && !runtime.search;
      if (shouldAwait) await refresh;
    } catch (error) {
      runtime.lastRefreshError = errorDetails(error);
    }
  }

  async function prepareWorkspaceForTool(toolName: string, sourceName?: string): Promise<void> {
    if (!refreshableTool(toolName)) return;
    const selected = sourceName ? [runtimeForSource(sourceName)] : runtimes;
    const workspaceHadUsableSource = selected.some((runtime) => runtime.search);
    await Promise.all(
      selected.map((runtime) =>
        prepareRuntime(runtime, toolName, Boolean(sourceName), workspaceHadUsableSource)
      )
    );
  }

  function workspaceUnavailable() {
    return toolError(
      {
        code: "bundle_unavailable",
        message: "No usable OKF bundle is available in this workspace.",
        sources: runtimes.map((runtime) => ({
          sourceName: runtime.record.name,
          seedUrl: runtime.record.manifest.source.seedUrl,
          lastRefreshError: runtime.lastRefreshError
        }))
      },
      maxResultChars
    );
  }

  function sourceUnavailable(runtime: WorkspaceSourceRuntime) {
    const details =
      runtime.lastRefreshError ?? errorDetails("No OKF bundle is available for this source.");
    return toolError(
      {
        code: "bundle_unavailable",
        message: details.message,
        sourceName: runtime.record.name,
        seedUrl: runtime.record.manifest.source.seedUrl,
        lastRefreshError: details
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
      [stats, validation] = await Promise.all([
        inspectBundle(runtime.activeBundleDir),
        validateBundle(runtime.activeBundleDir)
      ]);
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
      conceptCount:
        runtime.search?.graph.concepts.size ?? runtime.record.state?.bundle?.conceptCount ?? 0,
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
    const reservedFileCount = sources.reduce(
      (sum, source) => sum + numberField(source.reservedFileCount),
      0
    );
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
      validationStatus: sources.some((source) => source.validationStatus !== "valid")
        ? "invalid"
        : "valid",
      typeDistribution,
      tagDistribution,
      sources
    };
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: mcpToolDefinitions("workspace")
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    try {
      const sourceName = sourceFilterSchema.partial().parse(args).source;
      if (request.params.name === BUNDLE_SUMMARY_TOOL) {
        return json(await workspaceSummary(sourceName), maxResultChars);
      }

      await prepareWorkspaceForTool(request.params.name, sourceName);
      if (sourceName) {
        const runtime = runtimeForSource(sourceName);
        if (!runtime.search) return sourceUnavailable(runtime);
      }
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
        const neighbors = collectNeighbors(currentSearch, root.id, parsed.depth ?? 1);
        return json({
          sourceName: source.record.name,
          sourceKind: source.record.manifest.kind,
          seedUrl: source.record.manifest.source.seedUrl,
          root: root.id,
          ref: `${source.record.name}:${root.id}`,
          concepts: neighbors.conceptIds.map((id) => {
            const concept = currentSearch.graph.concepts.get(id);
            return {
              sourceName: source.record.name,
              id,
              ref: `${source.record.name}:${id}`,
              title: concept?.title,
              type: concept?.type,
              resource: concept?.resource
            };
          }),
          edges: neighbors.edges.map((edge) => ({ ...edge, sourceName: source.record.name }))
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
      return toolError(
        { code: "unknown_tool", message: `Unknown tool: ${request.params.name}` },
        maxResultChars
      );
    } catch (error: any) {
      if (error instanceof WorkspaceError) return toolError(error.toJSON(), maxResultChars);
      if (error instanceof z.ZodError) return toolError(argumentError(error), maxResultChars);
      return toolError(
        { code: "tool_error", message: error?.message ?? "Tool failed." },
        maxResultChars
      );
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
