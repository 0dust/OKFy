import { z, type ZodIssue } from "zod";

const nonBlankString = z.string().refine((value) => value.trim() !== "");
const nullableNonBlankString = nonBlankString.nullable();

const sourceSchema = z.object({ seedUrl: nonBlankString });
const crawlSchema = z.object({
  maxPages: z.number().finite(),
  maxDepth: z.number().finite(),
  include: z.array(z.string()),
  exclude: z.array(z.string()),
  sameOrigin: z.boolean(),
  respectRobots: z.boolean(),
  concurrency: z.number().finite(),
  allowPrivateNetwork: z.boolean()
});
const refreshPolicySchema = z.object({
  mode: z.enum(["off", "stale-while-refresh", "blocking"]),
  maxAgeSeconds: z.number().finite(),
  minIntervalSeconds: z.number().finite()
});
const manifestBundleSchema = z.object({ dir: nonBlankString });

export const sourceManifestSchema = z.object({
  schemaVersion: z.literal(1),
  okfyVersion: nonBlankString,
  name: nonBlankString,
  kind: z.literal("website"),
  createdAt: nonBlankString,
  updatedAt: nonBlankString,
  source: sourceSchema,
  crawl: crawlSchema,
  refresh: refreshPolicySchema,
  bundle: manifestBundleSchema
});

const refreshErrorSchema = z
  .object({
    message: nonBlankString,
    code: z.string().optional(),
    sourceName: z.string().optional(),
    seedUrl: z.string().optional(),
    occurredAt: z.string().optional()
  })
  .passthrough();
const refreshBundleSchema = z.object({
  conceptCount: z.number().finite(),
  warningCount: z.number().finite(),
  valid: z.boolean(),
  contentHash: nonBlankString
});

export const refreshStateSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(["missing", "fresh", "stale", "refreshing", "failed"]),
  lastCheckedAt: nullableNonBlankString,
  lastRefreshStartedAt: nullableNonBlankString,
  lastRefreshCompletedAt: nullableNonBlankString,
  lastSuccessfulRefreshAt: nullableNonBlankString,
  nextRefreshAllowedAt: nullableNonBlankString,
  refreshInProgress: z.boolean(),
  lastError: refreshErrorSchema.nullable(),
  bundle: refreshBundleSchema.nullable()
});

export type SourceManifestSchema = z.infer<typeof sourceManifestSchema>;
export type RefreshStateSchema = z.infer<typeof refreshStateSchema>;
export type RefreshErrorStateSchema = z.infer<typeof refreshErrorSchema>;

// Recovery values live beside the authoritative manifest schema so persisted defaults
// cannot drift into a second source-store representation.
export const sourceManifestFallbacks: Omit<SourceManifestSchema, "name"> = {
  schemaVersion: 1,
  okfyVersion: "unknown",
  kind: "website",
  createdAt: "1970-01-01T00:00:00.000Z",
  updatedAt: "1970-01-01T00:00:00.000Z",
  source: { seedUrl: "" },
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
  refresh: { mode: "off", maxAgeSeconds: 0, minIntervalSeconds: 0 },
  bundle: { dir: "bundle" }
};

const fieldOrders = {
  manifest: Object.keys(sourceManifestSchema.shape),
  source: Object.keys(sourceSchema.shape),
  crawl: Object.keys(crawlSchema.shape),
  refreshPolicy: Object.keys(refreshPolicySchema.shape),
  manifestBundle: Object.keys(manifestBundleSchema.shape),
  state: Object.keys(refreshStateSchema.shape),
  refreshError: Object.keys(refreshErrorSchema.shape),
  refreshBundle: Object.keys(refreshBundleSchema.shape)
};

export function persistedFieldOrder(value: Record<string, unknown>): readonly string[] | undefined {
  if ("status" in value) return fieldOrders.state;
  if ("okfyVersion" in value) return fieldOrders.manifest;
  if (fieldOrders.crawl.some((key) => key in value)) return fieldOrders.crawl;
  if (fieldOrders.refreshPolicy.some((key) => key in value)) return fieldOrders.refreshPolicy;
  if (fieldOrders.refreshBundle.some((key) => key in value)) return fieldOrders.refreshBundle;
  if ("message" in value) return fieldOrders.refreshError;
  if ("seedUrl" in value) return fieldOrders.source;
  if ("dir" in value) return fieldOrders.manifestBundle;
  return undefined;
}

export function parseSourceManifest(value: unknown, sourceName: string): SourceManifestSchema {
  const result = sourceManifestSchema.safeParse(value);
  if (result.success) return result.data;
  throw manifestIssue(result.error.issues[0], sourceName);
}

export function parseRefreshState(value: unknown, sourceName: string): RefreshStateSchema {
  const result = refreshStateSchema.safeParse(value);
  if (result.success) return result.data;
  throw stateIssue(result.error.issues[0], sourceName);
}

function manifestIssue(issue: ZodIssue, sourceName: string): Error {
  if (issue.path.length === 0)
    return new Error(`Invalid source manifest for "${sourceName}": expected object.`);
  const path = issue.path.join(".");
  if (path === "schemaVersion")
    return new Error(`Invalid source manifest for "${sourceName}": schemaVersion must be 1.`);
  if (path === "kind")
    return new Error(`Invalid source manifest for "${sourceName}": kind must be "website".`);
  if (path === "refresh.mode" && issue.code === "invalid_enum_value")
    return new Error(`Invalid source manifest for "${sourceName}": refresh.mode is invalid.`);
  return new Error(
    `Invalid source manifest for "${sourceName}": ${path} must be ${manifestExpected(path)}.`
  );
}

function stateIssue(issue: ZodIssue, sourceName: string): Error {
  if (issue.path.length === 0)
    return new Error(`Invalid refresh state for "${sourceName}": expected object.`);
  const path = issue.path.join(".");
  if (path === "schemaVersion")
    return new Error(`Invalid refresh state for "${sourceName}": schemaVersion must be 1.`);
  if (path === "status" && issue.code === "invalid_enum_value")
    return new Error(`Invalid refresh state for "${sourceName}": status is invalid.`);
  const expected =
    path === "lastError"
      ? "object or null"
      : path === "bundle"
        ? "object or null"
        : stateExpected(path);
  return new Error(`Invalid refresh state for "${sourceName}": ${path} must be ${expected}.`);
}

function manifestExpected(path: string): string {
  if (["source", "crawl", "refresh", "bundle"].includes(path)) return "object";
  if (path === "crawl.include" || path === "crawl.exclude") return "string array";
  if (
    [
      "crawl.maxPages",
      "crawl.maxDepth",
      "crawl.concurrency",
      "refresh.maxAgeSeconds",
      "refresh.minIntervalSeconds"
    ].includes(path)
  )
    return "number";
  if (["crawl.sameOrigin", "crawl.respectRobots", "crawl.allowPrivateNetwork"].includes(path))
    return "boolean";
  return "non-empty string";
}

function stateExpected(path: string): string {
  if (path.startsWith("lastError.") && path !== "lastError.message") return "string";
  if (
    [
      "lastCheckedAt",
      "lastRefreshStartedAt",
      "lastRefreshCompletedAt",
      "lastSuccessfulRefreshAt",
      "nextRefreshAllowedAt"
    ].includes(path)
  )
    return "string or null";
  if (path === "refreshInProgress" || path === "bundle.valid") return "boolean";
  if (path === "bundle.conceptCount" || path === "bundle.warningCount") return "number";
  return "non-empty string";
}
