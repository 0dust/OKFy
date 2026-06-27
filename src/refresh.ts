import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { crawlWebsite as defaultCrawlWebsite } from "./crawler.js";
import { hashBundleContents as defaultHashBundleContent } from "./hash.js";
import {
  inspectBundle as defaultInspectBundle,
  validateBundle as defaultValidateBundle
} from "./validate.js";
import { assertSafeForceOutDir } from "./writer.js";
import type { CrawlOptions, CrawlResult } from "./crawler.js";
import type {
  RefreshErrorState,
  RefreshState,
  RefreshStatus,
  SourceManifest
} from "./source-store.js";
import type { BundleStats, ValidationReport } from "./types.js";

export type {
  RefreshErrorState,
  RefreshMode,
  RefreshState,
  RefreshStatus
} from "./source-store.js";

export type RefreshSourceManifest = SourceManifest;

export type RefreshBundleState = {
  conceptCount: number;
  warningCount: number;
  valid: boolean;
  contentHash: string;
};

export type FreshnessReason =
  | "bundle_missing"
  | "bundle_invalid"
  | "latest_refresh_failed"
  | "refresh_in_progress"
  | "never_refreshed"
  | "within_max_age"
  | "exceeded_max_age";

export type FreshnessDecision = {
  status: RefreshStatus;
  reason: FreshnessReason;
  validation?: ValidationReport;
};

export type ValidateBundleFn = (bundleDir: string) => Promise<ValidationReport>;
export type InspectBundleFn = (bundleDir: string) => Promise<BundleStats>;
export type HashBundleContentFn = (bundleDir: string) => Promise<string>;
export type CrawlRunner = (options: CrawlOptions) => Promise<CrawlResult>;

export type RefreshSkipReason = "fresh" | "locked" | "min_interval";

export type RefreshResult = {
  status: RefreshStatus;
  reason?: RefreshSkipReason;
  skipped: boolean;
  dryRun?: boolean;
  state?: RefreshState;
  crawlResult?: CrawlResult;
  error?: RefreshErrorState;
};

export type WriteRefreshStateFn = (state: RefreshState) => Promise<void>;

const DEFAULT_STALE_LOCK_TIMEOUT_MS = 30 * 60 * 1000;

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function secondsBetween(startIso: string, end: Date): number {
  return (end.getTime() - new Date(startIso).getTime()) / 1000;
}

function iso(date: Date): string {
  return date.toISOString();
}

function addSeconds(date: Date, seconds: number): string {
  return new Date(date.getTime() + seconds * 1000).toISOString();
}

function isBeforeNextRefreshAllowed(state: RefreshState | null | undefined, now: Date): boolean {
  if (!state?.nextRefreshAllowedAt) return false;
  return new Date(state.nextRefreshAllowedAt).getTime() > now.getTime();
}

function tempBundleDir(sourceDir: string): string {
  return path.join(sourceDir, `bundle.tmp-${process.pid}-${randomUUID()}`);
}

function lockfilePath(sourceDir: string): string {
  return path.join(sourceDir, ".refresh.lock");
}

async function isLockStale(
  lockPath: string,
  now: Date,
  staleLockTimeoutMs: number
): Promise<boolean> {
  try {
    const raw = await fs.readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw) as { createdAt?: string };
    const createdAt = parsed.createdAt ? Date.parse(parsed.createdAt) : Number.NaN;
    if (Number.isFinite(createdAt)) return now.getTime() - createdAt > staleLockTimeoutMs;
  } catch {
    // Fall back to mtime for malformed lockfiles.
  }
  const stat = await fs.stat(lockPath);
  return now.getTime() - stat.mtimeMs > staleLockTimeoutMs;
}

async function acquireRefreshLock(
  sourceDir: string,
  now: Date,
  staleLockTimeoutMs: number
): Promise<{ acquired: true; release: () => Promise<void> } | { acquired: false }> {
  const lockPath = lockfilePath(sourceDir);
  await fs.mkdir(sourceDir, { recursive: true });
  try {
    const handle = await fs.open(lockPath, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: iso(now) }, null, 2));
    await handle.close();
    return {
      acquired: true,
      release: async () => {
        await fs.rm(lockPath, { force: true });
      }
    };
  } catch (error: any) {
    if (error?.code !== "EEXIST") throw error;
  }

  if (await isLockStale(lockPath, now, staleLockTimeoutMs)) {
    await fs.rm(lockPath, { force: true });
    return acquireRefreshLock(sourceDir, now, staleLockTimeoutMs);
  }

  return { acquired: false };
}

