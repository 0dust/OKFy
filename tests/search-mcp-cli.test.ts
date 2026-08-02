import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpServer, createWorkspaceMcpServer } from "../src/mcp.js";
import {
  createSourceRuntime,
  getSourceFreshness,
  prepareSourceRuntime
} from "../src/mcp-source-runtime.js";
import { BundleSearch } from "../src/search.js";
import type { SourceRecord } from "../src/source-store.js";
import type { Concept } from "../src/types.js";
import { mcpHandler as handler, type McpTextResult } from "./support/mcp-handler.js";
import { withBuiltCliMcpSession } from "./support/mcp-session.js";

const execFileAsync = promisify(execFile);
const bundleDir = path.resolve("test-fixtures/okf-valid");
const tempDirs: string[] = [];

async function tempRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-cli-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function parseText(result: McpTextResult): unknown {
  return JSON.parse(result.content[0]?.text ?? "null");
}

async function waitForValue<T>(
  read: () => Promise<T>,
  matches: (value: T) => boolean,
  timeoutMs = 1_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastValue: T;
  while (true) {
    lastValue = await read();
    if (matches(lastValue)) return lastValue;
    if (Date.now() >= deadline) return lastValue;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function writeSingleConceptBundle(
  dir: string,
  concept: {
    title: string;
    type: string;
    body: string;
    description?: string;
    tags?: string[];
    aliases?: string[];
  }
): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
  const tags = concept.tags ?? ["mcp"];
  await fs.writeFile(
    path.join(dir, "index.md"),
    `# Fixture\n\n* [${concept.title}](concept.md) - ${concept.description ?? concept.body.slice(0, 80)}\n`,
    "utf8"
  );
  await fs.writeFile(
    path.join(dir, "concept.md"),
    `---\ntype: "${concept.type}"\ntitle: "${concept.title}"\ndescription: "${concept.description ?? concept.body}"\nresource: "https://docs.example.com/concept"\ntags:\n${tags.map((tag) => `  - "${tag}"`).join("\n")}${concept.aliases?.length ? `\naliases:\n${concept.aliases.map((alias) => `  - ${JSON.stringify(alias)}`).join("\n")}` : ""}\ntimestamp: "2026-06-14T00:00:00.000Z"\n---\n\n# ${concept.title}\n\n${concept.body}\n`,
    "utf8"
  );
}

function sourceRecord(name: string, bundleDir: string, state: SourceRecord["state"]): SourceRecord {
  return {
    name,
    dir: path.dirname(bundleDir),
    bundleDir,
    state,
    manifest: {
      schemaVersion: 1,
      okfyVersion: "0.2.0",
      name,
      kind: "website",
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-20T00:00:00.000Z",
      source: { seedUrl: `https://docs.example.com/${name}` },
      crawl: {
        maxPages: 100,
        maxDepth: 4,
        include: [],
        exclude: [],
        sameOrigin: true,
        respectRobots: true,
        concurrency: 4,
        allowPrivateNetwork: false
      },
      refresh: {
        mode: "stale-while-refresh",
        maxAgeSeconds: 86_400,
        minIntervalSeconds: 900
      },
      bundle: { dir: bundleDir }
    }
  };
}

function sourceState(
  partial: Partial<NonNullable<SourceRecord["state"]>> = {}
): NonNullable<SourceRecord["state"]> {
  return {
    schemaVersion: 1,
    status: "fresh",
    lastCheckedAt: "2026-06-20T00:00:00.000Z",
    lastRefreshStartedAt: "2026-06-20T00:00:00.000Z",
    lastRefreshCompletedAt: "2026-06-20T00:01:00.000Z",
    lastSuccessfulRefreshAt: "2026-06-20T00:01:00.000Z",
    nextRefreshAllowedAt: "2026-06-20T00:16:00.000Z",
    refreshInProgress: false,
    lastError: null,
    bundle: {
      conceptCount: 1,
      warningCount: 0,
      valid: true,
      contentHash: "sha256:test"
    },
    ...partial
  };
}

describe("search", () => {
  it("finds a concept by its imported alias", () => {
    const concept: Concept = {
      id: "guides/identity",
      path: "guides/identity.md",
      frontmatter: {},
      type: "Guide",
      title: "Account Identity",
      description: "Configure the canonical user profile.",
      tags: [],
      aliases: ["Customer Passport"],
      body: "Use the primary identity record."
    };
    const search = new BundleSearch(
      new Map([
        [concept.id, concept],
        [concept.path, concept]
      ])
    );

    expect(search.search("Customer Passport", { limit: 5 }).map((item) => item.id)).toEqual([
      "guides/identity"
    ]);
  });

  it("searches concepts with type/tag filters and path lookup", async () => {
    const search = await BundleSearch.fromBundle(bundleDir);

    const results = search.search("MCP tool", { type: "API Reference", tags: ["mcp"], limit: 1 });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "reference/api",
      title: "API Reference",
      type: "API Reference"
    });
    expect(results[0]?.snippet).toContain("search_concepts");

    expect(search.getConcept("guides/quickstart.md")?.id).toBe("guides/quickstart");
    expect(search.getConcept("index")).toBeUndefined();
    expect(search.search("Okfy Fixture", { limit: 10 }).map((item) => item.id)).not.toContain(
      "index"
    );
    expect(search.graph.outbound.get("guides/quickstart")).toEqual(["reference/api"]);
    expect(search.graph.backlinks.get("reference/api")).toEqual(["guides/quickstart"]);
    expect([...search.graph.concepts.keys()].sort()).toEqual([
      "guides/quickstart",
      "reference/api"
    ]);
  });

  it("keeps useful recall for natural agent phrase queries", async () => {
    const [okfyDocs, stripeDocs] = await Promise.all([
      BundleSearch.fromBundle(path.resolve("examples/bundles/okfy-docs")),
      BundleSearch.fromBundle(path.resolve("examples/bundles/stripe-checkout-small"))
    ]);

    expect(okfyDocs.search("MCP setup", { limit: 5 }).map((item) => item.id)).toContain(
      "guides/serve-over-mcp"
    );
    expect(okfyDocs.search("mcp setup", { limit: 5 }).map((item) => item.id)).toContain(
      "guides/serve-over-mcp"
    );
    expect(okfyDocs.search("stdio config", { limit: 5 }).map((item) => item.id)).toContain(
      "guides/serve-over-mcp"
    );
    expect(okfyDocs.search("import workflow", { limit: 5 }).map((item) => item.id)).toContain(
      "guides/import-local-markdown"
    );
    expect(
      stripeDocs
        .search("required server parameters", { type: "API Reference", limit: 5 })
        .map((item) => item.id)
    ).toContain("sessions");
    expect(stripeDocs.search("how do I configure stdio for MCP", { limit: 5 })).toEqual([]);
    expect(stripeDocs.search("chckout", { limit: 5 }).map((item) => item.id)).toContain(
      "quickstart"
    );
  });
});

