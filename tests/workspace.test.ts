import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BundleSearch } from "../src/search.js";
import {
  writeRefreshState,
  writeSourceManifest,
  type RefreshState,
  type SourceManifest
} from "../src/source-store.js";
import {
  WorkspaceError,
  WorkspaceSearch,
  resolveWorkspaceSources,
  writeWorkspaceProfile,
  type WorkspaceSearchSource
} from "../src/workspace.js";

const tempDirs: string[] = [];

async function tempHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-workspace-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function manifest(name: string, partial: Partial<SourceManifest> = {}): SourceManifest {
  return {
    schemaVersion: 1,
    okfyVersion: "0.2.0",
    name,
    kind: "website",
    createdAt: "2026-06-20T00:00:00.000Z",
    updatedAt: "2026-06-20T00:00:00.000Z",
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
    lastCheckedAt: "2026-06-20T00:00:00.000Z",
    lastRefreshStartedAt: "2026-06-20T00:00:00.000Z",
    lastRefreshCompletedAt: "2026-06-20T00:01:00.000Z",
    lastSuccessfulRefreshAt: "2026-06-20T00:01:00.000Z",
    nextRefreshAllowedAt: "2026-06-20T00:16:00.000Z",
    refreshInProgress: false,
    lastError: null,
    bundle: {
      conceptCount: 1,
      warningCount: 0,
      valid: true,
      contentHash: "sha256:test"
    },
    ...partial
  };
}

async function registerSource(okfyHome: string, name: string): Promise<void> {
  await writeSourceManifest(manifest(name), { okfyHome });
  await writeRefreshState(name, state(), { okfyHome });
}

async function writeBundle(
  dir: string,
  options: {
    id?: string;
    title: string;
    type: string;
    body: string;
    resource?: string;
    tags?: string[];
  }
): Promise<void> {
  const id = options.id ?? "guides/quickstart";
  const conceptPath = path.join(dir, `${id}.md`);
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(conceptPath), { recursive: true });
  await fs.writeFile(
    path.join(dir, "index.md"),
    `# ${options.title}\n\n* [${options.title}](${id}.md)\n`,
    "utf8"
  );
  await fs.writeFile(
    conceptPath,
    `---\ntype: "${options.type}"\ntitle: "${options.title}"\ndescription: "${options.body}"\nresource: "${options.resource ?? `https://docs.example.com/${id}`}"\ntags:\n${(options.tags ?? ["workspace"]).map((tag) => `  - "${tag}"`).join("\n")}\ntimestamp: "2026-06-20T00:00:00.000Z"\n---\n\n# ${options.title}\n\n${options.body}\n`,
    "utf8"
  );
}

describe("workspace source resolution", () => {
  it("resolves explicit source names in caller order", async () => {
    const okfyHome = await tempHome();
    await registerSource(okfyHome, "stripe");
    await registerSource(okfyHome, "clerk");
    await registerSource(okfyHome, "supabase");

    const sourceSet = await resolveWorkspaceSources(
      { names: ["stripe", "clerk", "supabase"] },
      { okfyHome }
    );

    expect(sourceSet.sourceNames).toEqual(["stripe", "clerk", "supabase"]);
    expect(sourceSet.records.map((record) => record.bundleDir)).toEqual([
      path.join(okfyHome, "sources", "stripe", "bundle"),
      path.join(okfyHome, "sources", "clerk", "bundle"),
      path.join(okfyHome, "sources", "supabase", "bundle")
    ]);
  });

  it("rejects duplicate and unknown explicit sources", async () => {
    const okfyHome = await tempHome();
    await registerSource(okfyHome, "stripe");

    await expect(
      resolveWorkspaceSources({ names: ["stripe", "stripe"] }, { okfyHome })
    ).rejects.toMatchObject({
      code: "duplicate_source"
    });
    await expect(
      resolveWorkspaceSources({ names: ["stripe", "missing"] }, { okfyHome })
    ).rejects.toThrow(/missing|ENOENT/i);
  });

  it("resolves --all in deterministic order with visible corrupt source errors", async () => {
    const okfyHome = await tempHome();
    await registerSource(okfyHome, "stripe");
    await registerSource(okfyHome, "clerk");

    await expect(resolveWorkspaceSources({ all: true }, { okfyHome })).resolves.toMatchObject({
      sourceNames: ["clerk", "stripe"]
    });

    await fs.mkdir(path.join(okfyHome, "sources", "broken"), { recursive: true });
    await expect(resolveWorkspaceSources({ all: true }, { okfyHome })).resolves.toMatchObject({
      sourceNames: ["broken", "clerk", "stripe"],
      records: [
        {
          name: "broken",
          loadError: { code: "ENOENT" }
        },
        { name: "clerk" },
        { name: "stripe" }
      ]
    });
  });

  it("resolves a minimal local workspace profile", async () => {
    const okfyHome = await tempHome();
    await registerSource(okfyHome, "stripe");
    await registerSource(okfyHome, "clerk");
    await writeWorkspaceProfile(
      { schemaVersion: 1, name: "payments", sources: ["stripe", "clerk"] },
      { okfyHome }
    );

    const sourceSet = await resolveWorkspaceSources({ profileName: "payments" }, { okfyHome });

    expect(sourceSet.workspaceName).toBe("payments");
    expect(sourceSet.sourceNames).toEqual(["stripe", "clerk"]);
  });

  it("rejects conflicting explicit names and profile selections", async () => {
    const okfyHome = await tempHome();
    await registerSource(okfyHome, "stripe");
    await registerSource(okfyHome, "clerk");
    await writeWorkspaceProfile(
      { schemaVersion: 1, name: "payments", sources: ["clerk"] },
      { okfyHome }
    );

    await expect(
      resolveWorkspaceSources({ names: ["stripe"], profileName: "payments" }, { okfyHome })
    ).rejects.toThrow(/choose one workspace source selection/i);
    await expect(
      resolveWorkspaceSources(
        { names: ["stripe"], profile: { schemaVersion: 1, name: "payments", sources: ["clerk"] } },
        { okfyHome }
      )
    ).rejects.toThrow(/choose one workspace source selection/i);
  });
});

