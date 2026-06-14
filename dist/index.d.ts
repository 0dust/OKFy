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

type ServeOptions = {
    bundleDir: string;
    name?: string;
    maxResultChars?: number;
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
declare function writeOkfBundle(docs: NormalizedDocument[], options: WriteBundleOptions): Promise<string[]>;

export { BundleSearch, type BundleStats, type Concept, type ContentType, type CrawlOptions, type CrawlProgressEvent, type CrawlResult, type ImportOptions, type KnowledgeGraph, type NormalizedDocument, type RawDocument, type SearchResult, type ServeOptions, type ValidationIssue, type ValidationReport, type WriteBundleOptions, buildGraph, crawlWebsite, createMcpServer, descriptionFromMarkdown, extractHeadings, extractInternalLinks, extractMarkdownLinks, importLocal, inferTags, inferType, inspectBundle, normalizeDocument, readBundle, readConceptFile, serveMcpStdio, validateBundle, writeOkfBundle };
