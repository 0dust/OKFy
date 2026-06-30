import { SetupClient, ServeCommand, SetupArtifact, ServeCommandTarget } from './setup-artifacts.js';
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
    private resultsForHits;
    getConcept(idOrPath: string): Concept | undefined;
}

interface OkfyHomeOptions {
    okfyHome?: string;
    env?: {
        OKFY_HOME?: string;
    };
}

type SourceKind = "website";
type RefreshMode$1 = "off" | "stale-while-refresh" | "blocking";
type RefreshStatus = "missing" | "fresh" | "stale" | "refreshing" | "failed";
type SourceStoreOptions = OkfyHomeOptions;
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
        mode: RefreshMode$1;
        maxAgeSeconds: number;
        minIntervalSeconds: number;
    };
    bundle: {
        dir: string;
    };
}
interface RefreshErrorState {
    [key: string]: unknown;
    message: string;
    code?: string;
    sourceName?: string;
    seedUrl?: string;
    occurredAt?: string;
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
    lastError: RefreshErrorState | null;
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
    loadError?: SourceLoadError;
}
interface SourceLoadError {
    message: string;
    code?: string;
    sourceDirName?: string;
}
declare function resolveOkfyHome(options?: SourceStoreOptions): string;
declare function validateSourceName(name: string): string;
declare function resolveSourceDir(name: string, options?: SourceStoreOptions): string;
declare function resolveBundleDir(manifest: SourceManifest, options?: SourceStoreOptions): string;
declare function writeSourceManifest(manifest: SourceManifest, options?: SourceStoreOptions): Promise<void>;
declare function readSourceManifest(name: string, options?: SourceStoreOptions): Promise<SourceManifest>;
declare function writeRefreshState(name: string, state: RefreshState, options?: SourceStoreOptions): Promise<void>;
declare function readRefreshState(name: string, options?: SourceStoreOptions): Promise<RefreshState>;
declare function readSourceRecord(name: string, options?: SourceStoreOptions): Promise<SourceRecord>;
declare function listSources(options?: SourceStoreOptions): Promise<SourceRecord[]>;
declare function removeSource(name: string, options?: SourceStoreOptions): Promise<void>;

interface WorkspaceProfile {
    schemaVersion: 1;
    name: string;
    sources: string[];
}
interface WorkspaceSourceSelection {
    names?: string[];
    all?: boolean;
    profile?: WorkspaceProfile;
    profileName?: string;
}
interface WorkspaceSourceSet {
    records: SourceRecord[];
    sourceNames: string[];
    workspaceName?: string;
}
type WorkspaceSourceRecord = Omit<SourceRecord, "manifest"> & {
    manifest: Omit<SourceRecord["manifest"], "kind"> & {
        kind: SourceRecord["manifest"]["kind"] | "local";
    };
};
declare function bundleSourceName(bundleDir: string): string;
declare function localBundleRecord(bundleDir: string): WorkspaceSourceRecord;
declare function assertUniqueWorkspaceRecordNames(records: WorkspaceSourceRecord[]): void;
declare function isRegisteredWorkspaceRecord(record: WorkspaceSourceRecord): record is SourceRecord;
interface WorkspaceSearchSource {
    record: WorkspaceSourceRecord;
    search?: BundleSearch;
    bundleDir?: string;
    loadError?: unknown;
}
interface WorkspaceSearchResult extends SearchResult {
    sourceName: string;
    sourceKind: string;
    seedUrl: string;
    ref: string;
}
interface WorkspaceConceptCandidate {
    sourceName: string;
    sourceKind: string;
    seedUrl: string;
    id: string;
    ref: string;
    title?: string;
    type: string;
    resource?: string;
}
declare class WorkspaceError extends Error {
    readonly code: "ambiguous_concept" | "duplicate_source" | "no_sources" | "no_usable_sources" | "source_not_in_workspace" | "unknown_concept" | "unknown_source";
    readonly details: Record<string, unknown>;
    constructor(code: "ambiguous_concept" | "duplicate_source" | "no_sources" | "no_usable_sources" | "source_not_in_workspace" | "unknown_concept" | "unknown_source", message: string, details?: Record<string, unknown>);
    toJSON(): Record<string, unknown>;
}
declare function workspaceProfilePath(name: string, options?: SourceStoreOptions): string;
declare function readWorkspaceProfile(name: string, options?: SourceStoreOptions): Promise<WorkspaceProfile>;
declare function writeWorkspaceProfile(profile: WorkspaceProfile, options?: SourceStoreOptions): Promise<void>;
declare function resolveWorkspaceSources(selection: WorkspaceSourceSelection, options?: SourceStoreOptions): Promise<WorkspaceSourceSet>;
declare class WorkspaceSearch {
    readonly sources: WorkspaceSearchSource[];
    private readonly selectedNames;
    private readonly availableNames;
    constructor(sources: WorkspaceSearchSource[], options?: {
        availableSourceNames?: string[];
    });
    static fromSourceRecords(records: SourceRecord[], options?: {
        availableSourceNames?: string[];
    }): Promise<WorkspaceSearch>;
    search(query: string, options?: {
        source?: string;
        type?: string;
        tags?: string[];
        limit?: number;
    }): WorkspaceSearchResult[];
    getConcept(input: {
        id: string;
        source?: string;
    }): {
        source: WorkspaceSearchSource;
        concept: Concept;
    };
    listTypes(source?: string): Record<string, number>;
    listTags(source?: string): Record<string, number>;
    sourceNames(): string[];
    usableSourceNames(): string[];
    private distribution;
    private usableSources;
    private sourcesWithSearch;
    private sourceByName;
    private withSourceResult;
    private conceptCandidate;
}

