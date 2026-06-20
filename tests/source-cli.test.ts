import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { readRefreshState } from "../src/source-store.js";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function tempHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-home-"));
  tempDirs.push(dir);
  return dir;
}

async function startDocsServer(): Promise<{
  origin: string;
  setFailing(value: boolean): void;
  setVersion(value: string): void;
  close(): Promise<void>;
}> {
  let version = "v1";
  let failing = false;
  const server = http.createServer((request, response) => {
    if (failing) {
      response.statusCode = 500;
      response.end("offline");
      return;
    }
    response.setHeader("content-type", "text/html");
    if (request.url === "/") {
      response.end(`<main><h1>Checkout ${version}</h1><a href="/sessions">Sessions</a></main>`);
    } else if (request.url === "/sessions") {
      response.end(`<main><h1>Sessions ${version}</h1><p>Create Checkout Sessions ${version}.</p></main>`);
    } else {
      response.statusCode = 404;
      response.end("missing");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP test server.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    setFailing(value) {
      failing = value;
    },
    setVersion(value) {
      version = value;
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

async function runCli(args: string[], okfyHome: string): Promise<{ stdout: string; stderr: string }> {
  const cli = path.resolve("dist/cli.js");
  await fs.access(cli);
  return execFileAsync(process.execPath, [cli, ...args], {
    env: { ...process.env, OKFY_HOME: okfyHome }
  });
}

function parseJson<T>(stdout: string): T {
  return JSON.parse(stdout) as T;
}

async function stateHash(okfyHome: string, name: string): Promise<string | undefined> {
  return (await readRefreshState(name, { okfyHome })).bundle?.contentHash;
}

async function markSourceOld(okfyHome: string, name: string): Promise<void> {
  const statePath = path.join(okfyHome, "sources", name, "state.json");
  const parsed = JSON.parse(await fs.readFile(statePath, "utf8")) as Record<string, unknown>;
  parsed.status = "fresh";
  parsed.lastSuccessfulRefreshAt = "2026-01-01T00:00:00.000Z";
  parsed.nextRefreshAllowedAt = "2026-01-01T00:00:00.000Z";
  await fs.writeFile(statePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

async function waitForFileContains(filePath: string, expected: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fs.readFile(filePath, "utf8")).includes(expected)) return true;
    } catch {
      // Keep polling while the bundle is being atomically replaced.
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return false;
}

async function withMcpSession<T>(
  args: string[],
  okfyHome: string,
  run: (session: {
    stdoutLines: string[];
    stderr: () => string;
    send(id: number, method: string, params?: Record<string, unknown>): void;
    waitFor(id: number): Promise<Record<string, unknown>>;
  }) => Promise<T>
): Promise<T> {
  const cli = path.resolve("dist/cli.js");
  await fs.access(cli);
  const child = spawn(process.execPath, [cli, ...args], {
    env: { ...process.env, OKFY_HOME: okfyHome },
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
      clientInfo: { name: "okfy-source-vitest", version: "0.1.0" }
    });
    await waitFor(1);
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
    return await run({ stdoutLines, stderr: () => stderr, send, waitFor });
  } finally {
    child.kill("SIGTERM");
  }
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("registered source CLI flow", () => {
  it("adds, lists, checks, updates, preserves active bundle on failure, and removes a source", async () => {
    const okfyHome = await tempHome();
    const docs = await startDocsServer();
    try {
      const add = await runCli(
        [
          "add",
          "stripe",
          `${docs.origin}/`,
          "--max-pages",
          "3",
          "--max-depth",
          "1",
          "--allow-private-network",
          "--no-respect-robots",
          "--json"
        ],
        okfyHome
      );
      const addJson = parseJson<{ name: string; status: string; bundlePath: string; conceptCount: number }>(add.stdout);
      expect(addJson).toMatchObject({ name: "stripe", status: "fresh", conceptCount: 2 });
      expect(addJson.bundlePath).toContain(path.join(okfyHome, "sources", "stripe", "bundle"));
      const hashAfterAdd = await stateHash(okfyHome, "stripe");
      expect(hashAfterAdd).toMatch(/^sha256:/);

      const sources = parseJson<Array<{ name: string; status: string; seedUrl: string }>>((await runCli(["sources", "--json"], okfyHome)).stdout);
      expect(sources).toMatchObject([{ name: "stripe", status: "fresh", seedUrl: `${docs.origin}/` }]);
      await expect(stateHash(okfyHome, "stripe")).resolves.toBe(hashAfterAdd);

      const fresh = parseJson<{ status: string; valid: boolean }>((await runCli(["check", "stripe", "--json"], okfyHome)).stdout);
      expect(fresh).toMatchObject({ status: "fresh", valid: true });
      await expect(stateHash(okfyHome, "stripe")).resolves.toBe(hashAfterAdd);

      await markSourceOld(okfyHome, "stripe");
      await expect(runCli(["check", "stripe", "--max-age", "1s", "--json"], okfyHome)).rejects.toMatchObject({
        stdout: expect.stringContaining('"status": "stale"')
      });

      docs.setVersion("v2");
      const update = parseJson<{ status: string; newConceptCount: number }>((await runCli(["update", "stripe", "--json"], okfyHome)).stdout);
      expect(update).toMatchObject({ status: "fresh", newConceptCount: 2 });
      await expect(fs.readFile(path.join(okfyHome, "sources", "stripe", "bundle", "sessions.md"), "utf8")).resolves.toContain("v2");

      docs.setFailing(true);
      await expect(runCli(["update", "stripe", "--json"], okfyHome)).rejects.toMatchObject({
        stdout: expect.stringContaining('"status": "failed"')
      });
      await expect(fs.readFile(path.join(okfyHome, "sources", "stripe", "bundle", "sessions.md"), "utf8")).resolves.toContain("v2");

      const failed = parseJson<{ status: string; lastError: { message: string } | null }>(
        (await runCli(["check", "stripe", "--json"], okfyHome).catch((error: { stdout: string }) => ({ stdout: error.stdout }))).stdout
      );
      expect(failed.status).toBe("failed");
      expect(failed.lastError?.message).toContain("Crawl generated zero concepts");

      const removed = parseJson<{ removed: boolean; name: string }>((await runCli(["remove", "stripe", "--yes", "--json"], okfyHome)).stdout);
      expect(removed).toEqual({ removed: true, name: "stripe" });
      await expect(fs.access(path.join(okfyHome, "sources", "stripe"))).rejects.toThrow();
    } finally {
      await docs.close();
    }
  });

  it("serves a registered source over MCP with freshness metadata and JSON-RPC-only stdout", async () => {
    const okfyHome = await tempHome();
    const docs = await startDocsServer();
    try {
      await runCli(
        [
          "add",
          "stripe",
          `${docs.origin}/`,
          "--max-pages",
          "3",
          "--max-depth",
          "1",
          "--allow-private-network",
          "--no-respect-robots",
          "--max-age",
          "1s",
          "--json"
        ],
        okfyHome
      );
      const hashAfterAdd = await stateHash(okfyHome, "stripe");
      expect(hashAfterAdd).toMatch(/^sha256:/);

      const cli = path.resolve("dist/cli.js");
      const child = spawn(process.execPath, [cli, "serve", "stripe", "--mcp", "--auto-refresh"], {
        env: { ...process.env, OKFY_HOME: okfyHome },
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
          clientInfo: { name: "okfy-source-vitest", version: "0.1.0" }
        });
        await waitFor(1);
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);

        send(2, "tools/call", { name: "bundle_summary", arguments: {} });
        const summaryResponse = (await waitFor(2)) as { result: { content: Array<{ text: string }> } };
        const summary = JSON.parse(summaryResponse.result.content[0]?.text ?? "{}") as {
          sourceName: string;
          seedUrl: string;
          freshnessStatus: string;
          lastSuccessfulRefreshAt?: string;
      };
      expect(summary).toMatchObject({ sourceName: "stripe", seedUrl: `${docs.origin}/`, freshnessStatus: "fresh" });
      expect(summary.lastSuccessfulRefreshAt).toBeTruthy();
      await expect(stateHash(okfyHome, "stripe")).resolves.toBe(hashAfterAdd);

        for (const line of stdoutLines) {
          const parsed = JSON.parse(line) as { jsonrpc?: string };
          expect(parsed.jsonrpc).toBe("2.0");
        }
      } finally {
        child.kill("SIGTERM");
      }
    } finally {
      await docs.close();
    }
  });

  it("serves multiple registered sources as one source-aware MCP workspace", async () => {
    const okfyHome = await tempHome();
    const docs = await startDocsServer();
    try {
      for (const name of ["stripe", "clerk"]) {
        await runCli(
          [
            "add",
            name,
            `${docs.origin}/`,
            "--max-pages",
            "3",
            "--max-depth",
            "1",
            "--allow-private-network",
            "--no-respect-robots",
            "--json"
          ],
          okfyHome
        );
      }

      await withMcpSession(["serve", "stripe", "clerk", "--mcp", "--auto-refresh"], okfyHome, async ({ stdoutLines, stderr, send, waitFor }) => {
        send(2, "tools/list");
        const toolsResponse = (await waitFor(2)) as { result?: { tools?: Array<{ name: string }> } };
        expect(toolsResponse.result?.tools?.map((tool) => tool.name)).toContain("bundle_summary");

        send(3, "tools/call", { name: "bundle_summary", arguments: {} });
        const summaryResponse = (await waitFor(3)) as { result: { content: Array<{ text: string }> } };
        const summary = JSON.parse(summaryResponse.result.content[0]?.text ?? "{}") as {
          workspace: boolean;
          sourceCount: number;
          sources: Array<{ sourceName: string; freshnessStatus: string }>;
        };
        expect(summary).toMatchObject({ workspace: true, sourceCount: 2 });
        expect(summary.sources.map((source) => source.sourceName)).toEqual(["stripe", "clerk"]);

        send(4, "tools/call", { name: "search_concepts", arguments: { query: "sessions", source: "stripe", limit: 5 } });
        const searchResponse = (await waitFor(4)) as { result: { content: Array<{ text: string }> } };
        const search = JSON.parse(searchResponse.result.content[0]?.text ?? "[]") as Array<{ id: string; sourceName: string; seedUrl: string }>;
        expect(search.length).toBeGreaterThan(0);
        expect(search.every((result) => result.sourceName === "stripe")).toBe(true);
        const firstSearchResult = search[0];
        if (!firstSearchResult) throw new Error("Expected at least one workspace search result.");

        send(5, "tools/call", { name: "read_concept", arguments: { source: "stripe", id: firstSearchResult.id, max_chars: 600 } });
        const readResponse = (await waitFor(5)) as { result: { content: Array<{ text: string }> } };
        const read = JSON.parse(readResponse.result.content[0]?.text ?? "{}") as {
          sourceName: string;
          ref: string;
          source_resource: string;
          markdown_body: string;
        };
        expect(read.sourceName).toBe("stripe");
        expect(read.ref).toBe(`stripe:${firstSearchResult.id}`);
        expect(read.source_resource).toContain(docs.origin);
        expect(read.markdown_body.toLowerCase()).toContain("sessions");

        for (const line of stdoutLines) {
          const parsed = JSON.parse(line) as { jsonrpc?: string };
          expect(parsed.jsonrpc).toBe("2.0");
        }
        expect(stderr()).toContain("okfy serve: loading workspace sources stripe, clerk");
      });
    } finally {
      await docs.close();
    }
  });

  it("serves multiple local OKF bundle paths as one source-aware MCP workspace", async () => {
    const okfyHome = await tempHome();
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-local-workspace-"));
    tempDirs.push(scratch);
    const apiDocs = path.join(scratch, "api-docs");
    const productDocs = path.join(scratch, "product-docs");
    const apiBundle = path.join(scratch, "api-okf");
    const productBundle = path.join(scratch, "product-okf");
    await fs.mkdir(apiDocs, { recursive: true });
    await fs.mkdir(productDocs, { recursive: true });
    await fs.writeFile(
      path.join(apiDocs, "webhooks.md"),
      "# Webhook API Reference\n\nUse webhook signatures to verify callback payloads from the API.\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(productDocs, "roadmap.md"),
      "# Product Handbook\n\nPlan launch milestones and roadmap decisions for product teams.\n",
      "utf8"
    );

    await runCli(["import", apiDocs, "--out", apiBundle, "--stable-timestamps"], okfyHome);
    await runCli(["import", productDocs, "--out", productBundle, "--stable-timestamps"], okfyHome);

    await withMcpSession(["serve", apiBundle, productBundle, "--mcp"], okfyHome, async ({ stdoutLines, send, waitFor }) => {
      send(2, "tools/call", { name: "bundle_summary", arguments: {} });
      const summaryResponse = (await waitFor(2)) as { result: { content: Array<{ text: string }> } };
      const summary = JSON.parse(summaryResponse.result.content[0]?.text ?? "{}") as {
        workspace: boolean;
        sourceCount: number;
        sources: Array<{ sourceName: string; sourceKind: string }>;
      };
      expect(summary).toMatchObject({ workspace: true, sourceCount: 2 });
      expect(summary.sources.map((source) => source.sourceName)).toEqual(["api-okf", "product-okf"]);
      expect(summary.sources.map((source) => source.sourceKind)).toEqual(["local", "local"]);

      send(3, "tools/call", { name: "search_concepts", arguments: { query: "webhook signatures", source: "api-okf", limit: 5 } });
      const searchResponse = (await waitFor(3)) as { result: { content: Array<{ text: string }> } };
      const search = JSON.parse(searchResponse.result.content[0]?.text ?? "[]") as Array<{
        sourceName: string;
        ref: string;
        snippet: string;
      }>;
      expect(search.length).toBeGreaterThan(0);
      expect(search.every((result) => result.sourceName === "api-okf")).toBe(true);
      expect(search.every((result) => result.ref.startsWith("api-okf:"))).toBe(true);
      expect(search.some((result) => result.snippet.toLowerCase().includes("webhook"))).toBe(true);

      for (const line of stdoutLines) {
        const parsed = JSON.parse(line) as { jsonrpc?: string };
        expect(parsed.jsonrpc).toBe("2.0");
      }
    });
  });

  it("keeps bare registered source names ahead of matching cwd paths", async () => {
    const okfyHome = await tempHome();
    const docs = await startDocsServer();
    try {
      await runCli(
        [
          "add",
          "docs",
          `${docs.origin}/`,
          "--max-pages",
          "3",
          "--max-depth",
          "1",
          "--allow-private-network",
          "--no-respect-robots",
          "--json"
        ],
        okfyHome
      );

      await withMcpSession(["serve", "docs", "--mcp", "--auto-refresh"], okfyHome, async ({ send, waitFor }) => {
        send(2, "tools/call", { name: "bundle_summary", arguments: {} });
        const summaryResponse = (await waitFor(2)) as { result: { content: Array<{ text: string }> } };
        const summary = JSON.parse(summaryResponse.result.content[0]?.text ?? "{}") as {
          sourceName: string;
          sourceKind: string;
          seedUrl: string;
        };
        expect(summary).toMatchObject({
          sourceName: "docs",
          sourceKind: "website",
          seedUrl: docs.origin + "/"
        });
      });
    } finally {
      await docs.close();
    }
  });

  it("rejects duplicate local bundle source names before workspace startup", async () => {
    const okfyHome = await tempHome();
    const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-local-duplicate-workspace-"));
    tempDirs.push(scratch);
    const firstDocs = path.join(scratch, "first-docs");
    const secondDocs = path.join(scratch, "second-docs");
    const firstBundle = path.join(scratch, "first", "api-okf");
    const secondBundle = path.join(scratch, "second", "api-okf");
    await fs.mkdir(firstDocs, { recursive: true });
    await fs.mkdir(secondDocs, { recursive: true });
    await fs.writeFile(path.join(firstDocs, "index.md"), "# First API\n\nFirst API reference.\n", "utf8");
    await fs.writeFile(path.join(secondDocs, "index.md"), "# Second API\n\nSecond API reference.\n", "utf8");

    await runCli(["import", firstDocs, "--out", firstBundle, "--stable-timestamps"], okfyHome);
    await runCli(["import", secondDocs, "--out", secondBundle, "--stable-timestamps"], okfyHome);

    const cli = path.resolve("dist/cli.js");
    await expect(
      execFileAsync(process.execPath, [cli, "serve", firstBundle, secondBundle, "--mcp"], {
        env: { ...process.env, OKFY_HOME: okfyHome },
        timeout: 3000
      })
    ).rejects.toMatchObject({
      stderr: expect.stringContaining('Duplicate workspace source "api-okf"')
    });
  });

  it("serves workspace source names that also exist as cwd paths", async () => {
    const okfyHome = await tempHome();
    const docs = await startDocsServer();
    try {
      for (const name of ["docs", "stripe"]) {
        await runCli(
          [
            "add",
            name,
            `${docs.origin}/`,
            "--max-pages",
            "3",
            "--max-depth",
            "1",
            "--allow-private-network",
            "--no-respect-robots",
            "--json"
          ],
          okfyHome
        );
      }

      await withMcpSession(["serve", "docs", "stripe", "--mcp"], okfyHome, async ({ send, waitFor }) => {
        send(2, "tools/call", { name: "bundle_summary", arguments: {} });
        const summaryResponse = (await waitFor(2)) as { result: { content: Array<{ text: string }> } };
        const summary = JSON.parse(summaryResponse.result.content[0]?.text ?? "{}") as { sources: Array<{ sourceName: string }> };
        expect(summary.sources.map((source) => source.sourceName)).toEqual(["docs", "stripe"]);
      });
    } finally {
      await docs.close();
    }
  });

  it("serves --all sources in deterministic order and rejects mixed workspace selections", async () => {
    const okfyHome = await tempHome();
    const docs = await startDocsServer();
    try {
      for (const name of ["stripe", "clerk"]) {
        await runCli(
          [
            "add",
            name,
            `${docs.origin}/`,
            "--max-pages",
            "3",
            "--max-depth",
            "1",
            "--allow-private-network",
            "--no-respect-robots",
            "--json"
          ],
          okfyHome
        );
      }

      await withMcpSession(["serve", "--all", "--mcp"], okfyHome, async ({ send, waitFor }) => {
        send(2, "tools/call", { name: "bundle_summary", arguments: {} });
        const summaryResponse = (await waitFor(2)) as { result: { content: Array<{ text: string }> } };
        const summary = JSON.parse(summaryResponse.result.content[0]?.text ?? "{}") as {
          sources: Array<{ sourceName: string }>;
        };
        expect(summary.sources.map((source) => source.sourceName)).toEqual(["clerk", "stripe"]);
      });

      await expect(runCli(["serve", "--all", "stripe", "--mcp"], okfyHome)).rejects.toMatchObject({
        stderr: expect.stringContaining("Use either --all or explicit source names")
      });
    } finally {
      await docs.close();
    }
  });

  it("only refreshes stale registered sources from MCP when --auto-refresh is set", async () => {
    const okfyHome = await tempHome();
    const docs = await startDocsServer();
    try {
      await runCli(
        [
          "add",
          "stripe",
          `${docs.origin}/`,
          "--max-pages",
          "3",
          "--max-depth",
          "1",
          "--allow-private-network",
          "--no-respect-robots",
          "--json"
        ],
        okfyHome
      );
      const bundleFile = path.join(okfyHome, "sources", "stripe", "bundle", "sessions.md");
      await expect(fs.readFile(bundleFile, "utf8")).resolves.toContain("v1");
      await markSourceOld(okfyHome, "stripe");
      docs.setVersion("v2");

      const runServeSearch = async (args: string[]) => {
        const cli = path.resolve("dist/cli.js");
        const child = spawn(process.execPath, [cli, ...args], {
          env: { ...process.env, OKFY_HOME: okfyHome },
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
            clientInfo: { name: "okfy-auto-refresh-gate-vitest", version: "0.1.0" }
          });
          await waitFor(1);
          child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
          send(2, "tools/call", { name: "search_concepts", arguments: { query: "sessions", limit: 5 } });
          await waitFor(2);
        } finally {
          child.kill("SIGTERM");
        }
      };

      await runServeSearch(["serve", "stripe", "--mcp", "--refresh-mode", "blocking"]);
      expect(await waitForFileContains(bundleFile, "v2", 750)).toBe(false);

      await runServeSearch(["serve", "stripe", "--mcp", "--auto-refresh", "--refresh-mode", "blocking"]);
      expect(await waitForFileContains(bundleFile, "v2", 3000)).toBe(true);
    } finally {
      await docs.close();
    }
  });

  it("rejects unsafe explicit source bundle output paths before replacing them", async () => {
    const okfyHome = await tempHome();
    const docs = await startDocsServer();
    try {
      await expect(
        runCli(
          [
            "add",
            "stripe",
            `${docs.origin}/`,
            "--max-pages",
            "1",
            "--allow-private-network",
            "--no-respect-robots",
            "--out",
            ".",
            "--json"
          ],
          okfyHome
        )
      ).rejects.toMatchObject({
        stdout: expect.stringContaining("Unsafe output directory")
      });
    } finally {
      await docs.close();
    }
  });
});
