import { Server } from '@modelcontextprotocol/sdk/server/index.js';

type ContentType = "html" | "markdown" | "mdx" | "text";
type RawDocument = {
    sourceId: string;
    url?: string;
    filePath?: string;
    contentType: ContentType;
    raw: string;
    discoveredAt: string;
};
type NormalizedDocument = {
    sourceId: string;
    title: string;
    markdown: string;
    resource?: string;
    sourcePath?: string;
    outputPath?: string;
    headings: Array<{
        depth: number;
        text: string;
        slug: string;
    }>;
    links: Array<{
        href: string;
        text: string;
    }>;
    tags: string[];
    type: string;
};
type Concept = {
    id: string;
    path: string;
    frontmatter: Record<string, unknown>;
    type: string;
    title?: string;
    description?: string;
    resource?: string;
    tags: string[];
    body: string;
};
type KnowledgeGraph = {
    concepts: Map<string, Concept>;
    outbound: Map<string, string[]>;
    backlinks: Map<string, string[]>;
};
type ValidationIssue = {
    severity: "error" | "warning";
    code: string;
    message: string;
    path?: string;
};
type ValidationReport = {
    valid: boolean;
    issues: ValidationIssue[];
    conceptCount: number;
    reservedFileCount: number;
    warningCount: number;
};
type BundleStats = {
    title: string;
    conceptCount: number;
    reservedFileCount: number;
    warningCount: number;
    typeDistribution: Record<string, number>;
    tagDistribution: Record<string, number>;
    linkCount: number;
    brokenLinks: number;
    orphanConcepts: string[];
    topLinkedConcepts: Array<{
        id: string;
        title?: string;
        count: number;
    }>;
    sourceDomains: Record<string, number>;
};

type CrawlOptions = {
    seedUrl: string;
    outDir: string;
    maxPages?: number;
    maxDepth?: number;
    include?: string[];
    exclude?: string[];
    sameOrigin?: boolean;
    respectRobots?: boolean;
    concurrency?: number;
    title?: string;
    force?: boolean;
    dryRun?: boolean;
    allowPrivateNetwork?: boolean;
    dangerouslyAllowUnsafeOutput?: boolean;
    timestamp?: string;
    onProgress?: (event: CrawlProgressEvent) => void;
};
type CrawlProgressEvent = {
    type: "start";
    seed: string;
    maxPages: number;
    maxDepth: number;
} | {
    type: "fetch";
    url: string;
    fetched: number;
    queued: number;
    maxPages: number;
} | {
    type: "fetched";
    url: string;
    fetched: number;
    queued: number;
    discovered: number;
    maxPages: number;
} | {
    type: "skipped";
    url: string;
    fetched: number;
    queued: number;
    maxPages: number;
} | {
    type: "failed";
    url: string;
    fetched: number;
    queued: number;
    maxPages: number;
} | {
    type: "writing";
    concepts: number;
    outDir: string;
};
type CrawlResult = {
    pagesFetched: number;
    skipped: number;
    failed: number;
    written: string[];
    documents: NormalizedDocument[];
    dryRunPages?: string[];
};
declare function crawlWebsite(options: CrawlOptions): Promise<CrawlResult>;

declare function extractInternalLinks(concept: Concept): string[];
declare function buildGraph(conceptsByAnyKey: Map<string, Concept>): KnowledgeGraph;

type ImportOptions = {
    inputPath: string;
    outDir: string;
    sourceName?: string;
    include?: string[];
    exclude?: string[];
    force?: boolean;
    dangerouslyAllowUnsafeOutput?: boolean;
    timestamp?: string;
};
declare function importLocal(options: ImportOptions): Promise<{
    written: string[];
    documents: NormalizedDocument[];
}>;

type SearchResult = {
    id: string;
    title?: string;
    type: string;
    description?: string;
    tags: string[];
    resource?: string;
    snippet: string;
    score: number;
};
declare class BundleSearch {
    readonly graph: KnowledgeGraph;
    private readonly index;
    constructor(conceptsByAnyKey: Map<string, Concept>);
    static fromBundle(bundleDir: string): Promise<BundleSearch>;
    search(query: string, options?: {
        type?: string;
        tags?: string[];
        limit?: number;
    }): SearchResult[];
    getConcept(idOrPath: string): Concept | undefined;
}

