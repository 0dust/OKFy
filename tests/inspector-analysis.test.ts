import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const instrumentation = vi.hoisted(() => ({
  analyzeBundle: vi.fn(),
  inspectBundle: vi.fn(),
  parseMarkdown: vi.fn()
}));

vi.mock("../src/markdown-ast.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/markdown-ast.js")>();
  return {
    ...actual,
    parseMarkdown: (...args: Parameters<typeof actual.parseMarkdown>) => {
      instrumentation.parseMarkdown(...args);
      return actual.parseMarkdown(...args);
    }
  };
});

vi.mock("../src/validate.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/validate.js")>();
  return {
    ...actual,
    analyzeBundle: async (...args: Parameters<typeof actual.analyzeBundle>) => {
      const analysis = await actual.analyzeBundle(...args);
      instrumentation.analyzeBundle(...args, analysis);
      return analysis;
    },
    inspectBundle: async (...args: Parameters<typeof actual.inspectBundle>) => {
      instrumentation.inspectBundle(...args);
      return actual.inspectBundle(...args);
    }
  };
});

import { buildBundleInspectorReport } from "../src/inspector.js";
import { createMcpServer } from "../src/mcp.js";
import { mcpHandler } from "./support/mcp-handler.js";

const tempDirs: string[] = [];

afterEach(async () => {
  instrumentation.analyzeBundle.mockClear();
  instrumentation.inspectBundle.mockClear();
  instrumentation.parseMarkdown.mockClear();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("Inspector analysis reuse", () => {
  it("shares one validation and graph analysis with one Markdown parse per concept", async () => {
    const bundleDir = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-inspector-analysis-test-"));
    tempDirs.push(bundleDir);
    await fs.writeFile(path.join(bundleDir, "index.md"), "# Inspector analysis\n", "utf8");
    for (const [name, body] of [
      ["one", "# One\n\n[Two](./two.md)"],
      ["two", "# Two\n\n[Three](./three.md)"],
      ["three", "# Three\n\nDone."]
    ]) {
      await fs.writeFile(
        path.join(bundleDir, `${name}.md`),
        [
          "---",
          'type: "Note"',
          `title: ${JSON.stringify(name)}`,
          `resource: ${JSON.stringify(`${name}.md`)}`,
          "tags: []",
          'timestamp: "2026-06-14T00:00:00.000Z"',
          "---",
          "",
          body
        ].join("\n"),
        "utf8"
      );
    }

    const report = await buildBundleInspectorReport(bundleDir);

    expect(report.concepts).toHaveLength(3);
    expect(instrumentation.analyzeBundle).toHaveBeenCalledTimes(1);
    expect(instrumentation.inspectBundle).toHaveBeenCalledTimes(1);
    const analysis = instrumentation.analyzeBundle.mock.calls[0]?.[1];
    expect(instrumentation.inspectBundle.mock.calls[0]?.[1]).toMatchObject({
      analysis: expect.objectContaining({
        validation: analysis.validation,
        graph: expect.objectContaining({ concepts: expect.any(Map) })
      })
    });
    expect(instrumentation.parseMarkdown).toHaveBeenCalledTimes(3);
  });

  it("shares one validation and graph analysis for an MCP bundle summary", async () => {
    const bundleDir = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-mcp-analysis-test-"));
    tempDirs.push(bundleDir);
    await fs.writeFile(path.join(bundleDir, "index.md"), "# MCP analysis\n", "utf8");
    for (const name of ["one", "two", "three"]) {
      await fs.writeFile(
        path.join(bundleDir, `${name}.md`),
        [
          "---",
          'type: "Note"',
          `title: ${JSON.stringify(name)}`,
          `resource: ${JSON.stringify(`${name}.md`)}`,
          "tags: []",
          'timestamp: "2026-06-14T00:00:00.000Z"',
          "---",
          "",
          `# ${name}`
        ].join("\n"),
        "utf8"
      );
    }
    const server = await createMcpServer({ bundleDir, maxResultChars: 12_000 });
    instrumentation.analyzeBundle.mockClear();
    instrumentation.inspectBundle.mockClear();
    instrumentation.parseMarkdown.mockClear();

    const result = await mcpHandler(
      server,
      "tools/call"
    )({
      method: "tools/call",
      params: { name: "bundle_summary", arguments: {} }
    });

    expect(result.isError).not.toBe(true);
    expect(instrumentation.analyzeBundle).toHaveBeenCalledTimes(1);
    expect(instrumentation.inspectBundle).toHaveBeenCalledTimes(1);
    expect(instrumentation.parseMarkdown).toHaveBeenCalledTimes(3);
  });
});
