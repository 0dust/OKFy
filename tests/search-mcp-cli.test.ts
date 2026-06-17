import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpServer } from "../src/mcp.js";
import { BundleSearch } from "../src/search.js";

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

type McpTextResult = { content: Array<{ type: "text"; text: string }> };
type Handler = (request: unknown, extra?: unknown) => Promise<McpTextResult>;

function handler(server: unknown, method: string): Handler {
  const handlers = (server as { _requestHandlers: Map<string, Handler> })._requestHandlers;
  const found = handlers.get(method);
  if (!found) throw new Error(`Missing MCP handler: ${method}`);
  return found;
}

function parseText(result: McpTextResult): unknown {
  return JSON.parse(result.content[0]?.text ?? "null");
}

async function writeSingleConceptBundle(
  dir: string,
  concept: { title: string; type: string; body: string; description?: string; tags?: string[] }
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
    `---\ntype: "${concept.type}"\ntitle: "${concept.title}"\ndescription: "${concept.description ?? concept.body}"\nresource: "https://docs.example.com/concept"\ntags:\n${tags.map((tag) => `  - "${tag}"`).join("\n")}\ntimestamp: "2026-06-14T00:00:00.000Z"\n---\n\n# ${concept.title}\n\n${concept.body}\n`,
    "utf8"
  );
}

describe("search", () => {
  it("searches concepts with type/tag filters and path lookup", async () => {
    const search = await BundleSearch.fromBundle(bundleDir);

    const results = search.search("MCP tool", { type: "API Reference", tags: ["mcp"], limit: 1 });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "reference/api", title: "API Reference", type: "API Reference" });
    expect(results[0]?.snippet).toContain("search_concepts");

    expect(search.getConcept("guides/quickstart.md")?.id).toBe("guides/quickstart");
    expect(search.getConcept("index")).toBeUndefined();
    expect(search.search("Okfy Fixture", { limit: 10 }).map((item) => item.id)).not.toContain("index");
    expect(search.graph.outbound.get("guides/quickstart")).toEqual(["reference/api"]);
    expect(search.graph.backlinks.get("reference/api")).toEqual(["guides/quickstart"]);
    expect([...search.graph.concepts.keys()].sort()).toEqual(["guides/quickstart", "reference/api"]);
  });
});

describe("MCP server", () => {
  it("lists PRD tools and calls search/read/neighbors directly", async () => {
    const server = await createMcpServer({ bundleDir, maxResultChars: 2000 });
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

    const searchResult = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "search_concepts", arguments: { query: "install okfy", limit: 2 } }
      })
    ) as Array<{ id: string }>;
    expect(searchResult.map((item) => item.id)).toContain("guides/quickstart");

    const readResult = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "read_concept", arguments: { id: "reference/api", max_chars: 40 } }
      })
    ) as { markdown_body: string; outbound_links: string[]; backlinks: string[] };
    expect(readResult.markdown_body.length).toBeLessThanOrEqual(40);
    expect(readResult.outbound_links).toEqual(["guides/quickstart"]);
    expect(readResult.backlinks).toEqual(["guides/quickstart"]);

    const reservedRead = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "read_concept", arguments: { id: "index" } }
      })
    ) as { error: { code: string } };
    expect(reservedRead.error.code).toBe("unknown_concept");

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
    ) as { conceptCount: number; reservedFileCount: number; warningCount: number; validationStatus: string };
    expect(summary).toMatchObject({ conceptCount: 2, reservedFileCount: 3, warningCount: 0, validationStatus: "valid" });
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
    await new Promise((resolve) => setTimeout(resolve, 25));

    const refreshedSearch = parseText(
      await callTool({
        method: "tools/call",
        params: { name: "search_concepts", arguments: { query: "new-only-token", limit: 5 } }
      })
    ) as Array<{ title: string }>;
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
        getFreshness: async () => ({ freshnessStatus, refreshInProgress: false, lastRefreshError: null }),
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

describe("CLI smoke", () => {
  it("runs dist validate when build output is present", async () => {
    const cli = path.resolve("dist/cli.js");
    try {
      await fs.access(cli);
    } catch {
      return;
    }

    const { stdout, stderr } = await execFileAsync(process.execPath, [cli, "validate", bundleDir, "--json"]);
    const report = JSON.parse(stdout) as { valid: boolean; conceptCount: number };
    expect(report).toMatchObject({ valid: true, conceptCount: 2 });
    expect(stderr).toContain("okfy validate: checking");
    expect(stderr).toContain("okfy validate: valid, 2 concepts");
  });

  it("serves MCP over stdio as JSON-RPC only from built CLI", async () => {
    const cli = path.resolve("dist/cli.js");
    await fs.access(cli);

    const child = spawn(process.execPath, [cli, "serve", "examples/bundles/okfy-docs", "--mcp"], {
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdoutLines: string[] = [];
    let stdoutBuffer = "";
    let stderr = "";

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString("utf8");
      let newlineIndex = stdoutBuffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (line) stdoutLines.push(line);
        newlineIndex = stdoutBuffer.indexOf("\n");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const send = (id: number, method: string, params: Record<string, unknown> = {}) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    };
    const waitFor = async (id: number) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        for (const line of stdoutLines) {
          const parsed = JSON.parse(line) as { id?: number } & Record<string, unknown>;
          if (parsed.id === id) return parsed;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(`Timed out waiting for MCP response ${id}; stdout=${stdoutLines.join("\n")} stderr=${stderr}`);
    };

    try {
      send(1, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "okfy-vitest", version: "0.1.0" }
      });
      await waitFor(1);
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);

      send(2, "tools/list");
      const toolsResponse = (await waitFor(2)) as { result: { tools: Array<{ name: string }> } };
      expect(toolsResponse.result.tools.map((tool) => tool.name)).toContain("bundle_summary");

      send(3, "tools/call", { name: "bundle_summary", arguments: {} });
      const summaryResponse = (await waitFor(3)) as { result: { content: Array<{ text: string }> } };
      const summary = JSON.parse(summaryResponse.result.content[0]?.text ?? "{}") as {
        conceptCount: number;
        reservedFileCount: number;
        validationStatus: string;
      };
      expect(summary).toMatchObject({ conceptCount: 6, reservedFileCount: 4, validationStatus: "valid" });

      for (const line of stdoutLines) {
        const parsed = JSON.parse(line) as { jsonrpc?: string };
        expect(parsed.jsonrpc).toBe("2.0");
      }
      expect(stderr).toContain("okfy serve: loading examples/bundles/okfy-docs");
      expect(stderr).toContain("okfy serve: ready on stdio");
    } finally {
      child.kill("SIGTERM");
    }
  });

  it("requires dangerous override for unsafe force output paths", async () => {
    const cli = path.resolve("dist/cli.js");
    await fs.access(cli);
    const root = await tempRoot();
    const input = path.join(root, "docs");
    await fs.mkdir(input);
    const sourceFile = path.join(input, "guide.md");
    await fs.writeFile(sourceFile, "# Guide\n\nHello.", "utf8");

    await expect(execFileAsync(process.execPath, [cli, "import", input, "--out", root, "--force", "--stable-timestamps"])).rejects.toMatchObject({
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
    await expect(fs.readFile(path.join(root, "guide.md"), "utf8")).resolves.toContain('type: "Guide"');
    await expect(fs.access(sourceFile)).rejects.toThrow();
  });
});