describe("MCP server", () => {
  it("finds imported aliases through search_concepts", async () => {
    const root = await tempRoot();
    const aliasBundle = path.join(root, "alias-bundle");
    await writeSingleConceptBundle(aliasBundle, {
      title: "Account Identity",
      type: "Guide",
      body: "Configure the canonical user profile.",
      aliases: ["Customer Passport"]
    });
    const server = await createMcpServer({ bundleDir: aliasBundle, maxResultChars: 2000 });
    const result = await handler(
      server,
      "tools/call"
    )({
      method: "tools/call",
      params: {
        name: "search_concepts",
        arguments: { query: "Customer Passport", limit: 5 }
      }
    });

    expect(result.structuredContent?.results).toEqual([
      expect.objectContaining({ id: "concept", title: "Account Identity" })
    ]);
  });

  it("lists PRD tools and calls search/read/neighbors directly", async () => {
    const server = await createMcpServer({ bundleDir, maxResultChars: 2000 });
    const listTools = handler(server, "tools/list");
    const callTool = handler(server, "tools/call");

    const listed = (await listTools({ method: "tools/list" })) as unknown as {
      tools: Array<{
        name: string;
        inputSchema: { properties: Record<string, unknown>; required?: string[] };
      }>;
    };
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "search_concepts",
      "read_concept",
      "get_neighbors",
      "list_types",
      "list_tags",
      "bundle_summary"
    ]);
    expect(listed.tools.find((tool) => tool.name === "search_concepts")?.inputSchema).toMatchObject(
      {
        properties: { limit: { type: "integer", minimum: 1, maximum: 50 } },
        required: ["query"]
      }
    );
    expect(listed.tools.find((tool) => tool.name === "get_neighbors")?.inputSchema).toMatchObject({
      properties: { depth: { type: "integer", minimum: 1, maximum: 2 } },
      required: ["id"]
    });
    expect(listed.tools.find((tool) => tool.name === "bundle_summary")?.inputSchema).toMatchObject({
      properties: {
        validation_offset: { type: "integer", minimum: 0 },
        validation_limit: { type: "integer", minimum: 1, maximum: 100 }
      }
    });

    const searchCall = await callTool({
      method: "tools/call",
      params: { name: "search_concepts", arguments: { query: "install okfy", limit: 2 } }
    });
    const searchResult = parseText(searchCall) as Array<{ id: string }>;
    expect(searchResult.map((item) => item.id)).toContain("guides/quickstart");
    expect(searchCall.isError).toBe(false);
    expect(searchCall.structuredContent?.results).toEqual(searchResult);

    const readCall = await callTool({
      method: "tools/call",
      params: { name: "read_concept", arguments: { id: "reference/api", max_chars: 40 } }
    });
    const readResult = parseText(readCall) as {
      markdown_body: string;
      outbound_links: string[];
      backlinks: string[];
    };
    expect(readResult.markdown_body.length).toBeLessThanOrEqual(40);
    expect(readResult.outbound_links).toEqual(["guides/quickstart"]);
    expect(readResult.backlinks).toEqual(["guides/quickstart"]);
    expect(readCall.structuredContent).toEqual(readResult);

    const reservedReadCall = await callTool({
      method: "tools/call",
      params: { name: "read_concept", arguments: { id: "index" } }
    });
    const reservedRead = parseText(reservedReadCall) as { error: { code: string } };
    expect(reservedRead.error.code).toBe("unknown_concept");
    expect(reservedReadCall.isError).toBe(true);
    expect(reservedReadCall.structuredContent?.error).toMatchObject({
      code: "unknown_concept"
    });

    const neighbors = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "get_neighbors", arguments: { id: "guides/quickstart", depth: 1 } }
      })
    ) as { root: string; concepts: Array<{ id: string }> };
    expect(neighbors.root).toBe("guides/quickstart");
    expect(neighbors.concepts.map((concept) => concept.id)).toContain("reference/api");

    const summary = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "bundle_summary", arguments: {} }
      })
    ) as {
      conceptCount: number;
      reservedFileCount: number;
      warningCount: number;
      validationStatus: string;
    };
    expect(summary).toMatchObject({
      conceptCount: 2,
      reservedFileCount: 3,
      warningCount: 0,
      validationStatus: "valid"
    });
  });

  it("returns structured MCP errors for invalid tool arguments", async () => {
    const server = await createMcpServer({ bundleDir, maxResultChars: 2000 });
    const callTool = handler(server, "tools/call");

    for (const [name, args] of [
      ["search_concepts", { query: "install okfy", limit: 0 }],
      ["read_concept", { id: "guides/quickstart", max_chars: 0 }],
      ["get_neighbors", { id: "guides/quickstart", depth: 3 }]
    ] as const) {
      const result = await callTool({ method: "tools/call", params: { name, arguments: args } });
      const body = parseText(result) as { error: { code: string; issues: unknown[] } };
      expect(result.isError).toBe(true);
      expect(result.structuredContent?.error).toMatchObject({ code: "invalid_arguments" });
      expect(body.error.code).toBe("invalid_arguments");
      expect(body.error.issues.length).toBeGreaterThan(0);
    }
  });

  it("includes semantic warning payloads in bundle_summary without invalidating the bundle", async () => {
    const root = await tempRoot();
    const warningBundle = path.join(root, "warning-bundle");
    await writeSingleConceptBundle(warningBundle, {
      title: "Semantic Source",
      type: "Note",
      body: "[[Semantic Source#Absent]]"
    });
    const server = await createMcpServer({ bundleDir: warningBundle, maxResultChars: 4000 });
    const callTool = handler(server, "tools/call");

    const summary = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "bundle_summary", arguments: {} }
      })
    ) as {
      validationStatus: string;
      warningCount: number;
      validationIssues: Array<Record<string, unknown>>;
    };

    expect(summary.validationStatus).toBe("valid");
    expect(summary.warningCount).toBe(1);
    expect(summary.validationIssues).toEqual([
      expect.objectContaining({
        severity: "warning",
        code: "missing_wikilink_fragment",
        path: "concept.md",
        rawTarget: "Semantic Source#Absent"
      })
    ]);
  });

  it("pages large validation diagnostics without losing structured MCP results", async () => {
    const root = await tempRoot();
    const warningBundle = path.join(root, "large-warning-bundle");
    const warnings = Array.from(
      { length: 80 },
      (_, index) => `[[Missing Note ${String(index).padStart(3, "0")}]]`
    );
    await writeSingleConceptBundle(warningBundle, {
      title: "Large Warning Source",
      type: "Note",
      body: warnings.join("\n")
    });
    const server = await createMcpServer({ bundleDir: warningBundle, maxResultChars: 2600 });
    const callTool = handler(server, "tools/call");

    const first = await callTool({
      method: "tools/call",
      params: {
        name: "bundle_summary",
        arguments: { validation_offset: 0, validation_limit: 100 }
      }
    });
    const firstSummary = first.structuredContent as {
      validationIssues: Array<{ rawTarget: string }>;
      validationIssuePage: {
        total: number;
        offset: number;
        limit: number;
        count: number;
        nextOffset: number | null;
      };
    };

    expect(firstSummary).toBeDefined();
    expect(first.content[0]?.text).not.toContain("...truncated");
    expect(firstSummary.validationIssuePage).toMatchObject({ total: 80, offset: 0, limit: 100 });
    expect(firstSummary.validationIssuePage.count).toBeGreaterThan(0);
    expect(firstSummary.validationIssuePage.count).toBeLessThan(80);
    expect(firstSummary.validationIssuePage.nextOffset).toBe(
      firstSummary.validationIssuePage.count
    );
    expect(firstSummary.validationIssues).toHaveLength(firstSummary.validationIssuePage.count);

    const second = await callTool({
      method: "tools/call",
      params: {
        name: "bundle_summary",
        arguments: {
          validation_offset: firstSummary.validationIssuePage.nextOffset,
          validation_limit: 100
        }
      }
    });
    const secondSummary = second.structuredContent as typeof firstSummary;

    expect(secondSummary).toBeDefined();
    expect(second.content[0]?.text).not.toContain("...truncated");
    expect(secondSummary.validationIssuePage.offset).toBe(
      firstSummary.validationIssuePage.nextOffset
    );
    expect(secondSummary.validationIssues[0]?.rawTarget).not.toBe(
      firstSummary.validationIssues[0]?.rawTarget
    );
  });

  it("omits structuredContent when the text payload is truncated", async () => {
    const server = await createMcpServer({ bundleDir, maxResultChars: 25 });
    const callTool = handler(server, "tools/call");

    const result = await callTool({
      method: "tools/call",
      params: { name: "bundle_summary", arguments: {} }
    });

    expect(result.content[0]?.text).toContain("...truncated");
    expect(result.structuredContent).toBeUndefined();
  });

  it("adds registered source freshness fields to bundle_summary without changing tools", async () => {
    const server = await createMcpServer({
      bundleDir,
      maxResultChars: 2000,
      source: {
        name: "stripe",
        kind: "website",
        seedUrl: "https://docs.stripe.com/checkout"
      },
      refresh: {
        mode: "off",
        getFreshness: async () => ({
          freshnessStatus: "stale",
          lastSuccessfulRefreshAt: "2026-06-16T00:01:10.000Z",
          refreshInProgress: false,
          lastRefreshError: null,
          nextRefreshAllowedAt: "2026-06-16T00:16:10.000Z"
        })
      }
    });
    const listTools = handler(server, "tools/list");
    const callTool = handler(server, "tools/call");

    const listed = (await listTools({ method: "tools/list" })) as unknown as {
      tools: Array<{ name: string }>;
    };
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "search_concepts",
      "read_concept",
      "get_neighbors",
      "list_types",
      "list_tags",
      "bundle_summary"
    ]);

    const summary = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "bundle_summary", arguments: {} }
      })
    ) as {
      conceptCount: number;
      sourceName: string;
      sourceKind: string;
      seedUrl: string;
      freshnessStatus: string;
      lastSuccessfulRefreshAt: string;
      refreshInProgress: boolean;
      lastRefreshError: unknown;
      nextRefreshAllowedAt: string;
    };
    expect(summary).toMatchObject({
      conceptCount: 2,
      sourceName: "stripe",
      sourceKind: "website",
      seedUrl: "https://docs.stripe.com/checkout",
      freshnessStatus: "stale",
      lastSuccessfulRefreshAt: "2026-06-16T00:01:10.000Z",
      refreshInProgress: false,
      lastRefreshError: null,
      nextRefreshAllowedAt: "2026-06-16T00:16:10.000Z"
    });
  });

  it("projects identical shared freshness fields for equivalent bundle and workspace runtimes", async () => {
    let release!: () => void;
    const canFinish = new Promise<void>((resolve) => {
      release = resolve;
    });
    let refreshCount = 0;
    const refresh = {
      mode: "stale-while-refresh" as const,
      getFreshness: () => ({
        freshnessStatus: "stale" as const,
        lastSuccessfulRefreshAt: "2026-06-16T00:01:10.000Z",
        refreshInProgress: false,
        lastRefreshError: { message: "previous failure" },
        nextRefreshAllowedAt: "2026-06-16T00:16:10.000Z"
      }),
      refreshIfNeeded: async () => {
        refreshCount += 1;
        await canFinish;
      }
    };
    const source = {
      name: "stripe",
      kind: "website",
      seedUrl: "https://docs.stripe.com/checkout"
    };
    const bundleServer = await createMcpServer({
      bundleDir,
      maxResultChars: 4000,
      source,
      refresh
    });
    const workspaceServer = await createWorkspaceMcpServer({
      maxResultChars: 4000,
      sources: [{ record: sourceRecord("stripe", bundleDir, sourceState()), refresh }]
    });
    const bundleCall = handler(bundleServer, "tools/call");
    const workspaceCall = handler(workspaceServer, "tools/call");

    await Promise.all([
      bundleCall({
        method: "tools/call",
        params: { name: "search_concepts", arguments: { query: "MCP" } }
      }),
      workspaceCall({
        method: "tools/call",
        params: { name: "search_concepts", arguments: { query: "MCP", source: "stripe" } }
      })
    ]);
    await waitForValue(
      async () => refreshCount,
      (count) => count === 2
    );

    const bundleSummary = parseText(
      await bundleCall({
        method: "tools/call",
        params: { name: "bundle_summary", arguments: {} }
      })
    ) as Record<string, unknown>;
    const workspaceSummary = parseText(
      await workspaceCall({
        method: "tools/call",
        params: { name: "bundle_summary", arguments: { source: "stripe" } }
      })
    ) as { sources: Array<Record<string, unknown>> };
    const sharedKeys = [
      "freshnessStatus",
      "lastSuccessfulRefreshAt",
      "refreshInProgress",
      "lastRefreshError",
      "nextRefreshAllowedAt"
    ];
    const sharedFields = (summary: Record<string, unknown>) =>
      Object.fromEntries(sharedKeys.map((key) => [key, summary[key]]));

    expect(sharedFields(bundleSummary)).toEqual(sharedFields(workspaceSummary.sources[0]!));
    expect(sharedFields(bundleSummary)).toEqual({
      freshnessStatus: "refreshing",
      lastSuccessfulRefreshAt: "2026-06-16T00:01:10.000Z",
      refreshInProgress: true,
      lastRefreshError: { message: "previous failure" },
      nextRefreshAllowedAt: "2026-06-16T00:16:10.000Z"
    });

    release();
  });

  it("exposes source-aware workspace tools without changing the tool list", async () => {
    const root = await tempRoot();
    const stripeBundle = path.join(root, "stripe-bundle");
    const clerkBundle = path.join(root, "clerk-bundle");
    await writeSingleConceptBundle(stripeBundle, {
      title: "Stripe Quickstart",
      type: "Guide",
      body: "Quickstart for checkout sessions.",
      tags: ["payments"]
    });
    await writeSingleConceptBundle(clerkBundle, {
      title: "Clerk Quickstart",
      type: "Guide",
      body: "Quickstart for auth sessions.",
      tags: ["auth"]
    });

    const server = await createWorkspaceMcpServer({
      maxResultChars: 4000,
      availableSourceNames: ["stripe", "clerk", "supabase"],
      sources: [
        { record: sourceRecord("stripe", stripeBundle, sourceState()) },
        { record: sourceRecord("clerk", clerkBundle, sourceState()) }
      ]
    });
    const listTools = handler(server, "tools/list");
    const callTool = handler(server, "tools/call");

    const listed = (await listTools({ method: "tools/list" })) as unknown as {
      tools: Array<{ name: string; inputSchema: { properties: Record<string, unknown> } }>;
    };
    expect(listed.tools.map((tool) => tool.name)).toEqual([
      "search_concepts",
      "read_concept",
      "get_neighbors",
      "list_types",
      "list_tags",
      "bundle_summary"
    ]);
    expect(
      listed.tools.find((tool) => tool.name === "search_concepts")?.inputSchema.properties.source
    ).toBeTruthy();
    expect(listed.tools.find((tool) => tool.name === "search_concepts")?.inputSchema).toMatchObject(
      {
        properties: { limit: { type: "integer", minimum: 1, maximum: 50 } },
        required: ["query"]
      }
    );
    expect(listed.tools.find((tool) => tool.name === "get_neighbors")?.inputSchema).toMatchObject({
      properties: { depth: { type: "integer", minimum: 1, maximum: 2 } },
      required: ["id"]
    });

    const filteredSearchCall = await callTool({
      method: "tools/call",
      params: {
        name: "search_concepts",
        arguments: { query: "quickstart", source: "stripe", limit: 10 }
      }
    });
    const filteredSearch = parseText(filteredSearchCall) as Array<{
      sourceName: string;
      id: string;
      ref: string;
      seedUrl: string;
    }>;
    expect(filteredSearch).toMatchObject([
      {
        sourceName: "stripe",
        id: "concept",
        ref: "stripe:concept",
        seedUrl: "https://docs.example.com/stripe"
      }
    ]);
    expect(filteredSearchCall.structuredContent?.results).toEqual(filteredSearch);

    const ambiguousReadCall = await callTool({
      method: "tools/call",
      params: { name: "read_concept", arguments: { id: "concept" } }
    });
    const ambiguousRead = parseText(ambiguousReadCall) as {
      error: { code: string; candidates: Array<{ sourceName: string; id: string }> };
    };
    expect(ambiguousRead.error).toMatchObject({
      code: "ambiguous_concept",
      candidates: [
        { sourceName: "stripe", id: "concept" },
        { sourceName: "clerk", id: "concept" }
      ]
    });
    expect(ambiguousReadCall.isError).toBe(true);
    expect(ambiguousReadCall.structuredContent?.error).toMatchObject({
      code: "ambiguous_concept"
    });

    const stripeRead = parseText(
      await callTool({
        method: "tools/call",
        params: {
          name: "read_concept",
          arguments: { source: "stripe", id: "concept", max_chars: 80 }
        }
      })
    ) as { sourceName: string; ref: string; markdown_body: string; source_resource: string };
    expect(stripeRead).toMatchObject({
      sourceName: "stripe",
      ref: "stripe:concept",
      source_resource: "https://docs.example.com/concept"
    });
    expect(stripeRead.markdown_body).toContain("Quickstart for checkout");

    const types = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "list_types", arguments: { source: "stripe" } }
      })
    ) as Record<string, number>;
    expect(types).toEqual({ Guide: 1 });

    const tags = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "list_tags", arguments: { source: "clerk" } }
      })
    ) as Record<string, number>;
    expect(tags).toEqual({ auth: 1 });

    const summary = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "bundle_summary", arguments: {} }
      })
    ) as {
      workspace: boolean;
      sourceCount: number;
      usableSourceCount: number;
      conceptCount: number;
      validationStatus: string;
      sources: Array<{
        sourceName: string;
        validationStatus: string;
        freshnessStatus: string;
        refreshInProgress: boolean;
        lastRefreshError: unknown;
      }>;
    };
    expect(summary).toMatchObject({
      workspace: true,
      sourceCount: 2,
      usableSourceCount: 2,
      conceptCount: 2
    });
    expect(summary.validationStatus).toBe("valid");
    expect(summary.sources[0]).toMatchObject({
      sourceName: "stripe",
      validationStatus: "valid",
      freshnessStatus: "fresh",
      refreshInProgress: false,
      lastRefreshError: null
    });
    expect(summary.sources.map((source) => source.sourceName)).toEqual(["stripe", "clerk"]);

    const stripeSummary = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "bundle_summary", arguments: { source: "stripe" } }
      })
    ) as { sourceCount: number; sources: Array<{ sourceName: string }> };
    expect(stripeSummary.sourceCount).toBe(1);
    expect(stripeSummary.sources.map((source) => source.sourceName)).toEqual(["stripe"]);

    const neighbors = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "get_neighbors", arguments: { source: "stripe", id: "concept" } }
      })
    ) as { sourceName: string; ref: string; concepts: Array<{ sourceName: string; ref: string }> };
    expect(neighbors).toMatchObject({ sourceName: "stripe", ref: "stripe:concept" });
    expect(neighbors.concepts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sourceName: "stripe", ref: "stripe:concept" })
      ])
    );

    const unselectedCall = await callTool({
      method: "tools/call",
      params: { name: "search_concepts", arguments: { query: "anything", source: "supabase" } }
    });
    const unselected = parseText(unselectedCall) as { error: { code: string; source: string } };
    expect(unselected.error).toMatchObject({ code: "source_not_in_workspace", source: "supabase" });
    expect(unselectedCall.isError).toBe(true);
    expect(unselectedCall.structuredContent?.error).toMatchObject({
      code: "source_not_in_workspace",
      source: "supabase"
    });

    const unselectedSummaryCall = await callTool({
      method: "tools/call",
      params: { name: "bundle_summary", arguments: { source: "supabase" } }
    });
    const unselectedSummary = parseText(unselectedSummaryCall) as {
      error: { code: string; source: string };
    };
    expect(unselectedSummary.error).toMatchObject({
      code: "source_not_in_workspace",
      source: "supabase"
    });
    expect(unselectedSummaryCall.isError).toBe(true);
  });

  it("keeps workspace MCP usable when one selected bundle is unavailable", async () => {
    const root = await tempRoot();
    const stripeBundle = path.join(root, "stripe-bundle");
    await writeSingleConceptBundle(stripeBundle, {
      title: "Stripe Concept",
      type: "Guide",
      body: "stripe-only-token"
    });

    const server = await createWorkspaceMcpServer({
      maxResultChars: 4000,
      sources: [
        { record: sourceRecord("stripe", stripeBundle, sourceState()) },
        {
          record: {
            ...sourceRecord("missing", path.join(root, "missing-bundle"), sourceState()),
            loadError: { code: "ENOENT", message: "source.json is missing" }
          }
        }
      ]
    });
    const callTool = handler(server, "tools/call");

    const result = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "search_concepts", arguments: { query: "stripe-only-token", limit: 10 } }
      })
    ) as Array<{ sourceName: string; title: string }>;
    expect(result).toMatchObject([{ sourceName: "stripe", title: "Stripe Concept" }]);

    const summary = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "bundle_summary", arguments: {} }
      })
    ) as {
      sourceCount: number;
      usableSourceCount: number;
      validationStatus: string;
      sources: Array<{
        sourceName: string;
        validationStatus: string;
        lastRefreshError: { message: string } | null;
      }>;
    };
    expect(summary).toMatchObject({
      sourceCount: 2,
      usableSourceCount: 1,
      validationStatus: "invalid"
    });
    expect(summary.sources.find((source) => source.sourceName === "missing")).toMatchObject({
      validationStatus: "unavailable",
      lastRefreshError: { code: "ENOENT", message: "source.json is missing" }
    });

    const missingSearchCall = await callTool({
      method: "tools/call",
      params: { name: "search_concepts", arguments: { query: "anything", source: "missing" } }
    });
    const missingSearch = parseText(missingSearchCall) as {
      error: { code: string; sourceName: string };
    };
    expect(missingSearch.error).toMatchObject({
      code: "bundle_unavailable",
      sourceName: "missing",
      message: "source.json is missing"
    });
    expect(missingSearchCall.isError).toBe(true);
    expect(missingSearchCall.structuredContent?.error).toMatchObject({
      code: "bundle_unavailable",
      sourceName: "missing"
    });
  });

  it("keeps healthy workspace sources usable when another source freshness check fails", async () => {
    const root = await tempRoot();
    const stripeBundle = path.join(root, "stripe-bundle");
    const clerkBundle = path.join(root, "clerk-bundle");
    await writeSingleConceptBundle(stripeBundle, {
      title: "Stripe Concept",
      type: "Guide",
      body: "stripe-only-token"
    });
    await writeSingleConceptBundle(clerkBundle, {
      title: "Clerk Concept",
      type: "Guide",
      body: "clerk-only-token"
    });

    const server = await createWorkspaceMcpServer({
      maxResultChars: 4000,
      sources: [
        { record: sourceRecord("stripe", stripeBundle, sourceState()) },
        {
          record: sourceRecord("clerk", clerkBundle, sourceState()),
          refresh: {
            mode: "blocking",
            getFreshness: async () => {
              throw new Error("state file unreadable");
            }
          }
        }
      ]
    });
    const callTool = handler(server, "tools/call");

    const result = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "search_concepts", arguments: { query: "stripe-only-token", limit: 10 } }
      })
    ) as Array<{ sourceName: string; title: string }>;
    expect(result).toMatchObject([{ sourceName: "stripe", title: "Stripe Concept" }]);

    const summary = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "bundle_summary", arguments: {} }
      })
    ) as {
      sources: Array<{
        sourceName: string;
        freshnessStatus: string;
        lastRefreshError: { message: string } | null;
      }>;
    };
    expect(summary.sources.find((source) => source.sourceName === "clerk")).toMatchObject({
      freshnessStatus: "failed",
      lastRefreshError: { message: "state file unreadable" }
    });
  });

  it("keeps workspace summaries source-local when one bundle disappears after startup", async () => {
    const root = await tempRoot();
    const stripeBundle = path.join(root, "stripe-bundle");
    const clerkBundle = path.join(root, "clerk-bundle");
    await writeSingleConceptBundle(stripeBundle, {
      title: "Stripe Concept",
      type: "Guide",
      body: "stripe-only-token"
    });
    await writeSingleConceptBundle(clerkBundle, {
      title: "Clerk Concept",
      type: "Guide",
      body: "clerk-only-token"
    });

    const server = await createWorkspaceMcpServer({
      maxResultChars: 4000,
      sources: [
        { record: sourceRecord("stripe", stripeBundle, sourceState()) },
        { record: sourceRecord("clerk", clerkBundle, sourceState()) }
      ]
    });
    await fs.rm(clerkBundle, { recursive: true, force: true });
    const callTool = handler(server, "tools/call");

    const summary = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "bundle_summary", arguments: {} }
      })
    ) as {
      validationStatus: string;
      sources: Array<{
        sourceName: string;
        validationStatus: string;
        lastRefreshError: { message: string } | null;
      }>;
    };

    expect(summary.validationStatus).toBe("invalid");
    expect(summary.sources.find((source) => source.sourceName === "stripe")).toMatchObject({
      sourceName: "stripe",
      validationStatus: "valid",
      lastRefreshError: null
    });
    expect(summary.sources.find((source) => source.sourceName === "clerk")).toMatchObject({
      sourceName: "clerk",
      validationStatus: "unavailable"
    });
    expect(
      summary.sources.find((source) => source.sourceName === "clerk")?.lastRefreshError?.message
    ).toBeTruthy();
  });

  it("serves usable workspace sources while stale sources refresh in the background", async () => {
    const root = await tempRoot();
    const stripeBundle = path.join(root, "stripe-bundle");
    const clerkBundle = path.join(root, "clerk-bundle");
    await writeSingleConceptBundle(stripeBundle, {
      title: "Old Stripe Concept",
      type: "Guide",
      body: "old-stripe-token"
    });
    await writeSingleConceptBundle(clerkBundle, {
      title: "Clerk Concept",
      type: "Guide",
      body: "clerk-token"
    });

    let stripeFreshness: "stale" | "refreshing" | "fresh" = "stale";
    let releaseRefresh!: () => void;
    const refreshCanFinish = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let refreshStarted!: () => void;
    const refreshDidStart = new Promise<void>((resolve) => {
      refreshStarted = resolve;
    });

    const server = await createWorkspaceMcpServer({
      maxResultChars: 4000,
      sources: [
        {
          record: sourceRecord("stripe", stripeBundle, sourceState({ status: "stale" })),
          refresh: {
            mode: "stale-while-refresh",
            getFreshness: async () => ({
              freshnessStatus: stripeFreshness,
              refreshInProgress: stripeFreshness === "refreshing",
              lastRefreshError: null
            }),
            refreshIfNeeded: async () => {
              stripeFreshness = "refreshing";
              refreshStarted();
              await refreshCanFinish;
              await writeSingleConceptBundle(stripeBundle, {
                title: "New Stripe Concept",
                type: "Guide",
                body: "new-stripe-token"
              });
              stripeFreshness = "fresh";
              return { bundleDir: stripeBundle };
            }
          }
        },
        {
          record: sourceRecord("clerk", clerkBundle, sourceState()),
          refresh: {
            mode: "stale-while-refresh",
            getFreshness: async () => ({
              freshnessStatus: "fresh",
              refreshInProgress: false,
              lastRefreshError: null
            })
          }
        }
      ]
    });
    const callTool = handler(server, "tools/call");

    const cachedSearch = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "search_concepts", arguments: { query: "token", limit: 10 } }
      })
    ) as Array<{ title: string; sourceName: string }>;
    expect(cachedSearch.map((result) => [result.sourceName, result.title])).toEqual([
      ["clerk", "Clerk Concept"],
      ["stripe", "Old Stripe Concept"]
    ]);
    await refreshDidStart;

    releaseRefresh();

    const refreshedSearch = await waitForValue(
      async () =>
        parseText(
          await callTool({
            method: "tools/call",
            params: {
              name: "search_concepts",
              arguments: { query: "new-stripe-token", source: "stripe", limit: 10 }
            }
          })
        ) as Array<{ title: string; sourceName: string }>,
      (results) => results.some((result) => result.title === "New Stripe Concept")
    );
    expect(refreshedSearch).toMatchObject([{ title: "New Stripe Concept", sourceName: "stripe" }]);
  });

  it("blocks refresh only for the requested workspace source", async () => {
    const root = await tempRoot();
    const stripeBundle = path.join(root, "stripe-bundle");
    const clerkBundle = path.join(root, "clerk-bundle");
    await writeSingleConceptBundle(stripeBundle, {
      title: "Old Stripe Concept",
      type: "Guide",
      body: "old-stripe-token"
    });
    await writeSingleConceptBundle(clerkBundle, {
      title: "Old Clerk Concept",
      type: "Guide",
      body: "old-clerk-token"
    });

    let stripeRefreshCount = 0;
    let clerkRefreshCount = 0;
    const server = await createWorkspaceMcpServer({
      maxResultChars: 4000,
      sources: [
        {
          record: sourceRecord("stripe", stripeBundle, sourceState({ status: "stale" })),
          refresh: {
            mode: "blocking",
            getFreshness: async () => ({
              freshnessStatus: "stale",
              refreshInProgress: false,
              lastRefreshError: null
            }),
            refreshIfNeeded: async () => {
              stripeRefreshCount += 1;
              await writeSingleConceptBundle(stripeBundle, {
                title: "New Stripe Concept",
                type: "Guide",
                body: "new-stripe-token"
              });
              return { bundleDir: stripeBundle };
            }
          }
        },
        {
          record: sourceRecord("clerk", clerkBundle, sourceState({ status: "stale" })),
          refresh: {
            mode: "blocking",
            getFreshness: async () => ({
              freshnessStatus: "stale",
              refreshInProgress: false,
              lastRefreshError: null
            }),
            refreshIfNeeded: async () => {
              clerkRefreshCount += 1;
              await writeSingleConceptBundle(clerkBundle, {
                title: "New Clerk Concept",
                type: "Guide",
                body: "new-clerk-token"
              });
              return { bundleDir: clerkBundle };
            }
          }
        }
      ]
    });
    const callTool = handler(server, "tools/call");

    const result = parseText(
      await callTool({
        method: "tools/call",
        params: {
          name: "search_concepts",
          arguments: { query: "new-clerk-token", source: "clerk", limit: 10 }
        }
      })
    ) as Array<{ title: string; sourceName: string }>;

    expect(result).toMatchObject([{ title: "New Clerk Concept", sourceName: "clerk" }]);
    expect(clerkRefreshCount).toBe(1);
    expect(stripeRefreshCount).toBe(0);
  });

  it("keeps cached workspace rows visible when one source refresh fails", async () => {
    const root = await tempRoot();
    const stripeBundle = path.join(root, "stripe-bundle");
    await writeSingleConceptBundle(stripeBundle, {
      title: "Cached Stripe Concept",
      type: "Guide",
      body: "cached-stripe-token"
    });

    const server = await createWorkspaceMcpServer({
      maxResultChars: 4000,
      sources: [
        {
          record: sourceRecord("stripe", stripeBundle, sourceState({ status: "stale" })),
          refresh: {
            mode: "blocking",
            getFreshness: async () => ({
              freshnessStatus: "stale",
              refreshInProgress: false,
              lastRefreshError: null
            }),
            refreshIfNeeded: async () => {
              throw new Error("network offline");
            }
          }
        }
      ]
    });
    const callTool = handler(server, "tools/call");

    const cachedSearch = parseText(
      await callTool({
        method: "tools/call",
        params: {
          name: "search_concepts",
          arguments: { query: "cached-stripe-token", source: "stripe", limit: 10 }
        }
      })
    ) as Array<{ title: string; sourceName: string }>;
    expect(cachedSearch).toMatchObject([{ title: "Cached Stripe Concept", sourceName: "stripe" }]);

    const summary = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "bundle_summary", arguments: { source: "stripe" } }
      })
    ) as { sources: Array<{ freshnessStatus: string; lastRefreshError: { message: string } }> };
    expect(summary.sources[0]).toMatchObject({
      freshnessStatus: "failed",
      lastRefreshError: { message: "network offline" }
    });
  });

  it("serves stale results while a background refresh reloads search for later calls", async () => {
    const root = await tempRoot();
    const reloadedBundle = path.join(root, "bundle");
    await writeSingleConceptBundle(reloadedBundle, {
      title: "Old Concept",
      type: "OldType",
      body: "old-only-token"
    });

    let freshnessStatus: "stale" | "refreshing" | "fresh" = "stale";
    let releaseRefresh!: () => void;
    const refreshCanFinish = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });
    let refreshStarted!: () => void;
    const refreshDidStart = new Promise<void>((resolve) => {
      refreshStarted = resolve;
    });

    const server = await createMcpServer({
      bundleDir: reloadedBundle,
      maxResultChars: 2000,
      source: { name: "stripe", kind: "website", seedUrl: "https://docs.stripe.com/checkout" },
      refresh: {
        mode: "stale-while-refresh",
        getFreshness: async () => ({
          freshnessStatus,
          refreshInProgress: freshnessStatus === "refreshing",
          lastRefreshError: null
        }),
        refreshIfNeeded: async () => {
          freshnessStatus = "refreshing";
          refreshStarted();
          await refreshCanFinish;
          await writeSingleConceptBundle(reloadedBundle, {
            title: "New Concept",
            type: "NewType",
            body: "new-only-token"
          });
          freshnessStatus = "fresh";
          return { bundleDir: reloadedBundle };
        }
      }
    });
    const callTool = handler(server, "tools/call");

    const staleSearch = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "search_concepts", arguments: { query: "old-only-token", limit: 5 } }
      })
    ) as Array<{ title: string }>;
    expect(staleSearch.map((item) => item.title)).toEqual(["Old Concept"]);
    await refreshDidStart;

    releaseRefresh();

    const refreshedSearch = await waitForValue(
      async () =>
        parseText(
          await callTool({
            method: "tools/call",
            params: { name: "search_concepts", arguments: { query: "new-only-token", limit: 5 } }
          })
        ) as Array<{ title: string }>,
      (results) => results.some((result) => result.title === "New Concept")
    );
    expect(refreshedSearch.map((item) => item.title)).toEqual(["New Concept"]);
  });

  it("blocks before searchable/listable tools when a registered source is stale", async () => {
    const root = await tempRoot();
    const reloadedBundle = path.join(root, "bundle");
    await writeSingleConceptBundle(reloadedBundle, {
      title: "Old Concept",
      type: "OldType",
      body: "old-only-token"
    });

    let freshnessStatus: "stale" | "fresh" = "stale";
    const server = await createMcpServer({
      bundleDir: reloadedBundle,
      maxResultChars: 2000,
      source: { name: "stripe", kind: "website", seedUrl: "https://docs.stripe.com/checkout" },
      refresh: {
        mode: "blocking",
        getFreshness: async () => ({
          freshnessStatus,
          refreshInProgress: false,
          lastRefreshError: null
        }),
        refreshIfNeeded: async () => {
          await writeSingleConceptBundle(reloadedBundle, {
            title: "New Concept",
            type: "NewType",
            body: "new-only-token"
          });
          freshnessStatus = "fresh";
          return { bundleDir: reloadedBundle };
        }
      }
    });
    const callTool = handler(server, "tools/call");

    const types = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "list_types", arguments: {} }
      })
    ) as Record<string, number>;
    expect(types).toEqual({ NewType: 1 });

    const searchResult = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "search_concepts", arguments: { query: "new-only-token", limit: 5 } }
      })
    ) as Array<{ title: string }>;
    expect(searchResult.map((item) => item.title)).toEqual(["New Concept"]);
  });

  it("retries a failed cached source once the next refresh time has passed", async () => {
    const root = await tempRoot();
    const reloadedBundle = path.join(root, "bundle");
    await writeSingleConceptBundle(reloadedBundle, {
      title: "Cached Concept",
      type: "CachedType",
      body: "cached-only-token"
    });

    let refreshCount = 0;
    let freshnessStatus: "failed" | "fresh" = "failed";
    const server = await createMcpServer({
      bundleDir: reloadedBundle,
      maxResultChars: 2000,
      source: { name: "stripe", kind: "website", seedUrl: "https://docs.stripe.com/checkout" },
      refresh: {
        mode: "blocking",
        getFreshness: async () => ({
          freshnessStatus,
          refreshInProgress: false,
          lastRefreshError: freshnessStatus === "failed" ? { message: "network offline" } : null,
          nextRefreshAllowedAt: "2026-06-16T00:01:00.000Z"
        }),
        refreshIfNeeded: async () => {
          refreshCount += 1;
          await writeSingleConceptBundle(reloadedBundle, {
            title: "Recovered Concept",
            type: "RecoveredType",
            body: "recovered-only-token"
          });
          freshnessStatus = "fresh";
          return { bundleDir: reloadedBundle };
        }
      }
    });
    const callTool = handler(server, "tools/call");

    const searchResult = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "search_concepts", arguments: { query: "recovered-only-token", limit: 5 } }
      })
    ) as Array<{ title: string }>;

    expect(refreshCount).toBe(1);
    expect(searchResult.map((item) => item.title)).toEqual(["Recovered Concept"]);
  });

  it("keeps serving the previous bundle when refresh fails and reports no-bundle failures as structured errors", async () => {
    const root = await tempRoot();
    const usableBundle = path.join(root, "usable-bundle");
    await writeSingleConceptBundle(usableBundle, {
      title: "Cached Concept",
      type: "CachedType",
      body: "cached-only-token"
    });

    const failingServer = await createMcpServer({
      bundleDir: usableBundle,
      maxResultChars: 2000,
      source: { name: "stripe", kind: "website", seedUrl: "https://docs.stripe.com/checkout" },
      refresh: {
        mode: "blocking",
        getFreshness: async () => ({
          freshnessStatus: "stale",
          refreshInProgress: false,
          lastRefreshError: null
        }),
        refreshIfNeeded: async () => {
          throw new Error("network offline");
        }
      }
    });
    const failingCallTool = handler(failingServer, "tools/call");
    const cachedSearch = parseText(
      await failingCallTool({
        method: "tools/call",
        params: { name: "search_concepts", arguments: { query: "cached-only-token", limit: 5 } }
      })
    ) as Array<{ title: string }>;
    expect(cachedSearch.map((item) => item.title)).toEqual(["Cached Concept"]);

    const failureSummary = parseText(
      await failingCallTool({
        method: "tools/call",
        params: { name: "bundle_summary", arguments: {} }
      })
    ) as { lastRefreshError: { message: string }; freshnessStatus: string };
    expect(failureSummary.freshnessStatus).toBe("failed");
    expect(failureSummary.lastRefreshError.message).toBe("network offline");

    const missingServer = await createMcpServer({
      bundleDir: path.join(root, "missing-bundle"),
      maxResultChars: 2000,
      source: { name: "missing", kind: "website", seedUrl: "https://docs.example.com" },
      refresh: {
        mode: "blocking",
        getFreshness: async () => ({
          freshnessStatus: "missing",
          refreshInProgress: false,
          lastRefreshError: null
        }),
        refreshIfNeeded: async () => {
          throw new Error("first crawl failed");
        }
      }
    });
    const missingCallTool = handler(missingServer, "tools/call");
    const missingSearch = parseText(
      await missingCallTool({
        method: "tools/call",
        params: { name: "search_concepts", arguments: { query: "anything" } }
      })
    ) as { error: { code: string; message: string; sourceName: string } };
    expect(missingSearch.error).toMatchObject({
      code: "bundle_unavailable",
      sourceName: "missing"
    });
    expect(missingSearch.error.message).toContain("first crawl failed");
  });
});