type RefreshMode$2 = "off" | "stale-while-refresh" | "blocking";
type FreshnessStatus = "fresh" | "stale" | "missing" | "failed" | "refreshing";
declare const MCP_TOOL_NAMES: readonly ["search_concepts", "read_concept", "get_neighbors", "list_types", "list_tags", "bundle_summary"];
type SourceMetadata = {
    name: string;
    kind: string;
    seedUrl: string;
};
type RefreshErrorDetails = {
    code?: string;
    message: string;
    [key: string]: unknown;
};
type FreshnessState = {
    freshnessStatus?: FreshnessStatus;
    status?: FreshnessStatus;
    lastSuccessfulRefreshAt?: string | null;
    refreshInProgress?: boolean;
    lastRefreshError?: RefreshErrorDetails | string | Error | null;
    lastError?: RefreshErrorDetails | string | Error | null;
    nextRefreshAllowedAt?: string | null;
};
type RefreshContext = {
    mode: Exclude<RefreshMode$2, "off">;
    bundleDir: string;
    source?: SourceMetadata;
    freshness: FreshnessState;
};
type RefreshResult$1 = {
    bundleDir?: string;
    freshness?: FreshnessState;
};
type RefreshHooks = {
    mode?: RefreshMode$2;
    getFreshness?: () => FreshnessState | Promise<FreshnessState>;
    refreshIfNeeded?: (context: RefreshContext) => void | RefreshResult$1 | Promise<void | RefreshResult$1>;
};
type ServeOptions = {
    bundleDir: string;
    name?: string;
    maxResultChars?: number;
    search?: BundleSearch;
    source?: SourceMetadata;
    refresh?: RefreshHooks;
};
declare function createMcpServer(options: ServeOptions): Promise<Server>;
declare function serveMcpStdio(options: ServeOptions): Promise<void>;

declare function extractHeadings(markdown: string): Array<{
    depth: number;
    text: string;
    slug: string;
}>;
declare function extractMarkdownLinks(markdown: string): Array<{
    href: string;
    text: string;
}>;
declare function inferType(title: string, sourceId: string, markdown: string): string;
declare function inferTags(title: string, sourceId: string, headings: Array<{
    text: string;
}>): string[];
declare function normalizeDocument(raw: RawDocument): NormalizedDocument;
declare function descriptionFromMarkdown(markdown: string): string;

declare function readConceptFile(bundleDir: string, absolutePath: string): Promise<Concept>;
declare function readBundle(bundleDir: string): Promise<Map<string, Concept>>;

declare function validateBundle(bundleDir: string): Promise<ValidationReport>;
declare function inspectBundle(bundleDir: string): Promise<BundleStats>;

type WriteBundleOptions = {
    outDir: string;
    title?: string;
    sourceName?: string;
    force?: boolean;
    inputPath?: string;
    dangerouslyAllowUnsafeOutput?: boolean;
    timestamp?: string;
};
declare function assertSafeForceOutDir(outDir: string, options: WriteBundleOptions): Promise<void>;
declare function writeOkfBundle(docs: NormalizedDocument[], options: WriteBundleOptions): Promise<string[]>;

declare function parseDurationSeconds(input: string): number;

declare function hashBundleContents(bundleDir: string): Promise<string>;

type RefreshStatus$1 = "missing" | "fresh" | "stale" | "refreshing" | "failed";
type RefreshMode$1 = "off" | "stale-while-refresh" | "blocking";
type RefreshSourceManifest = {
    schemaVersion: 1;
    name: string;
    kind: "website";
    source: {
        seedUrl: string;
    };
    crawl: Omit<CrawlOptions, "seedUrl" | "outDir" | "force" | "dryRun" | "timestamp" | "onProgress">;
    refresh: {
        mode: RefreshMode$1;
        maxAgeSeconds: number;
        minIntervalSeconds: number;
    };
    bundle: {
        dir: string;
    };
};
type RefreshErrorState = {
    message: string;
    code?: string;
    sourceName?: string;
    seedUrl?: string;
    occurredAt?: string;
};
type RefreshBundleState = {
    conceptCount: number;
    warningCount: number;
    valid: boolean;
    contentHash: string;
};
type RefreshState$1 = {
    schemaVersion: 1;
    status: RefreshStatus$1;
    lastCheckedAt: string | null;
    lastRefreshStartedAt: string | null;
    lastRefreshCompletedAt: string | null;
    lastSuccessfulRefreshAt: string | null;
    nextRefreshAllowedAt: string | null;
    refreshInProgress: boolean;
    lastError: RefreshErrorState | null;
    bundle: RefreshBundleState | null;
};
type FreshnessReason = "bundle_missing" | "bundle_invalid" | "latest_refresh_failed" | "refresh_in_progress" | "never_refreshed" | "within_max_age" | "exceeded_max_age";
type FreshnessDecision = {
    status: RefreshStatus$1;
    reason: FreshnessReason;
    validation?: ValidationReport;
};
type ValidateBundleFn = (bundleDir: string) => Promise<ValidationReport>;
type InspectBundleFn = (bundleDir: string) => Promise<BundleStats>;
type HashBundleContentFn = (bundleDir: string) => Promise<string>;
type CrawlRunner = (options: CrawlOptions) => Promise<CrawlResult>;
type RefreshSkipReason = "fresh" | "locked" | "min_interval";
type RefreshResult = {
    status: RefreshStatus$1;
    reason?: RefreshSkipReason;
    skipped: boolean;
    dryRun?: boolean;
    state?: RefreshState$1;
    crawlResult?: CrawlResult;
    error?: RefreshErrorState;
};
type WriteRefreshStateFn = (state: RefreshState$1) => Promise<void>;
declare function evaluateFreshness(options: {
    manifest: RefreshSourceManifest;
    state?: RefreshState$1 | null;
    bundleDir: string;
    now?: Date;
    maxAgeSeconds?: number;
    validateBundle?: ValidateBundleFn;
}): Promise<FreshnessDecision>;
declare function refreshSource(options: {
    manifest: RefreshSourceManifest;
    state?: RefreshState$1 | null;
    sourceDir: string;
    bundleDir: string;
    now?: Date;
    force?: boolean;
    dryRun?: boolean;
    validateBundle?: ValidateBundleFn;
    inspectBundle?: InspectBundleFn;
    hashBundleContent?: HashBundleContentFn;
    crawlRunner?: CrawlRunner;
    writeState: WriteRefreshStateFn;
    staleLockTimeoutMs?: number;
}): Promise<RefreshResult>;

