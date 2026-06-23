import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildBundleInspectorReport,
  buildWorkspaceInspectorReport
} from "../src/inspector.js";
import {
  type RefreshState,
  type SourceManifest,
  type SourceStoreOptions,
  writeRefreshState,
  writeSourceManifest
} from "../src/source-store.js";
import { resolveWorkspaceSources } from "../src/workspace.js";

const tempDirs: string[] = [];

function fixture(name: string): string {
  return path.resolve("test-fixtures", name);
}

async function tempHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-inspector-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function manifest(name: string, partial: Partial<SourceManifest> = {}): SourceManifest {
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
    },
    ...partial
  };
}

function state(partial: Partial<RefreshState> = {}): RefreshState {
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
  options: SourceStoreOptions & {
    sourceState?: RefreshState;
    fixtureName?: string;
  } = {}
): Promise<void> {
  await writeSourceManifest(manifest(name), { okfyHome });
  await writeRefreshState(name, options.sourceState ?? state(), { okfyHome });
  await fs.cp(
    fixture(options.fixtureName ?? "okf-valid"),
    path.join(okfyHome, "sources", name, "bundle"),
    { recursive: true }
  );
}

describe("InspectorReport bundle assembly", () => {
  it("reports valid bundle concepts, collapsed edges, readiness, and agent preview", async () => {
    const report = await buildBundleInspectorReport(fixture("okf-valid"));

    expect(report).toMatchObject({
      schemaVersion: 1,
      target: { kind: "bundle" },
      readiness: {
        validationStatus: "valid",
        conceptCount: 2,
        brokenLinkCount: 0,
        warningCount: 0,
        usableSourceCount: 1
      }
    });
    expect(report.concepts.map((concept) => concept.ref)).toEqual([
      "guides/quickstart",
      "reference/api"
    ]);
    expect(report.edges).toEqual([
      {
        from: "guides/quickstart",
        to: "reference/api",
        kind: "internal_link",
        label: "Markdown link"
      }
    ]);
    expect(report.agentPreview.sequence.map((step) => step.tool)).toEqual([
      "bundle_summary",
      "search_concepts",
      "read_concept",
      "get_neighbors"
    ]);
    expect(report.agentPreview.suggestedQuestions.length).toBeGreaterThanOrEqual(2);
  });

  it("preserves warning and broken-link counts without marking a bundle unavailable", async () => {
    const report = await buildBundleInspectorReport(fixture("okf-broken-link-valid"));

    expect(report.readiness).toMatchObject({
      validationStatus: "valid",
      availabilityStatus: "available",
      conceptCount: 1,
      warningCount: 1,
      brokenLinkCount: 1,
      usableSourceCount: 1
    });
    expect(report.sources[0]).toMatchObject({
      availabilityStatus: "available",
      validationStatus: "valid",
      warningCount: 1,
      brokenLinkCount: 1
    });
  });

  it("exposes concept resource, tags, type, and citation identifiers", async () => {
    const report = await buildBundleInspectorReport(fixture("okf-valid"));

    expect(report.concepts.find((concept) => concept.ref === "guides/quickstart")).toMatchObject({
      id: "guides/quickstart",
      ref: "guides/quickstart",
      title: "Quickstart",
      type: "Guide",
      tags: ["quickstart", "mcp", "import"],
      resource: "https://docs.example.com/guides/quickstart",
      citation: {
        ref: "guides/quickstart",
        sourceResource: "https://docs.example.com/guides/quickstart"
      }
    });
  });
});

describe("InspectorReport registered workspace assembly", () => {
  it("uses source-scoped refs for registered fixture sources", async () => {
    const okfyHome = await tempHome();
    await registerFixtureSource(okfyHome, "stripe");
    await registerFixtureSource(okfyHome, "clerk");
    const sourceSet = await resolveWorkspaceSources({ names: ["stripe", "clerk"] }, { okfyHome });

    const report = await buildWorkspaceInspectorReport(sourceSet.records, {
      workspaceName: "payments"
    });

    expect(report).toMatchObject({
      target: { kind: "workspace", workspaceName: "payments" },
      readiness: {
        sourceCount: 2,
        usableSourceCount: 2,
        conceptCount: 4,
        validationStatus: "valid"
      }
    });
    expect(report.concepts.map((concept) => concept.ref)).toEqual([
      "stripe:guides/quickstart",
      "stripe:reference/api",
      "clerk:guides/quickstart",
      "clerk:reference/api"
    ]);
    expect(report.edges.map((edge) => `${edge.from}->${edge.to}`)).toEqual([
      "stripe:guides/quickstart->stripe:reference/api",
      "clerk:guides/quickstart->clerk:reference/api"
    ]);
    expect(report.agentPreview.suggestedQuestions).toContain(
      "In stripe, what should I read first to get started?"
    );
  });

  it("includes stale registered source freshness readiness fields", async () => {
    const okfyHome = await tempHome();
    await registerFixtureSource(okfyHome, "stripe", {
      sourceState: state({
        status: "stale",
        lastSuccessfulRefreshAt: "2026-06-20T10:15:00.000Z",
        nextRefreshAllowedAt: "2026-06-20T10:30:00.000Z"
      })
    });
    const sourceSet = await resolveWorkspaceSources({ names: ["stripe"] }, { okfyHome });

    const report = await buildWorkspaceInspectorReport(sourceSet.records);

    expect(report.sources[0]).toMatchObject({
      sourceName: "stripe",
      freshnessStatus: "stale",
      lastSuccessfulRefreshAt: "2026-06-20T10:15:00.000Z",
      nextRefreshAllowedAt: "2026-06-20T10:30:00.000Z"
    });
    expect(report.readiness.sources[0]).toMatchObject({
      sourceName: "stripe",
      freshnessStatus: "stale",
      lastSuccessfulRefreshAt: "2026-06-20T10:15:00.000Z",
      nextRefreshAllowedAt: "2026-06-20T10:30:00.000Z"
    });
  });

  it("keeps usable source data when another registered source is unavailable", async () => {
    const okfyHome = await tempHome();
    await registerFixtureSource(okfyHome, "stripe");
    await fs.mkdir(path.join(okfyHome, "sources", "missing"), { recursive: true });
    const sourceSet = await resolveWorkspaceSources({ all: true }, { okfyHome });

    const report = await buildWorkspaceInspectorReport(sourceSet.records);

    expect(report.readiness).toMatchObject({
      sourceCount: 2,
      usableSourceCount: 1,
      conceptCount: 2,
      validationStatus: "invalid"
    });
    expect(report.concepts.map((concept) => concept.ref)).toEqual([
      "stripe:guides/quickstart",
      "stripe:reference/api"
    ]);
    expect(report.sources.find((source) => source.sourceName === "stripe")).toMatchObject({
      availabilityStatus: "available",
      validationStatus: "valid"
    });
    expect(report.sources.find((source) => source.sourceName === "missing")).toMatchObject({
      availabilityStatus: "unavailable",
      validationStatus: "unavailable",
      lastRefreshError: { code: "ENOENT" }
    });
  });
});