describe("workspace search", () => {
  async function searchSources(okfyHome: string): Promise<WorkspaceSearchSource[]> {
    await registerSource(okfyHome, "stripe");
    await registerSource(okfyHome, "clerk");
    await writeBundle(path.join(okfyHome, "sources", "stripe", "bundle"), {
      title: "Stripe Quickstart",
      type: "Guide",
      body: "Create a checkout session with payment links.",
      resource: "https://docs.stripe.com/quickstart",
      tags: ["payments"]
    });
    await writeBundle(path.join(okfyHome, "sources", "clerk", "bundle"), {
      title: "Clerk Quickstart",
      type: "Guide",
      body: "Configure sessions and authentication.",
      resource: "https://clerk.com/docs/quickstart",
      tags: ["auth"]
    });
    const sourceSet = await resolveWorkspaceSources({ names: ["stripe", "clerk"] }, { okfyHome });
    return Promise.all(
      sourceSet.records.map(async (record) => ({
        record,
        bundleDir: record.bundleDir,
        search: await BundleSearch.fromBundle(record.bundleDir)
      }))
    );
  }

  it("labels search results with source identity and supports source filters", async () => {
    const okfyHome = await tempHome();
    const workspace = new WorkspaceSearch(await searchSources(okfyHome), {
      availableSourceNames: ["stripe", "clerk", "supabase"]
    });

    const all = workspace.search("quickstart", { limit: 10 });
    expect(all.map((result) => [result.sourceName, result.id]).sort()).toEqual([
      ["clerk", "guides/quickstart"],
      ["stripe", "guides/quickstart"]
    ]);
    expect(all.find((result) => result.sourceName === "clerk")).toMatchObject({
      sourceKind: "website",
      seedUrl: "https://docs.example.com/clerk",
      ref: "clerk:guides/quickstart"
    });

    const stripe = workspace.search("quickstart", { source: "stripe", limit: 10 });
    expect(stripe.map((result) => result.sourceName)).toEqual(["stripe"]);
  });

  it("requires source-aware reads when an id exists in more than one source", async () => {
    const okfyHome = await tempHome();
    const workspace = new WorkspaceSearch(await searchSources(okfyHome), {
      availableSourceNames: ["stripe", "clerk"]
    });

    expect(() => workspace.getConcept({ id: "guides/quickstart" })).toThrow(WorkspaceError);
    try {
      workspace.getConcept({ id: "guides/quickstart" });
    } catch (error) {
      expect((error as WorkspaceError).toJSON()).toMatchObject({
        code: "ambiguous_concept",
        candidates: [
          { sourceName: "stripe", id: "guides/quickstart" },
          { sourceName: "clerk", id: "guides/quickstart" }
        ]
      });
    }

    const { concept } = workspace.getConcept({ source: "stripe", id: "guides/quickstart" });
    expect(concept.title).toBe("Stripe Quickstart");
  });

  it("returns source_not_in_workspace for a valid but unselected source filter", async () => {
    const okfyHome = await tempHome();
    const workspace = new WorkspaceSearch(await searchSources(okfyHome), {
      availableSourceNames: ["stripe", "clerk", "supabase"]
    });

    expect(() => workspace.search("anything", { source: "supabase" })).toThrow(WorkspaceError);
    try {
      workspace.listTypes("supabase");
    } catch (error) {
      expect((error as WorkspaceError).toJSON()).toMatchObject({
        code: "source_not_in_workspace",
        source: "supabase",
        workspaceSources: ["stripe", "clerk"]
      });
    }
  });
});
