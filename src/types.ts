export type ContentType = "html" | "markdown" | "mdx" | "text";

export type RawDocument = {
  sourceId: string;
  url?: string;
  filePath?: string;
  contentType: ContentType;
  raw: string;
  discoveredAt: string;
};

export type NormalizedDocument = {
  sourceId: string;
  title: string;
  markdown: string;
  resource?: string;
  sourcePath?: string;
  outputPath?: string;
  headings: Array<{ depth: number; text: string; slug: string }>;
  links: Array<{ href: string; text: string }>;
  tags: string[];
  type: string;
};

export type Concept = {
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

export type KnowledgeGraph = {
  concepts: Map<string, Concept>;
  outbound: Map<string, string[]>;
  backlinks: Map<string, string[]>;
};

export type ValidationIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  path?: string;
};

export type ValidationReport = {
  valid: boolean;
  issues: ValidationIssue[];
  conceptCount: number;
  reservedFileCount: number;
  warningCount: number;
};

export type BundleStats = {
  title: string;
  conceptCount: number;
  reservedFileCount: number;
  warningCount: number;
  typeDistribution: Record<string, number>;
  tagDistribution: Record<string, number>;
  linkCount: number;
  brokenLinks: number;
  orphanConcepts: string[];
  topLinkedConcepts: Array<{ id: string; title?: string; count: number }>;
  sourceDomains: Record<string, number>;
};
