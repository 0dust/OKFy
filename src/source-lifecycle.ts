import fs from "node:fs";
import path from "node:path";
import { crawlWebsite, type CrawlProgressEvent } from "./crawler.js";
import { hashBundleContents } from "./hash.js";
import { packageVersion } from "./metadata.js";
import type { FreshnessState, RefreshHooks } from "./mcp-source-runtime.js";
import { evaluateFreshness, refreshSource } from "./refresh.js";
import {
  readRefreshState,
  readSourceManifest,
  readSourceRecord,
  resolveBundleDir,
  resolveSourceDir,
  validateSourceName,
  writeRefreshState,
  writeSourceManifest,
  type RefreshState,
  type SourceManifest,
  type SourceRecord
} from "./source-store.js";
import { inspectBundle } from "./validate.js";

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.promises.access(target);
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function manifestFromOptions(name: string, seedUrl: string, options: any): SourceManifest {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    okfyVersion: packageVersion(),
    name: validateSourceName(name),
    kind: "website",
    createdAt: now,
    updatedAt: now,
    source: {
      seedUrl: new URL(seedUrl).toString()
    },
    crawl: {
      maxPages: options.maxPages,
      maxDepth: options.maxDepth,
      include: options.include ?? [],
      exclude: options.exclude ?? [],
      sameOrigin: options.sameOrigin,
      respectRobots: options.respectRobots,
      concurrency: options.concurrency,
      allowPrivateNetwork: Boolean(options.allowPrivateNetwork)
    },
    refresh: {
      mode: options.refreshMode,
      maxAgeSeconds: options.maxAge,
      minIntervalSeconds: options.minRefreshInterval
    },
    bundle: {
      dir: options.out ? path.resolve(options.out) : "bundle"
    }
  };
}

type SourceLifecycleHooks = {
  onProgress?: (event: CrawlProgressEvent) => void;
};

export async function registerWebsiteSource(
  name: string,
  url: string,
  options: any,
  hooks: SourceLifecycleHooks = {}
) {
  const manifest = manifestFromOptions(name, url, options);
  const sourceDir = resolveSourceDir(manifest.name);
  if ((await pathExists(sourceDir)) && !options.force) {
    throw new Error(`Source "${manifest.name}" already exists. Use --force to overwrite it.`);
  }

  let backupDir: string | undefined;
  if (options.force && (await pathExists(sourceDir))) {
    backupDir = `${sourceDir}.backup-${process.pid}-${Date.now()}`;
    await fs.promises.rename(sourceDir, backupDir);
  }

  try {
    await writeSourceManifest(manifest);
    const result = await runSourceRefresh(manifest, {
      force: true,
      onProgress: hooks.onProgress
    });
    if (result.status === "fresh") {
      if (backupDir) await fs.promises.rm(backupDir, { recursive: true, force: true });
      return { manifest, result };
    }
    if (backupDir) {
      await restoreSourceBackup(sourceDir, backupDir);
      throw new Error(result.error?.message ?? `Refresh failed for source "${manifest.name}".`);
    }
    return { manifest, result };
  } catch (error) {
    if (backupDir) await restoreSourceBackup(sourceDir, backupDir);
    throw error;
  }
}

async function restoreSourceBackup(sourceDir: string, backupDir: string): Promise<void> {
  await fs.promises.rm(sourceDir, { recursive: true, force: true });
  if (await pathExists(backupDir)) await fs.promises.rename(backupDir, sourceDir);
}

export async function runSourceRefresh(
  manifest: SourceManifest,
  options: { force?: boolean; dryRun?: boolean; onProgress?: (event: CrawlProgressEvent) => void } = {}
) {
  const state = await readStateIfReadable(manifest.name);
  const sourceDir = resolveSourceDir(manifest.name);
  const bundleDir = resolveBundleDir(manifest);
  return refreshSource({
    manifest,
    state,
    sourceDir,
    bundleDir,
    force: options.force,
    dryRun: options.dryRun,
    inspectBundle,
    hashBundleContent: hashBundleContents,
    crawlRunner: (crawlOptions) => crawlWebsite({ ...crawlOptions, onProgress: options.onProgress }),
    writeState: (next) => writeRefreshState(manifest.name, next)
  });
}

