import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildGraph } from "../src/graph.js";
import { normalizeDocument } from "../src/normalize.js";
import { readBundle } from "../src/reader.js";
import { validateBundle } from "../src/validate.js";
import { writeOkfBundle } from "../src/writer.js";
import type { NormalizedDocument, RawDocument } from "../src/types.js";

const fixtureRoot = path.resolve("test-fixtures");
const tempDirs: string[] = [];

async function tempOut(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function raw(partial: Omit<RawDocument, "discoveredAt" | "contentType" | "raw"> & { raw: string }): RawDocument {
  return { ...partial, contentType: "markdown", discoveredAt: "2026-06-14T00:00:00.000Z" };
}

describe("writer and validator", () => {
  it("writes valid OKF bundles with index and rewritten internal source links", async () => {
    const outDir = await tempOut();
    const docs: NormalizedDocument[] = [
      normalizeDocument(
        raw({
          sourceId: "https://docs.example.com/guides/quickstart",
          url: "https://docs.example.com/guides/quickstart",
          raw: "# Quickstart\n\nSee [API](https://docs.example.com/reference/api?utm_source=noise#tools)."
        })
      ),
      normalizeDocument(
        raw({
          sourceId: "https://docs.example.com/reference/api",
          url: "https://docs.example.com/reference/api",
          raw: "# API Reference\n\nSearch concepts with MCP."
        })
      )
    ];

    const written = await writeOkfBundle(docs, {
      outDir,
      title: "Docs",
      timestamp: "2026-06-14T00:00:00.000Z"
    });

    expect(written).toEqual([
      "guides/index.md",
      "guides/quickstart.md",
      "index.md",
      "reference/api.md",
      "reference/index.md"
    ]);
    const quickstart = await fs.readFile(path.join(outDir, "guides/quickstart.md"), "utf8");
    expect(quickstart).toContain('title: "Quickstart"');
    expect(quickstart).toContain("[API](../reference/api.md).");
    const rootIndex = await fs.readFile(path.join(outDir, "index.md"), "utf8");
    const folderIndex = await fs.readFile(path.join(outDir, "guides/index.md"), "utf8");
    expect(rootIndex).not.toMatch(/^---/);
    expect(folderIndex).not.toMatch(/^---/);
    expect(rootIndex).toContain("* [Quickstart](guides/quickstart.md) - ");
    expect(folderIndex).toContain("* [Quickstart](quickstart.md) - ");

    const report = await validateBundle(outDir);
    expect(report.valid).toBe(true);
    expect(report.conceptCount).toBe(2);
    expect(report.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("does not write root or folder index source pages as concept documents", async () => {
    const outDir = await tempOut();
    const docs = [
      normalizeDocument(
        raw({
          sourceId: "https://docs.example.com/",
          url: "https://docs.example.com/",
          raw: "# Home\n\nWelcome to the docs."
        })
      ),
      normalizeDocument(
        raw({
          sourceId: "https://docs.example.com/guides/",
          url: "https://docs.example.com/guides/",
          raw: "# Guides\n\nUse the guide."
        })
      )
    ];

    const written = await writeOkfBundle(docs, {
      outDir,
      title: "Docs",
      timestamp: "2026-06-14T00:00:00.000Z"
    });

    expect(written).toEqual(["guides/index.md", "guides/overview.md", "home.md", "index.md"]);
    const concepts = await readBundle(outDir);
    expect([...new Set([...concepts.values()].map((concept) => concept.id)).values()].sort()).toEqual(["guides/overview", "home"]);
    const report = await validateBundle(outDir);
    expect(report).toMatchObject({ valid: true, conceptCount: 2 });
  });

  it("reports only Google OKF conformance errors for malformed concept docs", async () => {
    const report = await validateBundle(path.join(fixtureRoot, "okf-invalid"));

    expect(report.valid).toBe(false);
    expect(report.issues.filter((issue) => issue.severity === "error").map((issue) => issue.code).sort()).toEqual([
      "malformed_frontmatter",
      "missing_frontmatter",
      "missing_type"
    ]);
  });

  it("validates committed Google-style fixture bundle without counting reserved files as concepts", async () => {
    const report = await validateBundle(path.join(fixtureRoot, "okf-valid"));

    expect(report.valid).toBe(true);
    expect(report.conceptCount).toBe(2);
    expect(report.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("keeps broken internal links as warnings and preserves bundle validity", async () => {
    const report = await validateBundle(path.join(fixtureRoot, "okf-broken-link-valid"));

    expect(report.valid).toBe(true);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "warning", code: "broken_internal_link", path: "tables/orders.md" })
      ])
    );
  });

  it("resolves absolute bundle-relative links from bundle root", async () => {
    const bundle = await readBundle(path.join(fixtureRoot, "okf-absolute-link-valid"));
    const graph = buildGraph(bundle);

    expect(graph.outbound.get("tables/orders")).toEqual(["tables/customers"]);
    expect(graph.backlinks.get("tables/customers")).toEqual(["tables/orders"]);
    const report = await validateBundle(path.join(fixtureRoot, "okf-absolute-link-valid"));
    expect(report).toMatchObject({ valid: true, conceptCount: 2 });
  });

  it("allows root index.md to declare only okf_version frontmatter", async () => {
    const report = await validateBundle(path.join(fixtureRoot, "okf-root-version-valid"));

    expect(report).toMatchObject({ valid: true, conceptCount: 1 });
    expect(report.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });
});
