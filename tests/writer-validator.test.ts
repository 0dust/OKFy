import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeDocument } from "../src/normalize.js";
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

    const report = await validateBundle(outDir);
    expect(report.valid).toBe(true);
    expect(report.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("reports PRD validation errors for malformed bundles", async () => {
    const report = await validateBundle(path.join(fixtureRoot, "okf-invalid"));

    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining([
        "missing_frontmatter",
        "missing_type",
        "bad_field_shape",
        "broken_internal_link",
        "missing_folder_index"
      ])
    );
  });

  it("validates committed fixture bundle", async () => {
    const report = await validateBundle(path.join(fixtureRoot, "okf-valid"));

    expect(report.valid).toBe(true);
    expect(report.conceptCount).toBe(5);
    expect(report.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });
});