type InspectorValidationStatus = "valid" | "invalid" | "unavailable";
type InspectorAvailabilityStatus = "available" | "unavailable";
interface InspectorTarget {
    kind: "bundle" | "workspace";
    bundleDir?: string;
    workspaceName?: string;
    sourceNames?: string[];
}
interface InspectorError {
    message: string;
    code?: string;
    [key: string]: unknown;
}
interface InspectorReadinessSource {
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
interface InspectorReadiness {
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
interface InspectorConcept {
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
interface InspectorEdge {
    from: string;
    to: string;
    kind: "internal_link";
    label: "Markdown link";
    sourceName?: string;
}
interface InspectorAgentStep {
    tool: "bundle_summary" | "search_concepts" | "read_concept" | "get_neighbors";
    name: "bundle_summary" | "search_concepts" | "read_concept" | "get_neighbors";
    purpose: string;
    example: string;
}
interface InspectorActivationArtifact {
    label: string;
    format: "shell" | "json" | "toml";
    body: string;
}
interface InspectorActivation {
    client: string;
    serverName: string;
    codexServerName: string;
    command: {
        display: string;
        env: Record<string, string>;
    };
    firstPrompt: string;
    artifacts: InspectorActivationArtifact[];
    files: Array<{
        label: string;
        path: string;
    }>;
}
interface InspectorReport {
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
        tools: Array<{
            name: InspectorAgentStep["tool"];
            purpose: string;
        }>;
        citationGuidance: string;
        suggestedQuestions: string[];
    };
    activation?: InspectorActivation;
}
interface BuildBundleInspectorOptions {
    title?: string;
}
interface BuildWorkspaceInspectorOptions {
    workspaceName?: string;
    all?: boolean;
    title?: string;
}
declare function buildBundleInspectorReport(bundleDir: string, options?: BuildBundleInspectorOptions): Promise<InspectorReport>;
declare function buildWorkspaceInspectorReport(records: WorkspaceSourceRecord[], options?: BuildWorkspaceInspectorOptions): Promise<InspectorReport>;

interface ActivationPacketFile {
    label: "Inspector HTML" | "Setup Markdown" | "Proof JSON";
    fileName: "okfy-inspector.html" | "okfy-setup.md" | "okfy-proof.json";
    path: string;
}
interface ActivationSetup {
    client: SetupClient;
    serverName: string;
    codexServerName: string;
    command: ServeCommand;
    artifacts: SetupArtifact[];
    firstPrompt: string;
}
interface ActivationProofSearchResult {
    sourceName?: string;
    id: string;
    ref: string;
    title?: string;
    type: string;
    resource?: string;
    snippet: string;
    score: number;
}
interface ActivationProof {
    schemaVersion: 1;
    generatedBy: "okfy";
    generatedAt: string;
    target: InspectorReport["target"];
    summary: {
        tool: "bundle_summary";
        result: {
            title: string;
            readiness: InspectorReport["readiness"];
            sources: InspectorReport["sources"];
        };
    };
    search: {
        tool: "search_concepts";
        input: {
            query: string;
            limit: number;
            source?: string;
        };
        results: ActivationProofSearchResult[];
    };
    read: {
        tool: "read_concept";
        input: {
            id: string;
            source?: string;
            max_chars: number;
        };
        result: {
            id: string;
            ref: string;
            title?: string;
            type: string;
            resource?: string;
            bodyPreview: string;
            citation: {
                ref: string;
                sourceResource?: string;
                sourceName?: string;
            };
        };
    } | null;
    neighbors: {
        tool: "get_neighbors";
        input: {
            id: string;
            source?: string;
            depth: 1;
        };
        result: {
            outbound: string[];
            backlinks: string[];
        };
    } | null;
}
interface ActivationPacket {
    schemaVersion: 1;
    generatedBy: "okfy";
    outDir: string;
    protectedInputPaths?: string[];
    setup: ActivationSetup;
    proof: ActivationProof;
    files: ActivationPacketFile[];
}
interface BuildActivationPacketOptions {
    records: WorkspaceSourceRecord[];
    report: InspectorReport;
    client: SetupClient;
    outDir: string;
    commandTarget: ServeCommandTarget;
    proofTask?: string;
    protectedInputPaths?: string[];
    serverIdentity?: string[];
    autoRefresh?: boolean;
    okfyHome?: string;
    generatedAt?: string;
}
declare function buildActivationPacket(options: BuildActivationPacketOptions): Promise<ActivationPacket>;
declare function withActivationMetadata(report: InspectorReport, packet: ActivationPacket): InspectorReport;
declare function renderActivationSetupMarkdown(packet: ActivationPacket): string;
declare function writeActivationPacketFiles(packet: ActivationPacket, contents: {
    inspectorHtml: string;
    setupMarkdown: string;
}, options?: {
    force?: boolean;
    protectedInputPaths?: string[];
}): Promise<void>;
declare function protectedActivationInputPaths(records: WorkspaceSourceRecord[]): string[];

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

declare const MCP_TOOL_NAMES: readonly ["search_concepts", "read_concept", "get_neighbors", "list_types", "list_tags", "bundle_summary"];

type RefreshMode = "off" | "stale-while-refresh" | "blocking";
type FreshnessStatus = "fresh" | "stale" | "missing" | "failed" | "refreshing";
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
    mode: Exclude<RefreshMode, "off">;
    bundleDir: string;
    source?: SourceMetadata;
    freshness: FreshnessState;
};
type RefreshResult$1 = {
    bundleDir?: string;
    freshness?: FreshnessState;
};
type RefreshHooks = {
    mode?: RefreshMode;
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
type WorkspaceServeSource = {
    record: WorkspaceSourceRecord;
    search?: BundleSearch;
    refresh?: RefreshHooks;
};
type WorkspaceServeOptions = {
    sources: WorkspaceServeSource[];
    name?: string;
    maxResultChars?: number;
    availableSourceNames?: string[];
};
declare function createMcpServer(options: ServeOptions): Promise<Server>;
declare function createWorkspaceMcpServer(options: WorkspaceServeOptions): Promise<Server>;
declare function serveMcpStdio(options: ServeOptions): Promise<void>;
declare function serveWorkspaceMcpStdio(options: WorkspaceServeOptions): Promise<void>;

interface PackageMetadata {
    name: string;
    version: string;
    root: string;
}
declare function runtimePackageRoot(): string;
declare function packageMetadata(): PackageMetadata;
declare function packageVersion(): string;
declare function okfyUserAgent(): string;

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

type RefreshSourceManifest = SourceManifest;
type FreshnessReason = "bundle_missing" | "bundle_invalid" | "latest_refresh_failed" | "refresh_in_progress" | "never_refreshed" | "within_max_age" | "exceeded_max_age";
type FreshnessDecision = {
    status: RefreshStatus;
    reason: FreshnessReason;
    validation?: ValidationReport;
};
type ValidateBundleFn = (bundleDir: string) => Promise<ValidationReport>;
type InspectBundleFn = (bundleDir: string) => Promise<BundleStats>;
type HashBundleContentFn = (bundleDir: string) => Promise<string>;
type CrawlRunner = (options: CrawlOptions) => Promise<CrawlResult>;
type RefreshSkipReason = "fresh" | "locked" | "min_interval";
type RefreshResult = {
    status: RefreshStatus;
    reason?: RefreshSkipReason;
    skipped: boolean;
    dryRun?: boolean;
    state?: RefreshState;
    crawlResult?: CrawlResult;
    error?: RefreshErrorState;
};
type WriteRefreshStateFn = (state: RefreshState) => Promise<void>;
declare function evaluateFreshness(options: {
    manifest: RefreshSourceManifest;
    state?: RefreshState | null;
    bundleDir: string;
    now?: Date;
    maxAgeSeconds?: number;
    validateBundle?: ValidateBundleFn;
}): Promise<FreshnessDecision>;
declare function refreshSource(options: {
    manifest: RefreshSourceManifest;
    state?: RefreshState | null;
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

export { type ActivationPacket, type ActivationPacketFile, type ActivationProof, type ActivationProofSearchResult, type ActivationSetup, type BuildActivationPacketOptions, type BuildBundleInspectorOptions, type BuildWorkspaceInspectorOptions, BundleSearch, type BundleStats, type Concept, type ContentType, type CrawlOptions, type CrawlProgressEvent, type CrawlResult, type CrawlRunner, type FreshnessDecision, type FreshnessReason, type FreshnessState, type FreshnessStatus, type ImportOptions, type InspectorAgentStep, type InspectorAvailabilityStatus, type InspectorConcept, type InspectorEdge, type InspectorError, type InspectorReadiness, type InspectorReadinessSource, type InspectorReport, type InspectorTarget, type InspectorValidationStatus, type KnowledgeGraph, MCP_TOOL_NAMES, type NormalizedDocument, type PackageMetadata, type RawDocument, type RefreshContext, type RefreshErrorDetails, type RefreshHooks, type RefreshMode, type RefreshResult$1 as RefreshResult, type RefreshSkipReason, type RefreshSourceManifest, type SearchResult, type ServeOptions, type SourceKind, type SourceLoadError, type SourceManifest, type SourceMetadata, type SourceRecord, type RefreshMode$1 as SourceRefreshMode, type RefreshResult as SourceRefreshResult, type RefreshState as SourceRefreshState, type RefreshStatus as SourceRefreshStatus, type SourceStoreOptions, type RefreshState as StoredRefreshState, type ValidationIssue, type ValidationReport, type WorkspaceConceptCandidate, WorkspaceError, type WorkspaceProfile, WorkspaceSearch, type WorkspaceSearchResult, type WorkspaceSearchSource, type WorkspaceServeOptions, type WorkspaceServeSource, type WorkspaceSourceRecord, type WorkspaceSourceSelection, type WorkspaceSourceSet, type WriteBundleOptions, assertSafeForceOutDir, assertUniqueWorkspaceRecordNames, buildActivationPacket, buildBundleInspectorReport, buildGraph, buildWorkspaceInspectorReport, bundleSourceName, crawlWebsite, createMcpServer, createWorkspaceMcpServer, descriptionFromMarkdown, evaluateFreshness, extractHeadings, extractInternalLinks, extractMarkdownLinks, hashBundleContents, importLocal, inferTags, inferType, inspectBundle, isRegisteredWorkspaceRecord, listSources, localBundleRecord, normalizeDocument, okfyUserAgent, packageMetadata, packageVersion, parseDurationSeconds, protectedActivationInputPaths, readBundle, readConceptFile, readRefreshState, readSourceManifest, readSourceRecord, readWorkspaceProfile, refreshSource, removeSource, renderActivationSetupMarkdown, resolveBundleDir, resolveOkfyHome, resolveSourceDir, resolveWorkspaceSources, runtimePackageRoot, serveMcpStdio, serveWorkspaceMcpStdio, validateBundle, validateSourceName, withActivationMetadata, workspaceProfilePath, writeActivationPacketFiles, writeOkfBundle, writeRefreshState, writeSourceManifest, writeWorkspaceProfile };
