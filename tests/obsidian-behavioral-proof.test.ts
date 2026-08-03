import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runImportCommand } from "../src/cli-content-actions.js";
import { importLocal } from "../src/importer.js";
import { buildBundleInspectorReport } from "../src/inspector.js";
import { renderInspectorHtml } from "../src/inspector-html.js";
import { createMcpServer } from "../src/mcp.js";
import { BundleSearch } from "../src/search.js";
import { validateBundle } from "../src/validate.js";

const fixtureDir = path.resolve("tests/fixtures/obsidian-vault");
const stableTimestamp = "2026-06-14T00:00:00.000Z";
const sourceName = "Obsidian Behavioral Proof";
const intentionalTarget = "Intentional Missing <script>";
const tempDirs: string[] = [];

type McpTextResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

type McpHandler = (request: unknown, extra?: unknown) => Promise<McpTextResult>;

function mcpHandler(server: unknown, method: string): McpHandler {
  const handlers = (server as { _requestHandlers: Map<string, McpHandler> })._requestHandlers;
  const found = handlers.get(method);
  if (!found) throw new Error(`Missing MCP handler: ${method}`);
  return found;
}

async function tempRoot(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-obsidian-proof-"));
  tempDirs.push(dir);
  return dir;
}

async function readTree(root: string): Promise<Array<[string, string]>> {
  const result: Array<[string, string]> = [];

  async function walk(directory: string): Promise<void> {
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((first, second) =>
      first.name.localeCompare(second.name)
    );
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else {
        result.push([
          path.relative(root, absolute).split(path.sep).join("/"),
          await fs.readFile(absolute, "utf8")
        ]);
      }
    }
  }

  await walk(root);
  return result;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("committed Obsidian vault behavioral proof", () => {
  it("proves deterministic import semantics through validation, graph, CLI, Inspector, and MCP", async () => {
    const root = await tempRoot();
    const firstBundle = path.join(root, "first-bundle");
    const secondBundle = path.join(root, "second-bundle");
    const options = {
      inputPath: fixtureDir,
      sourceName,
      force: true,
      timestamp: stableTimestamp
    };

    const first = await importLocal({ ...options, outDir: firstBundle });
    const second = await importLocal({ ...options, outDir: secondBundle });

    expect(second.documents).toEqual(first.documents);
    expect(second.diagnostics).toEqual(first.diagnostics);
    expect(await readTree(secondBundle)).toEqual(await readTree(firstBundle));
    expect(first.diagnostics).toEqual([
      {
        severity: "warning",
        code: "unresolved_wikilink",
        message: `Unresolved Obsidian reference "${intentionalTarget}" in intentional-unresolved.md.`,
        sourcePath: "intentional-unresolved.md",
        rawTarget: intentionalTarget
      }
    ]);

    const validation = await validateBundle(firstBundle);
    expect(validation).toMatchObject({ valid: true, conceptCount: 11, warningCount: 1 });
    expect(validation.issues).toEqual([
      {
        severity: "warning",
        code: "unresolved_wikilink",
        message: `Unresolved Obsidian reference "${intentionalTarget}" in intentional-unresolved.md.`,
        path: "intentional-unresolved.md",
        rawTarget: intentionalTarget
      }
    ]);

    const search = await BundleSearch.fromBundle(firstBundle);
    expect(search.graph.outbound.get("semantic-note")).toEqual([
      "blocks",
      "guide",
      "guides/setup",
      "inline",
      "shared-context"
    ]);
    expect(search.graph.backlinks.get("blocks")).toEqual(["semantic-note"]);
    expect(search.graph.backlinks.get("guide")).toEqual(["semantic-note"]);
    expect(search.graph.backlinks.get("guides/setup")).toEqual(["semantic-note"]);
    expect(search.graph.backlinks.get("inline")).toEqual(["semantic-note"]);
    expect(search.graph.backlinks.get("shared-context")).toEqual(["semantic-note"]);
    expect(search.graph.outbound.get("literal-regions")).toEqual([
      "real",
      "real-embed",
      "real-note"
    ]);
    expect(search.graph.backlinks.get("real")).toEqual(["literal-regions"]);
    expect(search.graph.backlinks.get("real-embed")).toEqual(["literal-regions"]);
    expect(search.graph.backlinks.get("real-note")).toEqual(["literal-regions"]);
    expect(search.graph.outbound.get("literal-regions")).not.toContain("fenced");

    const semanticNote = search.getConcept("semantic-note");
    expect(semanticNote?.body).toContain("[inline](./inline.md)");
    expect(semanticNote?.body).toContain("[reference][guide]");
    expect(semanticNote?.body).toContain("[guide]: ./guide.md \"Guide title\"");
    expect(semanticNote?.body).toContain(
      "[installation steps](./guides/setup.md#install)"
    );
    expect(semanticNote?.body).toContain("[install-step](./blocks.md#install-step)");
    expect(semanticNote?.body).toContain("[Overview](./shared-context.md#overview)");
    expect(search.getConcept("blocks")?.body).toContain('<a id="install-step"></a>');

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await runImportCommand(fixtureDir, {
      out: firstBundle,
      sourceName,
      force: true,
      stableTimestamps: true
    });
    expect(warn).toHaveBeenCalledExactlyOnceWith("Warnings: 1 (unresolved_wikilink: 1)");
    expect(log).toHaveBeenCalledWith("okfy import");
    expect(await readTree(firstBundle)).toEqual(await readTree(secondBundle));

    const inspector = await buildBundleInspectorReport(firstBundle);
    expect(inspector.readiness).toMatchObject({
      validationStatus: "valid",
      conceptCount: 11,
      warningCount: 1,
      brokenLinkCount: 0
    });
    expect(inspector.sources[0]?.validationIssues).toEqual(validation.issues);
    expect(inspector.concepts.find((concept) => concept.ref === "semantic-note")).toMatchObject({
      outbound: ["blocks", "guide", "guides/setup", "inline", "shared-context"]
    });
    expect(inspector.concepts.find((concept) => concept.ref === "shared-context")).toMatchObject({
      backlinks: ["semantic-note"]
    });

    const html = renderInspectorHtml(inspector);
    expect(html).toContain("Semantic warnings");
    expect(html).toContain("unresolved_wikilink");
    expect(html).toContain("Intentional Missing &lt;script&gt;");
    expect(html).not.toContain(intentionalTarget);

    const server = await createMcpServer({ bundleDir: firstBundle, maxResultChars: 20_000 });
    const callTool = mcpHandler(server, "tools/call");
    const summaryCall = await callTool({
      method: "tools/call",
      params: { name: "bundle_summary", arguments: {} }
    });
    const summary = JSON.parse(summaryCall.content[0]?.text ?? "null") as {
      conceptCount: number;
      warningCount: number;
      validationStatus: string;
      validationIssues: Array<Record<string, unknown>>;
    };

    expect(summaryCall.isError).toBe(false);
    expect(summaryCall.structuredContent).toEqual(summary);
    expect(summary).toMatchObject({
      conceptCount: 11,
      warningCount: 1,
      validationStatus: "valid"
    });
    expect(summary.validationIssues).toEqual(validation.issues);
  });
});