type SourceKind = "website";
type RefreshMode = "off" | "stale-while-refresh" | "blocking";
type RefreshStatus = "missing" | "fresh" | "stale" | "refreshing" | "failed";
interface SourceStoreOptions {
    okfyHome?: string;
    env?: {
        OKFY_HOME?: string;
    };
}
interface SourceManifest {
    schemaVersion: 1;
    okfyVersion: string;
    name: string;
    kind: SourceKind;
    createdAt: string;
    updatedAt: string;
    source: {
        seedUrl: string;
    };
    crawl: {
        maxPages: number;
        maxDepth: number;
        include: string[];
        exclude: string[];
        sameOrigin: boolean;
        respectRobots: boolean;
        concurrency: number;
        allowPrivateNetwork: boolean;
    };
    refresh: {
        mode: RefreshMode;
        maxAgeSeconds: number;
        minIntervalSeconds: number;
    };
    bundle: {
        dir: string;
    };
}
interface RefreshState {
    schemaVersion: 1;
    status: RefreshStatus;
    lastCheckedAt: string | null;
    lastRefreshStartedAt: string | null;
    lastRefreshCompletedAt: string | null;
    lastSuccessfulRefreshAt: string | null;
    nextRefreshAllowedAt: string | null;
    refreshInProgress: boolean;
    lastError: {
        message: string;
        code?: string;
    } | null;
    bundle: {
        conceptCount: number;
        warningCount: number;
        valid: boolean;
        contentHash: string;
    } | null;
}
interface SourceRecord {
    name: string;
    dir: string;
    manifest: SourceManifest;
    state?: RefreshState;
    bundleDir: string;
}
declare function resolveOkfyHome(options?: SourceStoreOptions): string;
declare function validateSourceName(name: string): string;
declare function resolveSourceDir(name: string, options?: SourceStoreOptions): string;
declare function resolveBundleDir(manifest: SourceManifest, options?: SourceStoreOptions): string;
declare function writeSourceManifest(manifest: SourceManifest, options?: SourceStoreOptions): Promise<void>;
declare function readSourceManifest(name: string, options?: SourceStoreOptions): Promise<SourceManifest>;
declare function writeRefreshState(name: string, state: RefreshState, options?: SourceStoreOptions): Promise<void>;
declare function readRefreshState(name: string, options?: SourceStoreOptions): Promise<RefreshState>;
declare function listSources(options?: SourceStoreOptions): Promise<SourceRecord[]>;
declare function removeSource(name: string, options?: SourceStoreOptions): Promise<void>;

export { BundleSearch, type BundleStats, type Concept, type ContentType, type CrawlOptions, type CrawlProgressEvent, type CrawlResult, type CrawlRunner, type FreshnessDecision, type FreshnessReason, type FreshnessState, type FreshnessStatus, type ImportOptions, type KnowledgeGraph, MCP_TOOL_NAMES, type NormalizedDocument, type RawDocument, type RefreshContext, type RefreshErrorDetails, type RefreshHooks, type RefreshMode$2 as RefreshMode, type RefreshResult$1 as RefreshResult, type RefreshSkipReason, type RefreshSourceManifest, type SearchResult, type ServeOptions, type SourceKind, type SourceManifest, type SourceMetadata, type SourceRecord, type RefreshMode as SourceRefreshMode, type RefreshResult as SourceRefreshResult, type RefreshState$1 as SourceRefreshState, type RefreshStatus as SourceRefreshStatus, type SourceStoreOptions, type RefreshState as StoredRefreshState, type ValidationIssue, type ValidationReport, type WriteBundleOptions, assertSafeForceOutDir, buildGraph, crawlWebsite, createMcpServer, descriptionFromMarkdown, evaluateFreshness, extractHeadings, extractInternalLinks, extractMarkdownLinks, hashBundleContents, importLocal, inferTags, inferType, inspectBundle, listSources, normalizeDocument, parseDurationSeconds, readBundle, readConceptFile, readRefreshState, readSourceManifest, refreshSource, removeSource, resolveBundleDir, resolveOkfyHome, resolveSourceDir, serveMcpStdio, validateBundle, validateSourceName, writeOkfBundle, writeRefreshState, writeSourceManifest };