function stateForRefreshStart(
  state: RefreshState | null | undefined,
  freshness: FreshnessDecision,
  startedAt: Date
): RefreshState {
  return {
    schemaVersion: 1,
    status: "refreshing",
    lastCheckedAt: iso(startedAt),
    lastRefreshStartedAt: iso(startedAt),
    lastRefreshCompletedAt: state?.lastRefreshCompletedAt ?? null,
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null,
    refreshInProgress: true,
    lastError: state?.lastError ?? null,
    bundle:
      state?.bundle ??
      (freshness.validation
        ? bundleStateFromValidation(freshness.validation, state?.bundle?.contentHash ?? "")
        : null)
  };
}

function stateForLockedRefresh(
  state: RefreshState | null | undefined,
  checkedAt: Date
): RefreshState {
  return {
    schemaVersion: 1,
    status: "refreshing",
    lastCheckedAt: iso(checkedAt),
    lastRefreshStartedAt: state?.lastRefreshStartedAt ?? null,
    lastRefreshCompletedAt: state?.lastRefreshCompletedAt ?? null,
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null,
    refreshInProgress: true,
    lastError: state?.lastError ?? null,
    bundle: state?.bundle ?? null
  };
}

function stateForCheckedRefresh(
  state: RefreshState | null | undefined,
  status: RefreshStatus,
  checkedAt: Date
): RefreshState {
  return {
    schemaVersion: 1,
    status,
    lastCheckedAt: iso(checkedAt),
    lastRefreshStartedAt: state?.lastRefreshStartedAt ?? null,
    lastRefreshCompletedAt: state?.lastRefreshCompletedAt ?? null,
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null,
    refreshInProgress: false,
    lastError: state?.lastError ?? null,
    bundle: state?.bundle ?? null
  };
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorState(
  manifest: RefreshSourceManifest,
  error: unknown,
  occurredAt: Date
): RefreshErrorState {
  return {
    message: messageFromError(error),
    sourceName: manifest.name,
    seedUrl: manifest.source.seedUrl,
    occurredAt: iso(occurredAt)
  };
}

function stateForRefreshFailure(
  state: RefreshState | null | undefined,
  manifest: RefreshSourceManifest,
  error: unknown,
  startedAt: Date
): RefreshState {
  return {
    schemaVersion: 1,
    status: "failed",
    lastCheckedAt: iso(startedAt),
    lastRefreshStartedAt: iso(startedAt),
    lastRefreshCompletedAt: iso(startedAt),
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: addSeconds(startedAt, manifest.refresh.minIntervalSeconds),
    refreshInProgress: false,
    lastError: errorState(manifest, error, startedAt),
    bundle: state?.bundle ?? null
  };
}

function bundleStateFromValidation(
  validation: ValidationReport,
  contentHash: string
): RefreshBundleState {
  return {
    conceptCount: validation.conceptCount,
    warningCount: validation.warningCount,
    valid: validation.valid,
    contentHash
  };
}

async function replaceActiveBundle(tempDir: string, bundleDir: string): Promise<void> {
  await assertSafeForceOutDir(bundleDir, { outDir: bundleDir, force: true });
  const backupDir = `${bundleDir}.backup-${process.pid}-${randomUUID()}`;
  let movedActiveToBackup = false;
  try {
    await fs.mkdir(path.dirname(bundleDir), { recursive: true });
    if (await pathExists(bundleDir)) {
      await fs.rename(bundleDir, backupDir);
      movedActiveToBackup = true;
    }
    await fs.rename(tempDir, bundleDir);
    if (movedActiveToBackup) await fs.rm(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (movedActiveToBackup && !(await pathExists(bundleDir)) && (await pathExists(backupDir))) {
      await fs.rename(backupDir, bundleDir);
    }
    throw error;
  }
}

export async function evaluateFreshness(options: {
  manifest: RefreshSourceManifest;
  state?: RefreshState | null;
  bundleDir: string;
  now?: Date;
  maxAgeSeconds?: number;
  validateBundle?: ValidateBundleFn;
}): Promise<FreshnessDecision> {
  const now = options.now ?? new Date();
  const validateBundle = options.validateBundle ?? defaultValidateBundle;
  if (!(await pathExists(options.bundleDir))) {
    return { status: "missing", reason: "bundle_missing" };
  }

  if (options.state?.refreshInProgress) {
    return { status: "refreshing", reason: "refresh_in_progress" };
  }
  if (
    (options.state?.status === "failed" || options.state?.lastError) &&
    isBeforeNextRefreshAllowed(options.state, now)
  ) {
    return { status: "failed", reason: "latest_refresh_failed" };
  }

  const validation = await validateBundle(options.bundleDir);
  if (!validation.valid) {
    return { status: "failed", reason: "bundle_invalid", validation };
  }

  if (options.state?.status === "failed" || options.state?.lastError) {
    return {
      status: isBeforeNextRefreshAllowed(options.state, now) ? "failed" : "stale",
      reason: "latest_refresh_failed",
      validation
    };
  }

  const lastSuccessfulRefreshAt = options.state?.lastSuccessfulRefreshAt;
  if (!lastSuccessfulRefreshAt) {
    return { status: "stale", reason: "never_refreshed", validation };
  }

  const maxAgeSeconds = options.maxAgeSeconds ?? options.manifest.refresh.maxAgeSeconds;
  if (secondsBetween(lastSuccessfulRefreshAt, now) > maxAgeSeconds) {
    return { status: "stale", reason: "exceeded_max_age", validation };
  }

  return { status: "fresh", reason: "within_max_age", validation };
}

export async function refreshSource(options: {
  manifest: RefreshSourceManifest;
  state?: RefreshState | null;
  sourceDir: string;
  bundleDir: string;
  now?: Date;
  force?: boolean;
  dryRun?: boolean;
  validateBundle?: ValidateBundleFn;
  inspectBundle?: InspectBundleFn;
  hashBundleContent?: HashBundleContentFn;
  crawlRunner?: CrawlRunner;
  writeState: WriteRefreshStateFn;
  staleLockTimeoutMs?: number;
}): Promise<RefreshResult> {
  const now = options.now ?? new Date();
  const crawlRunner = options.crawlRunner ?? defaultCrawlWebsite;
  const inspectBundle = options.inspectBundle ?? defaultInspectBundle;
  const hashBundleContent = options.hashBundleContent ?? defaultHashBundleContent;
  const freshness = await evaluateFreshness({
    manifest: options.manifest,
    state: options.state,
    bundleDir: options.bundleDir,
    now,
    validateBundle: options.validateBundle
  });

  if (!options.force && freshness.status === "fresh") {
    const nextState = stateForCheckedRefresh(options.state, "fresh", now);
    await options.writeState(nextState);
    return { status: "fresh", reason: "fresh", skipped: true, state: nextState };
  }

  if (!options.force && isBeforeNextRefreshAllowed(options.state, now)) {
    const nextState = stateForCheckedRefresh(options.state, freshness.status, now);
    await options.writeState(nextState);
    return { status: freshness.status, reason: "min_interval", skipped: true, state: nextState };
  }

  const tempDir = tempBundleDir(options.sourceDir);
  if (options.dryRun) {
    try {
      const crawlResult = await crawlRunner({
        ...options.manifest.crawl,
        seedUrl: options.manifest.source.seedUrl,
        outDir: tempDir,
        dryRun: true,
        timestamp: iso(now)
      });
      return { status: freshness.status, skipped: false, dryRun: true, crawlResult };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  const lock = await acquireRefreshLock(
    options.sourceDir,
    now,
    options.staleLockTimeoutMs ?? DEFAULT_STALE_LOCK_TIMEOUT_MS
  );
  if (!lock.acquired) {
    const lockedState = stateForLockedRefresh(options.state, now);
    await options.writeState(lockedState);
    return { status: "refreshing", reason: "locked", skipped: true, state: lockedState };
  }

  const startedState = stateForRefreshStart(options.state, freshness, now);

  try {
    await options.writeState(startedState);
    const crawlResult = await crawlRunner({
      ...options.manifest.crawl,
      seedUrl: options.manifest.source.seedUrl,
      outDir: tempDir,
      force: true,
      dryRun: false,
      timestamp: iso(now)
    });
    const validation = await (options.validateBundle ?? defaultValidateBundle)(tempDir);
    if (!validation.valid) {
      throw new Error(`Refresh generated invalid bundle for ${options.manifest.name}.`);
    }
    const inspection = await inspectBundle(tempDir);
    const contentHash = await hashBundleContent(tempDir);
    await replaceActiveBundle(tempDir, options.bundleDir);

    const nextState: RefreshState = {
      schemaVersion: 1,
      status: "fresh",
      lastCheckedAt: iso(now),
      lastRefreshStartedAt: iso(now),
      lastRefreshCompletedAt: iso(now),
      lastSuccessfulRefreshAt: iso(now),
      nextRefreshAllowedAt: addSeconds(now, options.manifest.refresh.minIntervalSeconds),
      refreshInProgress: false,
      lastError: null,
      bundle: {
        conceptCount: inspection.conceptCount,
        warningCount: inspection.warningCount,
        valid: validation.valid,
        contentHash
      }
    };
    await options.writeState(nextState);

    return { status: "fresh", skipped: false, state: nextState, crawlResult };
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    const failedState = stateForRefreshFailure(options.state, options.manifest, error, now);
    await options.writeState(failedState);
    return {
      status: "failed",
      skipped: false,
      state: failedState,
      error: failedState.lastError ?? undefined
    };
  } finally {
    await lock.release();
  }
}