describe("MCP source runtime", () => {
  it("preserves the original load error for an unregistered missing bundle", async () => {
    const root = await tempRoot();
    await expect(
      createMcpServer({ bundleDir: path.join(root, "missing-bundle") })
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("coalesces concurrent blocking refreshes into one in-flight operation", async () => {
    let release!: () => void;
    const canFinish = new Promise<void>((resolve) => {
      release = resolve;
    });
    let refreshCount = 0;
    const runtime = await createSourceRuntime({
      bundleDir,
      refresh: {
        getFreshness: () => ({ freshnessStatus: "stale" }),
        refreshIfNeeded: async () => {
          refreshCount += 1;
          await canFinish;
        }
      }
    });

    const first = prepareSourceRuntime(runtime, "blocking", true);
    const second = prepareSourceRuntime(runtime, "blocking", true);
    await waitForValue(
      async () => refreshCount,
      (count) => count === 1
    );
    expect(refreshCount).toBe(1);
    release();
    await Promise.all([first, second]);
  });

  it("cleans up a synchronous refresh failure so a later request can retry", async () => {
    let refreshCount = 0;
    const runtime = await createSourceRuntime({
      bundleDir,
      refresh: {
        getFreshness: () => ({ freshnessStatus: "stale" }),
        refreshIfNeeded: () => {
          refreshCount += 1;
          throw new Error("refresh failed synchronously");
        }
      }
    });

    await prepareSourceRuntime(runtime, "blocking", true);
    await prepareSourceRuntime(runtime, "blocking", true);

    expect(refreshCount).toBe(2);
    expect(runtime.inFlightRefresh).toBeUndefined();
    expect(runtime.lastRefreshError).toMatchObject({
      message: "refresh failed synchronously"
    });
  });

  it("keeps the previous search and bundle path when refreshed bundle loading fails", async () => {
    const root = await tempRoot();
    const invalidBundle = path.join(root, "invalid-refreshed-bundle");
    await fs.mkdir(invalidBundle, { recursive: true });
    await fs.writeFile(path.join(invalidBundle, "concept.md"), "---\ntitle: [\n---\n", "utf8");
    const runtime = await createSourceRuntime({
      bundleDir,
      refresh: {
        getFreshness: () => ({ freshnessStatus: "stale" }),
        refreshIfNeeded: () => ({ bundleDir: invalidBundle })
      }
    });
    const previousSearch = runtime.search;

    await prepareSourceRuntime(runtime, "blocking", true);

    expect(runtime.activeBundleDir).toBe(bundleDir);
    expect(runtime.search).toBe(previousSearch);
    expect(runtime.lastRefreshError?.message).toBeTruthy();
    expect(runtime.inFlightRefresh).toBeUndefined();
  });

  it("does not call freshness hooks when a registered source has a load error", async () => {
    let freshnessCalls = 0;
    const runtime = await createSourceRuntime({
      bundleDir,
      loadError: { code: "ENOENT", message: "source.json is missing" },
      refresh: {
        getFreshness: () => {
          freshnessCalls += 1;
          return { freshnessStatus: "fresh" };
        }
      }
    });

    expect(await getSourceFreshness(runtime)).toMatchObject({ freshnessStatus: "failed" });
    expect(freshnessCalls).toBe(0);
  });
});

describe("CLI smoke", () => {
  it("runs dist validate when build output is present", async () => {
    const cli = path.resolve("dist/cli.js");
    try {
      await fs.access(cli);
    } catch {
      return;
    }

    const { stdout, stderr } = await execFileAsync(process.execPath, [
      cli,
      "validate",
      bundleDir,
      "--json"
    ]);
    const report = JSON.parse(stdout) as { valid: boolean; conceptCount: number };
    expect(report).toMatchObject({ valid: true, conceptCount: 2 });
    expect(stderr).toContain("okfy validate: checking");
    expect(stderr).toContain("okfy validate: valid, 2 concepts");
  });

  it("serves MCP over stdio as JSON-RPC only from built CLI", async () => {
    const cli = path.resolve("dist/cli.js");
    await fs.access(cli);
    const packageJson = JSON.parse(await fs.readFile("package.json", "utf8")) as {
      version: string;
    };

    await withBuiltCliMcpSession(
      ["serve", "examples/bundles/okfy-docs", "--mcp"],
      {},
      async ({ initializeResponse, stdoutLines, stderr, send, waitFor }) => {
        const serverInfo = (
          initializeResponse.result as { serverInfo?: { version?: string } } | undefined
        )?.serverInfo;
        expect(serverInfo?.version).toBe(packageJson.version);

        send(2, "tools/list");
        const toolsResponse = (await waitFor(2)) as { result: { tools: Array<{ name: string }> } };
        expect(toolsResponse.result.tools.map((tool) => tool.name)).toContain("bundle_summary");

        send(3, "tools/call", { name: "bundle_summary", arguments: {} });
        const summaryResponse = (await waitFor(3)) as {
          result: { content: Array<{ text: string }>; structuredContent?: Record<string, unknown> };
        };
        const summary = JSON.parse(summaryResponse.result.content[0]?.text ?? "{}") as {
          conceptCount: number;
          reservedFileCount: number;
          validationStatus: string;
        };
        expect(summary).toMatchObject({
          conceptCount: 6,
          reservedFileCount: 4,
          validationStatus: "valid"
        });
        expect(summaryResponse.result.structuredContent).toMatchObject(summary);

        send(4, "tools/call", { name: "read_concept", arguments: { id: "index" } });
        const missingConceptResponse = (await waitFor(4)) as {
          result: { isError?: boolean; structuredContent?: { error?: { code?: string } } };
        };
        expect(missingConceptResponse.result.isError).toBe(true);
        expect(missingConceptResponse.result.structuredContent?.error?.code).toBe(
          "unknown_concept"
        );

        for (const line of stdoutLines) {
          const parsed = JSON.parse(line) as { jsonrpc?: string };
          expect(parsed.jsonrpc).toBe("2.0");
        }
        expect(stderr()).toContain("okfy serve: loading examples/bundles/okfy-docs");
        expect(stderr()).toContain("okfy serve: ready on stdio");
      }
    );
  });

  it("requires dangerous override for unsafe force output paths", async () => {
    const cli = path.resolve("dist/cli.js");
    await fs.access(cli);
    const root = await tempRoot();
    const input = path.join(root, "docs");
    await fs.mkdir(input);
    const sourceFile = path.join(input, "guide.md");
    await fs.writeFile(sourceFile, "# Guide\n\nHello.", "utf8");

    await expect(
      execFileAsync(process.execPath, [
        cli,
        "import",
        input,
        "--out",
        root,
        "--force",
        "--stable-timestamps"
      ])
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/Unsafe output directory for --force/i)
    });
    await expect(fs.readFile(sourceFile, "utf8")).resolves.toContain("Hello.");

    const { stdout } = await execFileAsync(process.execPath, [
      cli,
      "import",
      input,
      "--out",
      root,
      "--force",
      "--dangerously-allow-unsafe-output",
      "--stable-timestamps"
    ]);

    expect(stdout).toContain("okfy import");
    await expect(fs.readFile(path.join(root, "guide.md"), "utf8")).resolves.toContain(
      'type: "Guide"'
    );
    await expect(fs.access(sourceFile)).rejects.toThrow();
  });

  it("rejects force output paths that would delete OKFY_HOME", async () => {
    const cli = path.resolve("dist/cli.js");
    await fs.access(cli);
    const root = await tempRoot();
    const inputRoot = await tempRoot();
    const input = path.join(inputRoot, "docs");
    const okfyHome = path.join(root, ".okfy");
    await fs.mkdir(input);
    await fs.mkdir(okfyHome, { recursive: true });
    await fs.writeFile(path.join(input, "guide.md"), "# Guide\n\nHello.", "utf8");
    const sentinel = path.join(okfyHome, "sentinel.txt");
    await fs.writeFile(sentinel, "keep me", "utf8");

    await expect(
      execFileAsync(
        process.execPath,
        [cli, "import", input, "--out", root, "--force", "--stable-timestamps"],
        {
          env: { ...process.env, OKFY_HOME: okfyHome }
        }
      )
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(/ancestor of OKFY_HOME/i)
    });
    await expect(fs.readFile(sentinel, "utf8")).resolves.toBe("keep me");
  });
});