export async function registeredRecord(name: string): Promise<SourceRecord> {
  return readSourceRecord(name);
}

export async function readStateIfExists(name: string): Promise<RefreshState | undefined> {
  try {
    return await readRefreshState(name);
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readStateIfReadable(name: string): Promise<RefreshState | undefined> {
  try {
    return await readStateIfExists(name);
  } catch {
    return undefined;
  }
}

function emptyState(status: RefreshState["status"], checkedAt: string): RefreshState {
  return {
    schemaVersion: 1,
    status,
    lastCheckedAt: checkedAt,
    lastRefreshStartedAt: null,
    lastRefreshCompletedAt: null,
    lastSuccessfulRefreshAt: null,
    nextRefreshAllowedAt: null,
    refreshInProgress: false,
    lastError: null,
    bundle: null
  };
}

export async function summarizeState(
  record: SourceRecord,
  maxAgeSeconds?: number
): Promise<RefreshState> {
  const state = record.state;
  const now = new Date();
  const decision = await evaluateFreshness({
    manifest: record.manifest,
    state,
    bundleDir: record.bundleDir,
    now,
    maxAgeSeconds
  });
  return {
    schemaVersion: 1,
    status: decision.status,
    lastCheckedAt: now.toISOString(),
    lastRefreshStartedAt: state?.lastRefreshStartedAt ?? null,
    lastRefreshCompletedAt: state?.lastRefreshCompletedAt ?? null,
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null,
    refreshInProgress: decision.status === "refreshing",
    lastError: state?.lastError ?? null,
    bundle: decision.validation
      ? {
          conceptCount: decision.validation.conceptCount,
          warningCount: decision.validation.warningCount,
          valid: decision.validation.valid,
          contentHash: await hashBundleContents(record.bundleDir)
        }
      : decision.status === "missing"
        ? null
        : (state?.bundle ?? null)
  };
}

export function sourceRow(
  record: SourceRecord,
  state: RefreshState | undefined
): Record<string, unknown> {
  const loadError = record.loadError ?? null;
  return {
    name: record.name,
    kind: record.manifest.kind,
    seedUrl: record.manifest.source.seedUrl,
    status: loadError ? "failed" : (state?.status ?? "missing"),
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    conceptCount: state?.bundle?.conceptCount ?? null,
    warningCount: state?.bundle?.warningCount ?? null,
    valid: loadError ? false : (state?.bundle?.valid ?? false),
    lastError: loadError ?? state?.lastError ?? null,
    refreshInProgress: state?.refreshInProgress ?? false,
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null,
    bundlePath: record.bundleDir
  };
}

function freshnessFromStoredState(
  state: RefreshState,
  loadError?: SourceRecord["loadError"]
): FreshnessState {
  return {
    status: state.status,
    lastSuccessfulRefreshAt: state.lastSuccessfulRefreshAt,
    refreshInProgress: state.refreshInProgress,
    lastRefreshError: loadError ? { ...loadError } : state.lastError,
    nextRefreshAllowedAt: state.nextRefreshAllowedAt
  };
}

export function mcpRefreshHooksForRecord(
  record: SourceRecord,
  mode: SourceManifest["refresh"]["mode"],
  maxAgeSeconds?: number
): RefreshHooks {
  return {
    mode,
    getFreshness: async () => {
      const latest = await registeredRecord(record.name);
      const nextState = await summarizeState(latest, maxAgeSeconds);
      if (!latest.loadError) await writeRefreshState(record.name, nextState);
      return freshnessFromStoredState(nextState, latest.loadError);
    },
    refreshIfNeeded: async () => {
      const latestManifest = await readSourceManifest(record.name);
      const result = await runSourceRefresh(latestManifest, { force: false });
      const bundleDir = resolveBundleDir(latestManifest);
      return {
        bundleDir,
        freshness:
          result.state ??
          (await readStateIfReadable(record.name)) ??
          emptyState(result.status, new Date().toISOString())
      };
    }
  };
}
