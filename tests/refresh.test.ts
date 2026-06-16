import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateFreshness, refreshSource } from "../src/refresh.js";
import type { RefreshSourceManifest, RefreshState } from "../src/refresh.js";

const tempDirs: string[] = [];

async function tempOut(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-refresh-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function manifest(partial: Partial<RefreshSourceManifest> = {}): RefreshSourceManifest {
  return {
    schemaVersion: 1,
    name: "stripe",
    kind: "website",
    source: { seedUrl: "https://docs.stripe.com/checkout" },
    crawl: {
      maxPages: 3,
      maxDepth: 2,
      sameOrigin: true,
      respectRobots: true,
      concurrency: 2,
      allowPrivateNetwork: false
    },
    refresh: {
      mode: "stale-while-refresh",
      maxAgeSeconds: 60,
      minIntervalSeconds: 15
    },
    bundle: { dir: "bundle" },
    ...partial
  };
}

function state(partial: Partial<RefreshState> = {}): RefreshState {
  return {
    schemaVersion: 1,
    status: "fresh",
    lastCheckedAt: "2026-06-16T00:00:00.000Z",
    lastRefreshStartedAt: "2026-06-16T00:00:00.000Z",
    lastRefreshCompletedAt: "2026-06-16T00:00:00.000Z",
    lastSuccessfulRefreshAt: "2026-06-16T00:00:00.000Z",
    nextRefreshAllowedAt: "2026-06-16T00:00:15.000Z",
    refreshInProgress: false,
    lastError: null,
    bundle: {
      conceptCount: 2,
      warningCount: 0,
      valid: true,
      contentHash: "sha256:old"
    },
    ...partial
  };
}

describe("evaluateFreshness", () => {
  it("reports fresh when an active valid bundle was refreshed inside max age", async () => {
    const root = await tempOut();
    const bundleDir = path.join(root, "bundle");
    await fs.mkdir(bundleDir);

    const result = await evaluateFreshness({
      manifest: manifest(),
      state: state(),
      bundleDir,
      now: new Date("2026-06-16T00:00:30.000Z"),
      validateBundle: async () => ({ valid: true, issues: [], conceptCount: 2, reservedFileCount: 1, warningCount: 0 })
    });

    expect(result.status).toBe("fresh");
    expect(result.reason).toBe("within_max_age");
  });

  it("reports missing, stale, and failed freshness states", async () => {
    const root = await tempOut();
    const bundleDir = path.join(root, "bundle");

    await expect(
      evaluateFreshness({
        manifest: manifest(),
        state: state(),
        bundleDir,
        now: new Date("2026-06-16T00:00:30.000Z")
      })
    ).resolves.toMatchObject({ status: "missing", reason: "bundle_missing" });

    await fs.mkdir(bundleDir);
    await expect(
      evaluateFreshness({
        manifest: manifest(),
        state: state({ lastSuccessfulRefreshAt: "2026-06-15T23:00:00.000Z" }),
        bundleDir,
        now: new Date("2026-06-16T00:01:30.000Z"),
        validateBundle: async () => ({ valid: true, issues: [], conceptCount: 2, reservedFileCount: 1, warningCount: 0 })
      })
    ).resolves.toMatchObject({ status: "stale", reason: "exceeded_max_age" });

    await expect(
      evaluateFreshness({
        manifest: manifest(),
        state: state({
          status: "failed",
          nextRefreshAllowedAt: "2026-06-16T00:02:00.000Z",
          lastError: {
            message: "network offline",
            sourceName: "stripe",
            seedUrl: "https://docs.stripe.com/checkout",
            occurredAt: "2026-06-16T00:01:00.000Z"
          }
        }),
        bundleDir,
        now: new Date("2026-06-16T00:01:30.000Z"),
        validateBundle: async () => {
          throw new Error("failed state should stay throttled before nextRefreshAllowedAt");
        }
      })
    ).resolves.toMatchObject({ status: "failed", reason: "latest_refresh_failed" });

    await expect(
      evaluateFreshness({
        manifest: manifest(),
        state: state({
          status: "failed",
          nextRefreshAllowedAt: "2026-06-16T00:01:00.000Z",
          lastError: {
            message: "network offline",
            sourceName: "stripe",
            seedUrl: "https://docs.stripe.com/checkout",
            occurredAt: "2026-06-16T00:01:00.000Z"
          }
        }),
        bundleDir,
        now: new Date("2026-06-16T00:01:30.000Z"),
        validateBundle: async () => ({ valid: true, issues: [], conceptCount: 2, reservedFileCount: 1, warningCount: 0 })
      })
    ).resolves.toMatchObject({ status: "stale", reason: "latest_refresh_failed" });
  });
});

describe("refreshSource", () => {
  it("does not recrawl a fresh bundle unless forced", async () => {
    const root = await tempOut();
    const bundleDir = path.join(root, "bundle");
    await fs.mkdir(bundleDir);
    const writes: RefreshState[] = [];

    const result = await refreshSource({
      manifest: manifest(),
      state: state({
        status: "fresh",
        lastSuccessfulRefreshAt: "2026-06-16T00:00:00.000Z",
        nextRefreshAllowedAt: "2026-06-16T00:00:15.000Z"
      }),
      sourceDir: root,
      bundleDir,
      now: new Date("2026-06-16T00:00:30.000Z"),
      validateBundle: async () => ({ valid: true, issues: [], conceptCount: 2, reservedFileCount: 1, warningCount: 0 }),
      crawlRunner: async () => {
        throw new Error("crawler should not run for a fresh bundle");
      },
      inspectBundle: async () => {
        throw new Error("inspector should not run for a fresh bundle");
      },
      hashBundleContent: async () => {
        throw new Error("hasher should not run for a fresh bundle");
      },
      writeState: async (next) => {
        writes.push(next);
      }
    });

    expect(result).toMatchObject({ status: "fresh", skipped: true, reason: "fresh" });
    expect(writes).toEqual([
      expect.objectContaining({
        status: "fresh",
        lastCheckedAt: "2026-06-16T00:00:30.000Z",
        refreshInProgress: false
      })
    ]);
  });

  it("skips stale refresh attempts until the minimum interval expires", async () => {
    const root = await tempOut();
    const bundleDir = path.join(root, "bundle");
    await fs.mkdir(bundleDir);
    const writes: RefreshState[] = [];
    const staleState = state({
      status: "stale",
      lastSuccessfulRefreshAt: "2026-06-15T23:00:00.000Z",
      nextRefreshAllowedAt: "2026-06-16T00:01:00.000Z"
    });

    const result = await refreshSource({
      manifest: manifest(),
      state: staleState,
      sourceDir: root,
      bundleDir,
      now: new Date("2026-06-16T00:00:30.000Z"),
      validateBundle: async () => ({ valid: true, issues: [], conceptCount: 2, reservedFileCount: 1, warningCount: 0 }),
      crawlRunner: async () => {
        throw new Error("crawler should not run while throttled");
      },
      inspectBundle: async () => {
        throw new Error("inspector should not run while throttled");
      },
      hashBundleContent: async () => {
        throw new Error("hasher should not run while throttled");
      },
      writeState: async (next) => {
        writes.push(next);
      }
    });

    expect(result).toMatchObject({ status: "stale", skipped: true, reason: "min_interval" });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      status: "stale",
      lastCheckedAt: "2026-06-16T00:00:30.000Z",
      refreshInProgress: false
    });
  });

  it("recrawls into a temp bundle and replaces the active bundle after validation succeeds", async () => {
    const root = await tempOut();
    const bundleDir = path.join(root, "bundle");
    await fs.mkdir(bundleDir);
    await fs.writeFile(path.join(bundleDir, "old.md"), "old bundle\n", "utf8");
    const writes: RefreshState[] = [];
    let crawlOutDir = "";
    let crawled = false;

    const result = await refreshSource({
      manifest: manifest(),
      state: state({
        status: "stale",
        lastSuccessfulRefreshAt: "2026-06-15T23:00:00.000Z",
        nextRefreshAllowedAt: "2026-06-16T00:00:00.000Z"
      }),
      sourceDir: root,
      bundleDir,
      force: true,
      now: new Date("2026-06-16T00:05:00.000Z"),
      crawlRunner: async (options) => {
        crawled = true;
        crawlOutDir = options.outDir;
        expect(options).toMatchObject({
          seedUrl: "https://docs.stripe.com/checkout",
          maxPages: 3,
          maxDepth: 2,
          sameOrigin: true,
          respectRobots: true,
          concurrency: 2,
          allowPrivateNetwork: false,
          dryRun: false,
          timestamp: "2026-06-16T00:05:00.000Z"
        });
        expect(options.outDir).not.toBe(bundleDir);
        await fs.mkdir(options.outDir, { recursive: true });
        await fs.writeFile(path.join(options.outDir, "new.md"), "new bundle\n", "utf8");
        return { pagesFetched: 1, skipped: 0, failed: 0, written: ["new.md"], documents: [] };
      },
      validateBundle: async (dir) => {
        if (dir === bundleDir) {
          return { valid: true, issues: [], conceptCount: 1, reservedFileCount: 1, warningCount: 0 };
        }
        expect(dir).toBe(crawlOutDir);
        return { valid: true, issues: [], conceptCount: 1, reservedFileCount: 1, warningCount: 0 };
      },
      inspectBundle: async (dir) => {
        expect(dir).toBe(crawlOutDir);
        return {
          title: "bundle",
          conceptCount: 1,
          reservedFileCount: 1,
          warningCount: 0,
          typeDistribution: {},
          tagDistribution: {},
          linkCount: 0,
          brokenLinks: 0,
          orphanConcepts: [],
          topLinkedConcepts: [],
          sourceDomains: {}
        };
      },
      hashBundleContent: async (dir) => {
        expect(dir).toBe(crawlOutDir);
        return "sha256:new";
      },
      writeState: async (next) => {
        writes.push(next);
      }
    });

    expect(crawled).toBe(true);
    expect(result).toMatchObject({ status: "fresh", skipped: false });
    await expect(fs.readFile(path.join(bundleDir, "new.md"), "utf8")).resolves.toBe("new bundle\n");
    await expect(fs.access(path.join(bundleDir, "old.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(crawlOutDir)).rejects.toMatchObject({ code: "ENOENT" });
    expect(writes.map((item) => item.status)).toEqual(["refreshing", "fresh"]);
    expect(writes.at(-1)).toMatchObject({
      status: "fresh",
      lastRefreshStartedAt: "2026-06-16T00:05:00.000Z",
      lastRefreshCompletedAt: "2026-06-16T00:05:00.000Z",
      lastSuccessfulRefreshAt: "2026-06-16T00:05:00.000Z",
      nextRefreshAllowedAt: "2026-06-16T00:05:15.000Z",
      refreshInProgress: false,
      lastError: null,
      bundle: { conceptCount: 1, warningCount: 0, valid: true, contentHash: "sha256:new" }
    });
  });

  it("preserves the previous active bundle and records lastError when refresh fails", async () => {
    const root = await tempOut();
    const bundleDir = path.join(root, "bundle");
    await fs.mkdir(bundleDir);
    await fs.writeFile(path.join(bundleDir, "old.md"), "old bundle\n", "utf8");
    const writes: RefreshState[] = [];
    let crawlOutDir = "";

    const result = await refreshSource({
      manifest: manifest(),
      state: state({
        status: "stale",
        lastSuccessfulRefreshAt: "2026-06-15T23:00:00.000Z",
        nextRefreshAllowedAt: "2026-06-16T00:00:00.000Z"
      }),
      sourceDir: root,
      bundleDir,
      force: true,
      now: new Date("2026-06-16T00:10:00.000Z"),
      crawlRunner: async (options) => {
        crawlOutDir = options.outDir;
        await fs.mkdir(options.outDir, { recursive: true });
        await fs.writeFile(path.join(options.outDir, "new.md"), "partial bundle\n", "utf8");
        throw new Error("network offline");
      },
      validateBundle: async (dir) => {
        if (dir === bundleDir) {
          return { valid: true, issues: [], conceptCount: 1, reservedFileCount: 1, warningCount: 0 };
        }
        throw new Error("validator should not run after crawl failure");
      },
      inspectBundle: async () => {
        throw new Error("inspector should not run after crawl failure");
      },
      hashBundleContent: async () => {
        throw new Error("hasher should not run after crawl failure");
      },
      writeState: async (next) => {
        writes.push(next);
      }
    });

    expect(result).toMatchObject({
      status: "failed",
      skipped: false,
      error: {
        message: "network offline",
        sourceName: "stripe",
        seedUrl: "https://docs.stripe.com/checkout",
        occurredAt: "2026-06-16T00:10:00.000Z"
      }
    });
    await expect(fs.readFile(path.join(bundleDir, "old.md"), "utf8")).resolves.toBe("old bundle\n");
    await expect(fs.access(path.join(bundleDir, "new.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.access(crawlOutDir)).rejects.toMatchObject({ code: "ENOENT" });
    expect(writes.map((item) => item.status)).toEqual(["refreshing", "failed"]);
    expect(writes.at(-1)).toMatchObject({
      status: "failed",
      refreshInProgress: false,
      lastRefreshStartedAt: "2026-06-16T00:10:00.000Z",
      lastRefreshCompletedAt: "2026-06-16T00:10:00.000Z",
      lastSuccessfulRefreshAt: "2026-06-15T23:00:00.000Z",
      nextRefreshAllowedAt: "2026-06-16T00:10:15.000Z",
      lastError: {
        message: "network offline",
        sourceName: "stripe",
        seedUrl: "https://docs.stripe.com/checkout",
        occurredAt: "2026-06-16T00:10:00.000Z"
      },
      bundle: { contentHash: "sha256:old" }
    });
  });

  it("uses force to bypass throttling during dry-run without writing bundle or state", async () => {
    const root = await tempOut();
    const bundleDir = path.join(root, "bundle");
    await fs.mkdir(bundleDir);
    await fs.writeFile(path.join(bundleDir, "old.md"), "old bundle\n", "utf8");
    const writes: RefreshState[] = [];

    const result = await refreshSource({
      manifest: manifest(),
      state: state({
        status: "stale",
        lastSuccessfulRefreshAt: "2026-06-15T23:00:00.000Z",
        nextRefreshAllowedAt: "2026-06-16T00:20:00.000Z"
      }),
      sourceDir: root,
      bundleDir,
      force: true,
      dryRun: true,
      now: new Date("2026-06-16T00:15:00.000Z"),
      validateBundle: async (dir) => {
        expect(dir).toBe(bundleDir);
        return { valid: true, issues: [], conceptCount: 1, reservedFileCount: 1, warningCount: 0 };
      },
      crawlRunner: async (options) => {
        expect(options).toMatchObject({
          seedUrl: "https://docs.stripe.com/checkout",
          maxPages: 3,
          maxDepth: 2,
          sameOrigin: true,
          respectRobots: true,
          concurrency: 2,
          allowPrivateNetwork: false,
          dryRun: true,
          timestamp: "2026-06-16T00:15:00.000Z"
        });
        await fs.mkdir(options.outDir, { recursive: true });
        await fs.writeFile(path.join(options.outDir, "would-not-activate.md"), "dry run\n", "utf8");
        return {
          pagesFetched: 1,
          skipped: 0,
          failed: 0,
          written: [],
          documents: [],
          dryRunPages: ["https://docs.stripe.com/checkout"]
        };
      },
      inspectBundle: async () => {
        throw new Error("inspector should not run during dry-run");
      },
      hashBundleContent: async () => {
        throw new Error("hasher should not run during dry-run");
      },
      writeState: async (next) => {
        writes.push(next);
      }
    });

    expect(result).toMatchObject({
      status: "stale",
      skipped: false,
      dryRun: true,
      crawlResult: { dryRunPages: ["https://docs.stripe.com/checkout"] }
    });
    await expect(fs.readFile(path.join(bundleDir, "old.md"), "utf8")).resolves.toBe("old bundle\n");
    await expect(fs.access(path.join(bundleDir, "would-not-activate.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.readdir(root)).resolves.toEqual(["bundle"]);
    expect(writes).toEqual([]);
  });

  it("skips duplicate refreshes when a fresh lockfile exists", async () => {
    const root = await tempOut();
    const bundleDir = path.join(root, "bundle");
    await fs.mkdir(bundleDir);
    await fs.writeFile(path.join(root, ".refresh.lock"), JSON.stringify({ pid: 12345, createdAt: "2026-06-16T00:20:00.000Z" }), "utf8");
    const writes: RefreshState[] = [];

    const result = await refreshSource({
      manifest: manifest(),
      state: state({
        status: "stale",
        lastSuccessfulRefreshAt: "2026-06-15T23:00:00.000Z",
        nextRefreshAllowedAt: "2026-06-16T00:00:00.000Z"
      }),
      sourceDir: root,
      bundleDir,
      force: true,
      staleLockTimeoutMs: 60_000,
      now: new Date("2026-06-16T00:20:30.000Z"),
      validateBundle: async () => ({ valid: true, issues: [], conceptCount: 1, reservedFileCount: 1, warningCount: 0 }),
      crawlRunner: async () => {
        throw new Error("crawler should not run while another refresh holds the lock");
      },
      inspectBundle: async () => {
        throw new Error("inspector should not run while another refresh holds the lock");
      },
      hashBundleContent: async () => {
        throw new Error("hasher should not run while another refresh holds the lock");
      },
      writeState: async (next) => {
        writes.push(next);
      }
    });

    expect(result).toMatchObject({ status: "refreshing", skipped: true, reason: "locked" });
    expect(writes).toEqual([
      expect.objectContaining({
        status: "refreshing",
        lastCheckedAt: "2026-06-16T00:20:30.000Z",
        refreshInProgress: true
      })
    ]);
    await expect(fs.access(path.join(root, ".refresh.lock"))).resolves.toBeUndefined();
  });

  it("clears stale lockfiles and continues the refresh", async () => {
    const root = await tempOut();
    const bundleDir = path.join(root, "bundle");
    await fs.mkdir(bundleDir);
    await fs.writeFile(path.join(bundleDir, "old.md"), "old bundle\n", "utf8");
    await fs.writeFile(path.join(root, ".refresh.lock"), JSON.stringify({ pid: 12345, createdAt: "2026-06-16T00:00:00.000Z" }), "utf8");
    let crawlOutDir = "";

    const result = await refreshSource({
      manifest: manifest(),
      state: state({
        status: "stale",
        lastSuccessfulRefreshAt: "2026-06-15T23:00:00.000Z",
        nextRefreshAllowedAt: "2026-06-16T00:00:00.000Z"
      }),
      sourceDir: root,
      bundleDir,
      force: true,
      staleLockTimeoutMs: 1_000,
      now: new Date("2026-06-16T00:20:30.000Z"),
      crawlRunner: async (options) => {
        crawlOutDir = options.outDir;
        await fs.mkdir(options.outDir, { recursive: true });
        await fs.writeFile(path.join(options.outDir, "new.md"), "new bundle\n", "utf8");
        return { pagesFetched: 1, skipped: 0, failed: 0, written: ["new.md"], documents: [] };
      },
      validateBundle: async (dir) => {
        if (dir === bundleDir) {
          return { valid: true, issues: [], conceptCount: 1, reservedFileCount: 1, warningCount: 0 };
        }
        expect(dir).toBe(crawlOutDir);
        return { valid: true, issues: [], conceptCount: 1, reservedFileCount: 1, warningCount: 0 };
      },
      inspectBundle: async () => ({
        title: "bundle",
        conceptCount: 1,
        reservedFileCount: 1,
        warningCount: 0,
        typeDistribution: {},
        tagDistribution: {},
        linkCount: 0,
        brokenLinks: 0,
        orphanConcepts: [],
        topLinkedConcepts: [],
        sourceDomains: {}
      }),
      hashBundleContent: async () => "sha256:new",
      writeState: async () => {}
    });

    expect(result).toMatchObject({ status: "fresh", skipped: false });
    await expect(fs.readFile(path.join(bundleDir, "new.md"), "utf8")).resolves.toBe("new bundle\n");
    await expect(fs.access(path.join(root, ".refresh.lock"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
