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

type BundleSummary = {
  conceptCount: number;
  warningCount: number;
  validationStatus: string;
  validationIssues: Array<Record<string, unknown>>;
};

function mcpHandler(server: unknown, method: string): McpHandler {
  const handlers = (server as { _requestHandlers: Map<string, McpHandler> })._requestHandlers;
  const found = handlers.get(method);
  if (!found) throw new Error(`Missing MCP handler: ${method}`);
  return found;
}

async function bundleSummary(
  callTool: McpHandler
): Promise<{ response: McpTextResult; summary: BundleSummary }> {
  const response = await callTool({
    method: "tools/call",
    params: { name: "bundle_summary", arguments: {} }
  });
  return {
    response,
    summary: JSON.parse(response.content[0]?.text ?? "null") as BundleSummary
  };
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
  it("persists missing-fragment diagnostics through validation, Inspector, and MCP", async () => {
    const root = await tempRoot();
    const input = path.join(root, "vault");
    const firstBundle = path.join(root, "first-bundle");
    const secondBundle = path.join(root, "second-bundle");
    await fs.mkdir(input);
    await fs.writeFile(
      path.join(input, "Source.md"),
      [
        "---",
        "title: Source",
        "description: Minimal missing-fragment warning persistence reproduction.",
        "type: note",
        "---",
        "",
        "# Source",
        "",
        "[[Target#Missing Heading]]",
        "",
        "[[Target#^missing-block]]",
        ""
      ].join("\n"),
      "utf8"
    );
    await fs.writeFile(
      path.join(input, "Target.md"),
      [
        "---",
        "title: Target",
        "description: Target without the requested heading or block.",
        "type: note",
        "---",
        "",
        "# Target",
        "",
        "No matching fragment exists.",
        ""
      ].join("\n"),
      "utf8"
    );

    const options = {
      inputPath: input,
      sourceName: "Missing fragment repro",
      force: true,
      timestamp: stableTimestamp
    };
    const first = await importLocal({ ...options, outDir: firstBundle });
    const second = await importLocal({ ...options, outDir: secondBundle });
    const expectedImportDiagnostics = [
      {
        severity: "warning" as const,
        code: "missing_wikilink_fragment",
        message:
          'Missing fragment in Obsidian reference "Target#Missing Heading" from Source.md to Target.md.',
        sourcePath: "Source.md",
        rawTarget: "Target#Missing Heading",
        candidates: ["Target.md"]
      },
      {
        severity: "warning" as const,
        code: "missing_wikilink_fragment",
        message:
          'Missing fragment in Obsidian reference "Target#^missing-block" from Source.md to Target.md.',
        sourcePath: "Source.md",
        rawTarget: "Target#^missing-block",
        candidates: ["Target.md"]
      }
    ];

    expect(first.diagnostics).toEqual(expectedImportDiagnostics);
    expect(second.diagnostics).toEqual(expectedImportDiagnostics);
    expect(second.documents).toEqual(first.documents);
    expect(await readTree(secondBundle)).toEqual(await readTree(firstBundle));

    const generatedSource = await fs.readFile(path.join(firstBundle, "source.md"), "utf8");
    expect(generatedSource).toContain("[Missing Heading](./target.md#missing-heading)");
    expect(generatedSource).toContain("[missing-block](./target.md#missing-block)");
    expect(generatedSource).not.toContain("[[Target");

    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await runImportCommand(input, {
      out: firstBundle,
      sourceName: options.sourceName,
      force: true,
      stableTimestamps: true
    });
    expect(warn).toHaveBeenCalledExactlyOnceWith("Warnings: 2 (missing_wikilink_fragment: 2)");
    expect(log).toHaveBeenCalledWith("okfy import");
    expect(await readTree(firstBundle)).toEqual(await readTree(secondBundle));

    const expectedValidationIssues = expectedImportDiagnostics.map(
      ({ sourcePath, ...diagnostic }) => ({ ...diagnostic, path: sourcePath })
    );
    const validation = await validateBundle(firstBundle);
    expect(validation).toMatchObject({ valid: true, conceptCount: 2, warningCount: 2 });
    expect(validation.issues).toEqual(expectedValidationIssues);

    const inspector = await buildBundleInspectorReport(firstBundle);
    expect(inspector.readiness).toMatchObject({
      validationStatus: "valid",
      conceptCount: 2,
      warningCount: 2,
      brokenLinkCount: 0
    });
    expect(inspector.sources[0]?.validationIssues).toEqual(expectedValidationIssues);

    const html = renderInspectorHtml(inspector);
    expect(html).toContain("Semantic warnings");
    expect(html.match(/<li><code>missing_wikilink_fragment<\/code>/g)).toHaveLength(2);
    expect(html).toContain("Target#Missing Heading");
    expect(html).toContain("Target#^missing-block");

    const server = await createMcpServer({ bundleDir: firstBundle, maxResultChars: 20_000 });
    const callTool = mcpHandler(server, "tools/call");
    const { response: summaryCall, summary } = await bundleSummary(callTool);

    expect(summaryCall.isError).toBe(false);
    expect(summaryCall.structuredContent).toEqual(summary);
    expect(summary).toMatchObject({
      conceptCount: 2,
      warningCount: 2,
      validationStatus: "valid"
    });
    expect(summary.validationIssues).toEqual(expectedValidationIssues);

    const sourcePath = path.join(firstBundle, "source.md");
    const sourceWithOrdinaryLink = `${generatedSource
      .replace("[Missing Heading](./target.md#missing-heading)", "")
      .trimEnd()}\n\n[ordinary](./target.md#missing-heading)\n`;
    await fs.writeFile(sourcePath, sourceWithOrdinaryLink, "utf8");

    const expectedEditedIssues = expectedValidationIssues.filter(
      (item) => item.rawTarget === "Target#^missing-block"
    );
    const editedValidation = await validateBundle(firstBundle);
    expect(editedValidation).toMatchObject({
      valid: true,
      conceptCount: 2,
      warningCount: 1
    });
    expect(editedValidation.issues).toEqual(expectedEditedIssues);

    const editedInspector = await buildBundleInspectorReport(firstBundle);
    expect(editedInspector.readiness).toMatchObject({
      validationStatus: "valid",
      conceptCount: 2,
      warningCount: 1,
      brokenLinkCount: 0
    });
    expect(editedInspector.sources[0]?.validationIssues).toEqual(expectedEditedIssues);

    const { response: editedSummaryCall, summary: editedSummary } = await bundleSummary(callTool);

    expect(editedSummaryCall.isError).toBe(false);
    expect(editedSummaryCall.structuredContent).toEqual(editedSummary);
    expect(editedSummary).toMatchObject({
      conceptCount: 2,
      warningCount: 1,
      validationStatus: "valid"
    });
    expect(editedSummary.validationIssues).toEqual(expectedEditedIssues);
  });

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
    expect(semanticNote?.body).toContain('[guide]: ./guide.md "Guide title"');
    expect(semanticNote?.body).toContain("[installation steps](./guides/setup.md#install)");
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
    const { response: summaryCall, summary } = await bundleSummary(callTool);

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
