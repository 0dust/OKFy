export type ContentType = "html" | "markdown" | "mdx" | "text";

export type RawDocument = {
  sourceId: string;
  url?: string;
  filePath?: string;
  contentType: ContentType;
  raw: string;
  discoveredAt: string;
};

export type SourceRange = {
  start: number;
  end: number;
};

export type DocumentProperties = {
  data: Record<string, unknown>;
  range: SourceRange;
  title?: string;
  description?: string;
  type?: string;
  aliases: string[];
  tags: string[];
};

export type DocumentHeading = {
  depth: number;
  text: string;
  slug: string;
  range: SourceRange;
};

export type DocumentBlockId = {
  id: string;
  raw: string;
  range: SourceRange;
};

export type InlineTag = {
  tag: string;
  raw: string;
  range: SourceRange;
};

export type SemanticLinkKind = "markdown" | "wikilink" | "note_embed" | "attachment_embed";

export type SemanticLink = {
  kind: SemanticLinkKind;
  raw: string;
  target: string;
  text: string;
  heading?: string;
  blockId?: string;
  range: SourceRange;
  destinationRange?: SourceRange;
  resolution?: "unresolved" | "ambiguous" | "resolved";
  resolvedSourceKey?: string;
};

export type DocumentDiagnostic = {
  severity: "warning";
  code: string;
  message: string;
  sourcePath: string;
  rawTarget: string;
  candidates?: string[];
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
  properties?: DocumentProperties;
  aliases?: string[];
  semanticLinks?: SemanticLink[];
  blockIds?: DocumentBlockId[];
  inlineTags?: InlineTag[];
  diagnostics?: DocumentDiagnostic[];
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
  aliases?: string[];
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
