import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  readRefreshState,
  writeRefreshState,
  writeSourceManifest,
  type RefreshState,
  type SourceManifest
} from "../src/source-store.js";
import { withBuiltCliMcpSession } from "./support/mcp-session.js";

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
      response.end(
        `<main><h1>Sessions ${version}</h1><p>Create Checkout Sessions ${version}.</p></main>`
      );
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

async function runCli(
  args: string[],
  okfyHome: string
): Promise<{ stdout: string; stderr: string }> {
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

function sourceManifest(name: string): SourceManifest {
  return {
    schemaVersion: 1,
    okfyVersion: "0.3.0",
    name,
    kind: "website",
    createdAt: "2026-06-23T00:00:00.000Z",
    updatedAt: "2026-06-23T00:00:00.000Z",
    source: {
      seedUrl: `https://docs.example.com/${name}`
    },
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
    bundle: {
      dir: "bundle"
    }
  };
}

function sourceState(partial: Partial<RefreshState> = {}): RefreshState {
  return {
    schemaVersion: 1,
    status: "fresh",
    lastCheckedAt: "2026-06-23T00:00:00.000Z",
    lastRefreshStartedAt: "2026-06-23T00:00:00.000Z",
    lastRefreshCompletedAt: "2026-06-23T00:01:00.000Z",
    lastSuccessfulRefreshAt: "2026-06-23T00:01:00.000Z",
    nextRefreshAllowedAt: "2026-06-23T00:16:00.000Z",
    refreshInProgress: false,
    lastError: null,
    bundle: {
      conceptCount: 2,
      warningCount: 0,
      valid: true,
      contentHash: "sha256:test"
    },
    ...partial
  };
}

async function registerFixtureSource(
  okfyHome: string,
  name: string,
  options: { fixtureName?: string; state?: RefreshState } = {}
): Promise<void> {
  await writeSourceManifest(sourceManifest(name), { okfyHome });
  await writeRefreshState(name, options.state ?? sourceState(), { okfyHome });
  await fs.cp(
    path.resolve("test-fixtures", options.fixtureName ?? "okf-valid"),
    path.join(okfyHome, "sources", name, "bundle"),
    { recursive: true }
  );
}

async function markSourceOld(okfyHome: string, name: string): Promise<void> {
  const statePath = path.join(okfyHome, "sources", name, "state.json");
  const parsed = JSON.parse(await fs.readFile(statePath, "utf8")) as Record<string, unknown>;
  parsed.status = "fresh";
  parsed.lastSuccessfulRefreshAt = "2026-01-01T00:00:00.000Z";
  parsed.nextRefreshAllowedAt = "2026-01-01T00:00:00.000Z";
  await fs.writeFile(statePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

async function writeMalformedRefreshState(okfyHome: string, name: string): Promise<void> {
  const statePath = path.join(okfyHome, "sources", name, "state.json");
  const parsed = JSON.parse(await fs.readFile(statePath, "utf8")) as Record<string, unknown>;
  parsed.status = "ready";
  await fs.writeFile(statePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

async function waitForFileContains(
  filePath: string,
  expected: string,
  timeoutMs: number
): Promise<boolean> {
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

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("registered source CLI flow", () => {
  it("imports local docs into a nested output directory when parents do not exist", async () => {
    const okfyHome = await tempHome();
    const outDir = path.join(okfyHome, "missing-parent", "docs-okf");

    await runCli(
      ["import", "examples/local-markdown", "--out", outDir, "--force", "--stable-timestamps"],
      okfyHome
    );

    await expect(fs.access(path.join(outDir, "index.md"))).resolves.toBeUndefined();
    const validation = await runCli(["validate", outDir], okfyHome);
    expect(validation.stdout).toContain("OKF bundle valid");
    expect(validation.stdout).toContain("Concepts: 6");
  });

  it("writes a local bundle Inspector HTML file", async () => {
    const okfyHome = await tempHome();
    const outFile = path.join(okfyHome, "inspector.html");

    const result = await runCli(["map", "test-fixtures/okf-valid", "--out", outFile], okfyHome);

    expect(result.stdout).toContain(outFile);
    const html = await fs.readFile(outFile, "utf8");
    expect(html).toContain("OKFY Inspector");
    expect(html).toContain("Readiness Summary");
    expect(html).toContain("Knowledge Map");
    expect(html).toContain("Agent Preview");
    expect(html).toContain("Quickstart");
  });

  it("writes an activation packet for a local bundle", async () => {
    const okfyHome = await tempHome();
    const bundleDir = path.join(okfyHome, "okfy review spaced", "okf valid");
    const outDir = path.join(okfyHome, "activation");
    await fs.mkdir(path.dirname(bundleDir), { recursive: true });
    await fs.cp(path.resolve("test-fixtures", "okf-valid"), bundleDir, { recursive: true });

    const result = await runCli(
      ["activate", bundleDir, "--client", "codex", "--out", outDir],
      okfyHome
    );

    expect(result.stdout).toContain("okfy activate");
    expect(result.stdout).toContain(outDir);
    const [html, setup, proofText] = await Promise.all([
      fs.readFile(path.join(outDir, "okfy-inspector.html"), "utf8"),
      fs.readFile(path.join(outDir, "okfy-setup.md"), "utf8"),
      fs.readFile(path.join(outDir, "okfy-proof.json"), "utf8")
    ]);
    const proof = parseJson<{
      search: { input: { query: string }; results: Array<{ ref: string }> };
      read: { result: { citation: { sourceResource: string } } };
    }>(proofText);
    expect(html).toContain("Agent Setup");
    expect(html).toContain("Codex config.toml");
    expect(setup).toContain(`npx -y okfy-ai serve '${bundleDir}' --mcp`);
    expect(setup).toContain(`"serve", "${bundleDir}", "--mcp"`);
    expect(setup).toContain("First Prompt");
    expect(proof.search.input.query).toBe("Quickstart");
    expect(proof.search.results[0]?.ref).toBe("guides/quickstart");
    expect(proof.read.result.citation.sourceResource).toBe(
      "https://docs.example.com/guides/quickstart"
    );
  });

  it("refuses to overwrite activation packets unless forced", async () => {
    const okfyHome = await tempHome();
    const outDir = path.join(okfyHome, "activation");
    await fs.mkdir(outDir);
    await fs.writeFile(path.join(outDir, "keep.txt"), "do not replace", "utf8");

    await expect(
      runCli(["activate", "test-fixtures/okf-valid", "--out", outDir], okfyHome)
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Activation output directory is not empty")
    });
    await expect(fs.readFile(path.join(outDir, "keep.txt"), "utf8")).resolves.toBe(
      "do not replace"
    );

    await runCli(["activate", "test-fixtures/okf-valid", "--out", outDir, "--force"], okfyHome);
    await expect(fs.access(path.join(outDir, "okfy-proof.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(outDir, "keep.txt"))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("rejects force activation output paths that would delete selected local bundles", async () => {
    const okfyHome = await tempHome();
    const bundleDir = path.join(okfyHome, "selected okf");
    await fs.cp(path.resolve("test-fixtures", "okf-valid"), bundleDir, { recursive: true });

    await expect(
      runCli(
        ["activate", bundleDir, "--out", path.join(bundleDir, "activation"), "--force"],
        okfyHome
      )
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("inside a selected source path")
    });
    await expect(
      fs.access(path.join(bundleDir, "activation", "okfy-setup.md"))
    ).rejects.toMatchObject({
      code: "ENOENT"
    });

    await expect(
      runCli(["activate", bundleDir, "--out", bundleDir, "--force"], okfyHome)
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("target a selected source path")
    });
    await expect(
      fs.access(path.join(bundleDir, "guides", "quickstart.md"))
    ).resolves.toBeUndefined();

    await expect(
      runCli(["activate", bundleDir, "--out", okfyHome, "--force"], okfyHome)
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("contain a selected source path")
    });
    await expect(
      fs.access(path.join(bundleDir, "guides", "quickstart.md"))
    ).resolves.toBeUndefined();
    await expect(fs.access(path.join(okfyHome, "okfy-proof.json"))).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect((await runCli(["validate", bundleDir], okfyHome)).stdout).toContain("OKF bundle valid");
  });

  it("rejects activation output paths that target registered source directories or bundles", async () => {
    const okfyHome = await tempHome();
    await registerFixtureSource(okfyHome, "stripe");
    const sourceDir = path.join(okfyHome, "sources", "stripe");
    const bundleDir = path.join(sourceDir, "bundle");

    await expect(
      runCli(["activate", "stripe", "--out", sourceDir, "--force", "--json"], okfyHome)
    ).rejects.toMatchObject({
      stdout: expect.stringContaining("target a selected source path")
    });
    await expect(fs.access(path.join(sourceDir, "source.json"))).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(bundleDir, "guides", "quickstart.md"))
    ).resolves.toBeUndefined();

    await expect(
      runCli(["activate", "stripe", "--out", bundleDir, "--force"], okfyHome)
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("target a selected source path")
    });
    await expect(
      runCli(
        ["activate", "stripe", "--out", path.join(bundleDir, "activation"), "--force"],
        okfyHome
      )
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("inside a selected source path")
    });
    await expect(
      fs.access(path.join(bundleDir, "activation", "okfy-setup.md"))
    ).rejects.toMatchObject({
      code: "ENOENT"
    });
    expect((await runCli(["validate", bundleDir], okfyHome)).stdout).toContain("OKF bundle valid");
  });

  it("writes task-scoped registered-source activation proof", async () => {
    const okfyHome = await tempHome();
    await registerFixtureSource(okfyHome, "stripe");
    const outDir = path.join(okfyHome, "activation");

    const result = await runCli(
      [
        "activate",
        "stripe",
        "--client",
        "codex",
        "--task",
        "search_concepts",
        "--out",
        outDir,
        "--json"
      ],
      okfyHome
    );

    const manifest = parseJson<{
      proof: { query: string; searchResultCount: number; readRef: string | null };
    }>(result.stdout);
    expect(manifest.proof).toMatchObject({
      query: "search_concepts",
      searchResultCount: 1,
      readRef: "stripe:reference/api"
    });
    const proof = parseJson<{
      search: {
        input: { query: string; source?: string };
        results: Array<{ sourceName?: string; ref: string }>;
      };
      read: { input: { source?: string; id: string }; result: { ref: string } };
      neighbors: { input: { source?: string; id: string } };
    }>(await fs.readFile(path.join(outDir, "okfy-proof.json"), "utf8"));
    expect(proof.search.input).toMatchObject({
      query: "search_concepts",
      source: "stripe"
    });
    expect(proof.search.results[0]).toMatchObject({
      sourceName: "stripe",
      ref: "stripe:reference/api"
    });
    expect(proof.read.input).toMatchObject({ source: "stripe", id: "reference/api" });
    expect(proof.read.result.ref).toBe("stripe:reference/api");
    expect(proof.neighbors.input).toMatchObject({ source: "stripe", id: "reference/api" });
  });

  it("writes diagnostic activation artifacts for unavailable registered bundles", async () => {
    const okfyHome = await tempHome();
    await registerFixtureSource(okfyHome, "stripe");
    const bundleDir = path.join(okfyHome, "sources", "stripe", "bundle");
    const outDir = path.join(okfyHome, "activation");
    await fs.rm(bundleDir, { recursive: true, force: true });

    const result = await runCli(
      ["activate", "stripe", "--client", "codex", "--out", outDir, "--json"],
      okfyHome
    );

    const manifest = parseJson<{
      status: string;
      proof: { searchResultCount: number; readRef: string | null; citation: string | null };
    }>(result.stdout);
    expect(manifest.status).toBe("ready");
    expect(manifest.proof).toMatchObject({
      searchResultCount: 0,
      readRef: null,
      citation: null
    });
    await expect(fs.access(path.join(outDir, "okfy-inspector.html"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(outDir, "okfy-setup.md"))).resolves.toBeUndefined();
    const proof = parseJson<{
      search: { results: unknown[] };
      read: unknown | null;
      neighbors: unknown | null;
    }>(await fs.readFile(path.join(outDir, "okfy-proof.json"), "utf8"));
    expect(proof.search.results).toEqual([]);
    expect(proof.read).toBeNull();
    expect(proof.neighbors).toBeNull();
  });

  it("prints local bundle Inspector JSON without writing HTML", async () => {
    const okfyHome = await tempHome();
    const outFile = path.join(okfyHome, "should-not-exist.html");

    const result = await runCli(
      ["map", "test-fixtures/okf-valid", "--json", "--out", outFile],
      okfyHome
    );

    const report = parseJson<{
      schemaVersion: number;
      readiness: { conceptCount: number; validationStatus: string };
      concepts: Array<{ ref: string }>;
    }>(result.stdout);
    expect(report).toMatchObject({
      schemaVersion: 1,
      readiness: { conceptCount: 2, validationStatus: "valid" }
    });
    expect(report.concepts.map((concept) => concept.ref)).toEqual([
      "guides/quickstart",
      "reference/api"
    ]);
    await expect(fs.access(outFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("maps multiple registered sources into source-aware Inspector HTML", async () => {
    const okfyHome = await tempHome();
    await registerFixtureSource(okfyHome, "stripe");
    await registerFixtureSource(okfyHome, "clerk");
    const outFile = path.join(okfyHome, "workspace.html");

    await runCli(["map", "stripe", "clerk", "--out", outFile], okfyHome);

    const html = await fs.readFile(outFile, "utf8");
    expect(html).toContain("stripe:guides/quickstart");
    expect(html).toContain("clerk:guides/quickstart");
    expect(html).toContain("bundle_summary");
    expect(html).toContain("get_neighbors");
  });

  it("prints all registered sources as Inspector JSON in deterministic order", async () => {
    const okfyHome = await tempHome();
    await registerFixtureSource(okfyHome, "stripe");
    await registerFixtureSource(okfyHome, "clerk", {
      state: sourceState({
        status: "stale",
        lastSuccessfulRefreshAt: "2026-06-22T00:01:00.000Z",
        nextRefreshAllowedAt: "2026-06-23T00:16:00.000Z"
      })
    });

    const report = parseJson<{
      target: { kind: string; sourceNames: string[] };
      readiness: { sourceCount: number; conceptCount: number };
      sources: Array<{ sourceName: string; freshnessStatus: string }>;
    }>((await runCli(["map", "--all", "--json"], okfyHome)).stdout);

    expect(report.target).toMatchObject({ kind: "workspace", sourceNames: ["clerk", "stripe"] });
    expect(report.readiness).toMatchObject({ sourceCount: 2, conceptCount: 4 });
    expect(report.sources.map((source) => [source.sourceName, source.freshnessStatus])).toEqual([
      ["clerk", "stale"],
      ["stripe", "fresh"]
    ]);
  });

  it("fails invalid map targets without creating partial output", async () => {
    const okfyHome = await tempHome();
    const outFile = path.join(okfyHome, "partial.html");

    await expect(
      runCli(["map", "./missing-bundle", "--out", outFile], okfyHome)
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Bundle path does not exist")
    });
    await expect(fs.access(outFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects empty map bundle directories without creating partial output", async () => {
    const okfyHome = await tempHome();
    const emptyBundle = path.join(okfyHome, "not-a-bundle");
    const outFile = path.join(okfyHome, "empty.html");
    await fs.mkdir(emptyBundle);

    await expect(runCli(["map", emptyBundle, "--out", outFile], okfyHome)).rejects.toMatchObject({
      stderr: expect.stringContaining("does not contain any OKF concept files")
    });
    await expect(fs.access(outFile)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects empty serve bundle directories before starting MCP", async () => {
    const okfyHome = await tempHome();
    const emptyBundle = path.join(okfyHome, "not-a-bundle");
    await fs.mkdir(emptyBundle);

    await expect(runCli(["serve", emptyBundle, "--mcp"], okfyHome)).rejects.toMatchObject({
      stderr: expect.stringContaining("does not contain any OKF concept files")
    });
  });

  it("shows corrupt source directories in sources output", async () => {
    const okfyHome = await tempHome();
    await fs.mkdir(path.join(okfyHome, "sources", "broken"), { recursive: true });

    const rows = parseJson<
      Array<{
        name: string;
        status: string;
        valid: boolean;
        lastError: { message: string; code?: string } | null;
      }>
    >((await runCli(["sources", "--json"], okfyHome)).stdout);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "broken",
      status: "failed",
      valid: false,
      lastError: { code: "ENOENT" }
    });
    expect(rows[0]?.lastError?.message).toMatch(/source\.json|ENOENT/);
  });

  it("shows malformed source manifests in sources output", async () => {
    const okfyHome = await tempHome();
    const sourceDir = path.join(okfyHome, "sources", "broken");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "source.json"),
      '{"schemaVersion":1,"name":"broken"}\n',
      "utf8"
    );

    const rows = parseJson<
      Array<{
        name: string;
        status: string;
        valid: boolean;
        seedUrl: string;
        lastError: { message: string } | null;
      }>
    >((await runCli(["sources", "--json"], okfyHome)).stdout);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      name: "broken",
      status: "failed",
      valid: false,
      seedUrl: "",
      lastError: { message: expect.stringMatching(/source manifest|kind|okfyVersion/i) }
    });
  });

  it("checks explicit registered sources with malformed state as load errors", async () => {
    const okfyHome = await tempHome();
    await registerFixtureSource(okfyHome, "stripe");
    await writeMalformedRefreshState(okfyHome, "stripe");

    let failure: any;
    try {
      await runCli(["check", "stripe", "--json"], okfyHome);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeTruthy();
    const payload = parseJson<{
      name: string;
      status: string;
      valid: boolean;
      lastError: { message: string };
      bundlePath: string;
    }>(failure.stdout);
    expect(payload).toMatchObject({
      name: "stripe",
      status: "failed",
      valid: false,
      bundlePath: path.join(okfyHome, "sources", "stripe", "bundle"),
      lastError: {
        message: expect.stringMatching(/Invalid refresh state.*status/i)
      }
    });
  });

  it("serves explicit registered sources with malformed state when the bundle is valid", async () => {
    const okfyHome = await tempHome();
    await registerFixtureSource(okfyHome, "stripe");
    await writeMalformedRefreshState(okfyHome, "stripe");

    await withBuiltCliMcpSession(
      ["serve", "stripe", "--mcp"],
      { env: { ...process.env, OKFY_HOME: okfyHome } },
      async ({ send, waitFor }) => {
        send(2, "tools/call", { name: "bundle_summary", arguments: {} });
        const summaryResponse = (await waitFor(2)) as {
          result: { content: Array<{ text: string }> };
        };
        const summary = JSON.parse(summaryResponse.result.content[0]?.text ?? "{}") as {
          validationStatus: string;
          conceptCount: number;
          freshnessStatus: string;
          lastRefreshError: { message: string } | null;
        };
        expect(summary).toMatchObject({
          validationStatus: "valid",
          conceptCount: 2,
          freshnessStatus: "failed",
          lastRefreshError: {
            message: expect.stringMatching(/Invalid refresh state.*status/i)
          }
        });

        send(3, "tools/call", {
          name: "search_concepts",
          arguments: { query: "Quickstart", limit: 5 }
        });
        const searchResponse = (await waitFor(3)) as {
          result: { content: Array<{ text: string }> };
        };
        const results = JSON.parse(searchResponse.result.content[0]?.text ?? "[]") as Array<{
          title: string;
        }>;
        expect(results[0]?.title).toBe("Quickstart");
      }
    );
  });

  it("summarizes invalid source directory names in --all MCP workspaces", async () => {
    const okfyHome = await tempHome();
    await fs.mkdir(path.join(okfyHome, "sources", "Bad Name"), { recursive: true });

    await withBuiltCliMcpSession(
      ["serve", "--all", "--mcp"],
      { env: { ...process.env, OKFY_HOME: okfyHome } },
      async ({ stdoutLines, send, waitFor }) => {
        send(2, "tools/call", { name: "bundle_summary", arguments: {} });
        const summaryResponse = (await waitFor(2)) as {
          result: { content: Array<{ text: string }> };
        };
        const summary = JSON.parse(summaryResponse.result.content[0]?.text ?? "{}") as {
          workspace: boolean;
          sourceCount: number;
          usableSourceCount: number;
          validationStatus: string;
          sources: Array<{
            sourceName: string;
            seedUrl: string;
            validationStatus: string;
            lastRefreshError: { message: string; sourceDirName?: string } | null;
          }>;
        };

        expect(summary).toMatchObject({
          workspace: true,
          sourceCount: 1,
          usableSourceCount: 0,
          validationStatus: "invalid"
        });
        expect(summary.sources[0]?.sourceName).toMatch(/^invalid-[a-z0-9]+-bad-name$/);
        expect(summary.sources[0]).toMatchObject({
          seedUrl: "",
          validationStatus: "unavailable",
          lastRefreshError: {
            sourceDirName: "Bad Name",
            message: expect.stringContaining('Invalid source name "Bad Name"')
          }
        });

        for (const line of stdoutLines) {
          const parsed = JSON.parse(line) as { jsonrpc?: string };
          expect(parsed.jsonrpc).toBe("2.0");
        }
      }
    );
  });

  it("does not advertise removed remove flags", async () => {
    const cli = path.resolve("dist/cli.js");
    await fs.access(cli);

    const { stdout } = await execFileAsync(process.execPath, [cli, "remove", "--help"]);

    expect(stdout).not.toContain("--keep-bundle");
  });

  it("rejects invalid numeric CLI options before crawling or writing source state", async () => {
    const okfyHome = await tempHome();
    const outDir = path.join(okfyHome, "out");

    await expect(
      runCli(
        [
          "crawl",
          "http://127.0.0.1:9/",
          "--out",
          outDir,
          "--dry-run",
          "--allow-private-network",
          "--no-respect-robots",
          "--max-pages",
          "nope"
        ],
        okfyHome
      )
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Expected max-pages")
    });

    await expect(
      runCli(
        [
          "add",
          "stripe",
          "http://127.0.0.1:9/",
          "--allow-private-network",
          "--no-respect-robots",
          "--concurrency",
          "0",
          "--json"
        ],
        okfyHome
      )
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("Expected concurrency")
    });
    await expect(fs.readdir(path.join(okfyHome, "sources"))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

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
      const addJson = parseJson<{
        name: string;
        status: string;
        bundlePath: string;
        conceptCount: number;
      }>(add.stdout);
      expect(addJson).toMatchObject({ name: "stripe", status: "fresh", conceptCount: 2 });
      expect(addJson.bundlePath).toContain(path.join(okfyHome, "sources", "stripe", "bundle"));
      const hashAfterAdd = await stateHash(okfyHome, "stripe");
      expect(hashAfterAdd).toMatch(/^sha256:/);

      const sources = parseJson<Array<{ name: string; status: string; seedUrl: string }>>(
        (await runCli(["sources", "--json"], okfyHome)).stdout
      );
      expect(sources).toMatchObject([
        { name: "stripe", status: "fresh", seedUrl: `${docs.origin}/` }
      ]);
      await expect(stateHash(okfyHome, "stripe")).resolves.toBe(hashAfterAdd);

      const fresh = parseJson<{ status: string; valid: boolean }>(
        (await runCli(["check", "stripe", "--json"], okfyHome)).stdout
      );
      expect(fresh).toMatchObject({ status: "fresh", valid: true });
      await expect(stateHash(okfyHome, "stripe")).resolves.toBe(hashAfterAdd);

      await markSourceOld(okfyHome, "stripe");
      await expect(
        runCli(["check", "stripe", "--max-age", "1s", "--json"], okfyHome)
      ).rejects.toMatchObject({
        stdout: expect.stringContaining('"status": "stale"')
      });

      docs.setVersion("v2");
      const update = parseJson<{ status: string; newConceptCount: number }>(
        (await runCli(["update", "stripe", "--json"], okfyHome)).stdout
      );
      expect(update).toMatchObject({ status: "fresh", newConceptCount: 2 });
      await expect(
        fs.readFile(path.join(okfyHome, "sources", "stripe", "bundle", "sessions.md"), "utf8")
      ).resolves.toContain("v2");

      docs.setFailing(true);
      await expect(runCli(["update", "stripe", "--json"], okfyHome)).rejects.toMatchObject({
        stdout: expect.stringContaining('"status": "failed"')
      });
      await expect(
        fs.readFile(path.join(okfyHome, "sources", "stripe", "bundle", "sessions.md"), "utf8")
      ).resolves.toContain("v2");

      const failed = parseJson<{ status: string; lastError: { message: string } | null }>(
        (
          await runCli(["check", "stripe", "--json"], okfyHome).catch(
            (error: { stdout: string }) => ({ stdout: error.stdout })
          )
        ).stdout
      );
      expect(failed.status).toBe("failed");
      expect(failed.lastError?.message).toContain("Crawl generated zero concepts");

      const removed = parseJson<{ removed: boolean; name: string }>(
        (await runCli(["remove", "stripe", "--yes", "--json"], okfyHome)).stdout
      );
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
          "1h",
          "--json"
        ],
        okfyHome
      );
      const hashAfterAdd = await stateHash(okfyHome, "stripe");
      expect(hashAfterAdd).toMatch(/^sha256:/);

      await withBuiltCliMcpSession(
        ["serve", "stripe", "--mcp", "--auto-refresh"],
        { env: { ...process.env, OKFY_HOME: okfyHome } },
        async ({ stdoutLines, send, waitFor }) => {
          send(2, "tools/call", { name: "bundle_summary", arguments: {} });
          const summaryResponse = (await waitFor(2)) as {
            result: { content: Array<{ text: string }> };
          };
          const summary = JSON.parse(summaryResponse.result.content[0]?.text ?? "{}") as {
            sourceName: string;
            seedUrl: string;
            freshnessStatus: string;
            lastSuccessfulRefreshAt?: string;
          };
          expect(summary).toMatchObject({
            sourceName: "stripe",
            seedUrl: `${docs.origin}/`,
            freshnessStatus: "fresh"
          });
          expect(summary.lastSuccessfulRefreshAt).toBeTruthy();
          await expect(stateHash(okfyHome, "stripe")).resolves.toBe(hashAfterAdd);

          for (const line of stdoutLines) {
            const parsed = JSON.parse(line) as { jsonrpc?: string };
            expect(parsed.jsonrpc).toBe("2.0");
          }
        }
      );
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

      await withBuiltCliMcpSession(
        ["serve", "stripe", "clerk", "--mcp", "--auto-refresh"],
        { env: { ...process.env, OKFY_HOME: okfyHome } },
        async ({ stdoutLines, stderr, send, waitFor }) => {
          send(2, "tools/list");
          const toolsResponse = (await waitFor(2)) as {
            result?: { tools?: Array<{ name: string }> };
          };
          expect(toolsResponse.result?.tools?.map((tool) => tool.name)).toContain("bundle_summary");

          send(3, "tools/call", { name: "bundle_summary", arguments: {} });
          const summaryResponse = (await waitFor(3)) as {
            result: { content: Array<{ text: string }> };
          };
          const summary = JSON.parse(summaryResponse.result.content[0]?.text ?? "{}") as {
            workspace: boolean;
            sourceCount: number;
            sources: Array<{ sourceName: string; freshnessStatus: string }>;
          };
          expect(summary).toMatchObject({ workspace: true, sourceCount: 2 });
          expect(summary.sources.map((source) => source.sourceName)).toEqual(["stripe", "clerk"]);

          send(4, "tools/call", {
            name: "search_concepts",
            arguments: { query: "sessions", source: "stripe", limit: 5 }
          });
          const searchResponse = (await waitFor(4)) as {
            result: { content: Array<{ text: string }> };
          };
          const search = JSON.parse(searchResponse.result.content[0]?.text ?? "[]") as Array<{
            id: string;
            sourceName: string;
            seedUrl: string;
          }>;
          expect(search.length).toBeGreaterThan(0);
          expect(search.every((result) => result.sourceName === "stripe")).toBe(true);
          const firstSearchResult = search[0];
          if (!firstSearchResult) throw new Error("Expected at least one workspace search result.");

          send(5, "tools/call", {
            name: "read_concept",
            arguments: { source: "stripe", id: firstSearchResult.id, max_chars: 600 }
          });
          const readResponse = (await waitFor(5)) as {
            result: { content: Array<{ text: string }> };
          };
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
        }
      );
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

    await withBuiltCliMcpSession(
      ["serve", apiBundle, productBundle, "--mcp"],
      { env: { ...process.env, OKFY_HOME: okfyHome } },
      async ({ stdoutLines, send, waitFor }) => {
        send(2, "tools/call", { name: "bundle_summary", arguments: {} });
        const summaryResponse = (await waitFor(2)) as {
          result: { content: Array<{ text: string }> };
        };
        const summary = JSON.parse(summaryResponse.result.content[0]?.text ?? "{}") as {
          workspace: boolean;
          sourceCount: number;
          sources: Array<{ sourceName: string; sourceKind: string }>;
        };
        expect(summary).toMatchObject({ workspace: true, sourceCount: 2 });
        expect(summary.sources.map((source) => source.sourceName)).toEqual([
          "api-okf",
          "product-okf"
        ]);
        expect(summary.sources.map((source) => source.sourceKind)).toEqual(["local", "local"]);

        send(3, "tools/call", {
          name: "search_concepts",
          arguments: { query: "webhook signatures", source: "api-okf", limit: 5 }
        });
        const searchResponse = (await waitFor(3)) as {
          result: { content: Array<{ text: string }> };
        };
        const search = JSON.parse(searchResponse.result.content[0]?.text ?? "[]") as Array<{
          sourceName: string;
          ref: string;
          snippet: string;
        }>;
        expect(search.length).toBeGreaterThan(0);
        expect(search.every((result) => result.sourceName === "api-okf")).toBe(true);
        expect(search.every((result) => result.ref.startsWith("api-okf:"))).toBe(true);
        expect(search.some((result) => result.snippet.toLowerCase().includes("webhook"))).toBe(
          true
        );

        for (const line of stdoutLines) {
          const parsed = JSON.parse(line) as { jsonrpc?: string };
          expect(parsed.jsonrpc).toBe("2.0");
        }
      }
    );
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

      await withBuiltCliMcpSession(
        ["serve", "docs", "--mcp", "--auto-refresh"],
        { env: { ...process.env, OKFY_HOME: okfyHome } },
        async ({ send, waitFor }) => {
          send(2, "tools/call", { name: "bundle_summary", arguments: {} });
          const summaryResponse = (await waitFor(2)) as {
            result: { content: Array<{ text: string }> };
          };
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
        }
      );
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
    await fs.writeFile(
      path.join(firstDocs, "index.md"),
      "# First API\n\nFirst API reference.\n",
      "utf8"
    );
    await fs.writeFile(
      path.join(secondDocs, "index.md"),
      "# Second API\n\nSecond API reference.\n",
      "utf8"
    );

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

      await withBuiltCliMcpSession(
        ["serve", "docs", "stripe", "--mcp"],
        { env: { ...process.env, OKFY_HOME: okfyHome } },
        async ({ send, waitFor }) => {
          send(2, "tools/call", { name: "bundle_summary", arguments: {} });
          const summaryResponse = (await waitFor(2)) as {
            result: { content: Array<{ text: string }> };
          };
          const summary = JSON.parse(summaryResponse.result.content[0]?.text ?? "{}") as {
            sources: Array<{ sourceName: string }>;
          };
          expect(summary.sources.map((source) => source.sourceName)).toEqual(["docs", "stripe"]);
        }
      );
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

      await withBuiltCliMcpSession(
        ["serve", "--all", "--mcp"],
        { env: { ...process.env, OKFY_HOME: okfyHome } },
        async ({ send, waitFor }) => {
          send(2, "tools/call", { name: "bundle_summary", arguments: {} });
          const summaryResponse = (await waitFor(2)) as {
            result: { content: Array<{ text: string }> };
          };
          const summary = JSON.parse(summaryResponse.result.content[0]?.text ?? "{}") as {
            sources: Array<{ sourceName: string }>;
          };
          expect(summary.sources.map((source) => source.sourceName)).toEqual(["clerk", "stripe"]);
        }
      );

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
        await withBuiltCliMcpSession(
          args,
          { env: { ...process.env, OKFY_HOME: okfyHome } },
          async ({ send, waitFor }) => {
            send(2, "tools/call", {
              name: "search_concepts",
              arguments: { query: "sessions", limit: 5 }
            });
            await waitFor(2);
          }
        );
      };

      await runServeSearch(["serve", "stripe", "--mcp", "--refresh-mode", "blocking"]);
      expect(await waitForFileContains(bundleFile, "v2", 750)).toBe(false);

      await runServeSearch([
        "serve",
        "stripe",
        "--mcp",
        "--auto-refresh",
        "--refresh-mode",
        "blocking"
      ]);
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
