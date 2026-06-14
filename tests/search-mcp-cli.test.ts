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
