import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listSources,
  readRefreshState,
  readSourceManifest,
  removeSource,
  resolveBundleDir,
  resolveOkfyHome,
  resolveSourceDir,
  validateSourceName,
  writeRefreshState,
  writeSourceManifest,
  type RefreshState,
  type SourceManifest
} from "../src/source-store.js";

const tempDirs: string[] = [];

async function tempHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-source-store-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function manifest(partial: Partial<SourceManifest> = {}): SourceManifest {
  return {
    schemaVersion: 1,
    okfyVersion: "0.1.4",
    name: "stripe",
    kind: "website",
    createdAt: "2026-06-16T00:00:00.000Z",
    updatedAt: "2026-06-16T00:00:00.000Z",
    source: {
      seedUrl: "https://docs.stripe.com/checkout"
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
    lastCheckedAt: "2026-06-16T00:00:00.000Z",
    lastRefreshStartedAt: "2026-06-16T00:00:00.000Z",
    lastRefreshCompletedAt: "2026-06-16T00:01:10.000Z",
    lastSuccessfulRefreshAt: "2026-06-16T00:01:10.000Z",
    nextRefreshAllowedAt: "2026-06-16T00:16:10.000Z",
    refreshInProgress: false,
    lastError: null,
    bundle: {
      conceptCount: 25,
      warningCount: 0,
      valid: true,
      contentHash: "sha256:test"
    },
    ...partial
  };
}

describe("OKFY home and source names", () => {
  it("uses OKFY_HOME when resolving the local store home", () => {
    expect(resolveOkfyHome({ env: { OKFY_HOME: "/tmp/custom-okfy" } })).toBe(
      path.resolve("/tmp/custom-okfy")
    );
  });

  it("accepts stable filesystem-safe source names", () => {
    for (const name of [
      "stripe",
      "stripe_checkout",
      "stripe.checkout-v2",
      "a1",
      "-legacy",
      "_legacy",
      ".legacy"
    ]) {
      expect(validateSourceName(name)).toBe(name);
    }
  });

  it("rejects empty, unsafe, or path-like source names", () => {
    for (const name of [
      "",
      ".",
      "..",
      "Stripe",
      "stripe/docs",
      "stripe\\docs",
      "../stripe",
      "stripe docs"
    ]) {
      expect(() => validateSourceName(name)).toThrow(/source name/i);
    }
  });

  it("resolves source directories under OKFY_HOME sources", async () => {
    const okfyHome = await tempHome();

    expect(resolveSourceDir("stripe", { okfyHome })).toBe(path.join(okfyHome, "sources", "stripe"));
  });
});

describe("source manifest and state storage", () => {
  it("writes and reads source.json with stable two-space JSON", async () => {
    const okfyHome = await tempHome();

    await writeSourceManifest(manifest(), { okfyHome });

    await expect(readSourceManifest("stripe", { okfyHome })).resolves.toEqual(manifest());
    const sourceJson = await fs.readFile(
      path.join(okfyHome, "sources", "stripe", "source.json"),
      "utf8"
    );
    expect(sourceJson).toContain('\n  "schemaVersion": 1,\n');
    expect(sourceJson.indexOf('"schemaVersion"')).toBeLessThan(sourceJson.indexOf('"okfyVersion"'));
    expect(sourceJson.indexOf('"crawl"')).toBeLessThan(sourceJson.indexOf('"refresh"'));
    expect(sourceJson.endsWith("\n")).toBe(true);
  });

  it("writes and reads state.json with stable two-space JSON", async () => {
    const okfyHome = await tempHome();

    await writeSourceManifest(manifest(), { okfyHome });
    await writeRefreshState("stripe", state(), { okfyHome });

    await expect(readRefreshState("stripe", { okfyHome })).resolves.toEqual(state());
    const stateJson = await fs.readFile(
      path.join(okfyHome, "sources", "stripe", "state.json"),
      "utf8"
    );
    expect(stateJson).toContain('\n  "status": "fresh",\n');
    expect(stateJson.indexOf('"lastCheckedAt"')).toBeLessThan(
      stateJson.indexOf('"lastRefreshStartedAt"')
    );
    expect(stateJson.endsWith("\n")).toBe(true);
  });

  it("lists registered sources sorted by source name", async () => {
    const okfyHome = await tempHome();

    await writeSourceManifest(manifest({ name: "stripe" }), { okfyHome });
    await writeSourceManifest(
      manifest({ name: "astro", source: { seedUrl: "https://docs.astro.build" } }),
      {
        okfyHome
      }
    );
    await writeRefreshState("stripe", state(), { okfyHome });

    const sources = await listSources({ okfyHome });

    expect(sources.map((source) => source.name)).toEqual(["astro", "stripe"]);
    expect(sources[1]).toMatchObject({
      manifest: manifest(),
      state: state(),
      bundleDir: path.join(okfyHome, "sources", "stripe", "bundle")
    });
  });

  it("keeps corrupt source directories visible with load errors", async () => {
    const okfyHome = await tempHome();

    await fs.mkdir(path.join(okfyHome, "sources", "broken"), { recursive: true });
    await writeSourceManifest(manifest({ name: "stripe" }), { okfyHome });

    const sources = await listSources({ okfyHome });

    expect(sources.map((source) => source.name)).toEqual(["broken", "stripe"]);
    expect(sources[0]).toMatchObject({
      name: "broken",
      manifest: {
        name: "broken",
        okfyVersion: "unknown",
        bundle: { dir: "bundle" }
      },
      loadError: {
        code: "ENOENT"
      },
      bundleDir: path.join(okfyHome, "sources", "broken", "bundle")
    });
    expect(sources[0]?.loadError?.message).toMatch(/source\.json|ENOENT/);
  });

  it("turns malformed source manifests into fallback records", async () => {
    const okfyHome = await tempHome();
    const sourceDir = path.join(okfyHome, "sources", "broken");
    await fs.mkdir(sourceDir, { recursive: true });
    await fs.writeFile(
      path.join(sourceDir, "source.json"),
      '{"schemaVersion":1,"name":"broken"}\n',
      "utf8"
    );

    const sources = await listSources({ okfyHome });

    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      name: "broken",
      manifest: {
        name: "broken",
        source: { seedUrl: "" },
        bundle: { dir: "bundle" }
      },
      loadError: {
        message: expect.stringMatching(/kind|okfyVersion|source/i)
      }
    });
  });

  it("uses valid fallback names for invalid source directory names", async () => {
    const okfyHome = await tempHome();
    await fs.mkdir(path.join(okfyHome, "sources", "Bad Name"), { recursive: true });

    const sources = await listSources({ okfyHome });

    expect(sources).toHaveLength(1);
    expect(sources[0]?.name).toMatch(/^invalid-[a-z0-9]+-bad-name$/);
    expect(() => validateSourceName(sources[0]?.name ?? "")).not.toThrow();
    expect(sources[0]).toMatchObject({
      dir: path.join(okfyHome, "sources", "Bad Name"),
      manifest: {
        name: sources[0]?.name,
        source: { seedUrl: "" }
      },
      loadError: {
        sourceDirName: "Bad Name",
        message: expect.stringContaining('Invalid source name "Bad Name"')
      }
    });
  });
});

describe("bundle path safety and removal", () => {
  it("resolves relative bundle dirs inside the source directory", async () => {
    const okfyHome = await tempHome();

    expect(resolveBundleDir(manifest(), { okfyHome })).toBe(
      path.join(okfyHome, "sources", "stripe", "bundle")
    );
  });

  it("allows explicit absolute bundle dirs but rejects relative traversal", async () => {
    const okfyHome = await tempHome();
    const externalBundle = path.join(okfyHome, "external", "stripe-bundle");

    expect(resolveBundleDir(manifest({ bundle: { dir: externalBundle } }), { okfyHome })).toBe(
      externalBundle
    );
    expect(() =>
      resolveBundleDir(manifest({ bundle: { dir: "../outside" } }), { okfyHome })
    ).toThrow(/bundle/i);
  });

  it("removes only the registered source directory", async () => {
    const okfyHome = await tempHome();
    const externalBundle = path.join(okfyHome, "external", "stripe-bundle");
    await fs.mkdir(externalBundle, { recursive: true });
    await fs.writeFile(path.join(externalBundle, "index.md"), "# External\n", "utf8");
    await writeSourceManifest(manifest({ bundle: { dir: externalBundle } }), { okfyHome });
    await writeRefreshState("stripe", state(), { okfyHome });

    await removeSource("stripe", { okfyHome });

    await expect(fs.stat(path.join(okfyHome, "sources", "stripe"))).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(fs.readFile(path.join(externalBundle, "index.md"), "utf8")).resolves.toBe(
      "# External\n"
    );
  });
});
