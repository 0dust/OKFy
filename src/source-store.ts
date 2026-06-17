import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Dirent } from "node:fs";

export type SourceKind = "website";
export type RefreshMode = "off" | "stale-while-refresh" | "blocking";
export type RefreshStatus = "missing" | "fresh" | "stale" | "refreshing" | "failed";

export interface SourceStoreOptions {
  okfyHome?: string;
  env?: {
    OKFY_HOME?: string;
  };
}

export interface SourceManifest {
  schemaVersion: 1;
  okfyVersion: string;
  name: string;
  kind: SourceKind;
  createdAt: string;
  updatedAt: string;
  source: {
    seedUrl: string;
  };
  crawl: {
    maxPages: number;
    maxDepth: number;
    include: string[];
    exclude: string[];
    sameOrigin: boolean;
    respectRobots: boolean;
    concurrency: number;
    allowPrivateNetwork: boolean;
  };
  refresh: {
    mode: RefreshMode;
    maxAgeSeconds: number;
    minIntervalSeconds: number;
  };
  bundle: {
    dir: string;
  };
}

export interface RefreshState {
  schemaVersion: 1;
  status: RefreshStatus;
  lastCheckedAt: string | null;
  lastRefreshStartedAt: string | null;
  lastRefreshCompletedAt: string | null;
  lastSuccessfulRefreshAt: string | null;
  nextRefreshAllowedAt: string | null;
  refreshInProgress: boolean;
  lastError: { message: string; code?: string } | null;
  bundle: {
    conceptCount: number;
    warningCount: number;
    valid: boolean;
    contentHash: string;
  } | null;
}

export interface SourceRecord {
  name: string;
  dir: string;
  manifest: SourceManifest;
  state?: RefreshState;
  bundleDir: string;
}

const SOURCE_NAME_PATTERN = /^[a-z0-9._-]+$/;

const MANIFEST_KEYS = [
  "schemaVersion",
  "okfyVersion",
  "name",
  "kind",
  "createdAt",
  "updatedAt",
  "source",
  "crawl",
  "refresh",
  "bundle"
];
const CRAWL_KEYS = ["maxPages", "maxDepth", "include", "exclude", "sameOrigin", "respectRobots", "concurrency", "allowPrivateNetwork"];
const REFRESH_KEYS = ["mode", "maxAgeSeconds", "minIntervalSeconds"];
const STATE_KEYS = [
  "schemaVersion",
  "status",
  "lastCheckedAt",
  "lastRefreshStartedAt",
  "lastRefreshCompletedAt",
  "lastSuccessfulRefreshAt",
  "nextRefreshAllowedAt",
  "refreshInProgress",
  "lastError",
  "bundle"
];
const STATE_BUNDLE_KEYS = ["conceptCount", "warningCount", "valid", "contentHash"];

export function resolveOkfyHome(options: SourceStoreOptions = {}): string {
  const configured = options.okfyHome ?? options.env?.OKFY_HOME ?? process.env.OKFY_HOME;
  if (configured && configured.trim() !== "") return path.resolve(configured);
  return path.join(os.homedir(), ".okfy");
}

export function validateSourceName(name: string): string {
  if (!name || name === "." || name === ".." || !SOURCE_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid source name "${name}". Use lowercase letters, numbers, dash, underscore, or dot without path separators.`
    );
  }
  return name;
}

export function resolveSourceDir(name: string, options: SourceStoreOptions = {}): string {
  const safeName = validateSourceName(name);
  const sourcesRoot = resolveSourcesRoot(options);
  const sourceDir = path.resolve(sourcesRoot, safeName);
  if (!isInsideOrEqual(sourcesRoot, sourceDir)) {
    throw new Error(`Invalid source name "${name}". Source directory escapes OKFY_HOME.`);
  }
  return sourceDir;
}

export function resolveBundleDir(manifest: SourceManifest, options: SourceStoreOptions = {}): string {
  const sourceDir = resolveSourceDir(manifest.name, options);
  const bundleDir = manifest.bundle.dir;
  if (!bundleDir || bundleDir.trim() === "") {
    throw new Error(`Invalid bundle directory for source "${manifest.name}".`);
  }
  if (path.isAbsolute(bundleDir)) return path.normalize(bundleDir);

  const resolved = path.resolve(sourceDir, bundleDir);
  if (resolved === sourceDir || !isInsideOrEqual(sourceDir, resolved)) {
    throw new Error(`Invalid bundle directory for source "${manifest.name}". Relative bundle paths must stay inside the source directory.`);
  }
  return resolved;
}

export async function writeSourceManifest(manifest: SourceManifest, options: SourceStoreOptions = {}): Promise<void> {
  const sourceDir = resolveSourceDir(manifest.name, options);
  await writeStableJson(path.join(sourceDir, "source.json"), manifest);
}

export async function readSourceManifest(name: string, options: SourceStoreOptions = {}): Promise<SourceManifest> {
  const sourceDir = resolveSourceDir(name, options);
  const manifest = await readJson<SourceManifest>(path.join(sourceDir, "source.json"));
  if (manifest.name !== name) {
    throw new Error(`Source manifest name mismatch: expected "${name}", found "${manifest.name}".`);
  }
  validateSourceName(manifest.name);
  return manifest;
}

export async function writeRefreshState(name: string, state: RefreshState, options: SourceStoreOptions = {}): Promise<void> {
  const sourceDir = resolveSourceDir(name, options);
  await writeStableJson(path.join(sourceDir, "state.json"), state);
}

export async function readRefreshState(name: string, options: SourceStoreOptions = {}): Promise<RefreshState> {
  const sourceDir = resolveSourceDir(name, options);
  return readJson<RefreshState>(path.join(sourceDir, "state.json"));
}

export async function listSources(options: SourceStoreOptions = {}): Promise<SourceRecord[]> {
  const sourcesRoot = resolveSourcesRoot(options);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(sourcesRoot, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }

  const records: SourceRecord[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const manifest = await readSourceManifest(entry.name, options);
      const state = await readRefreshStateIfExists(entry.name, options);
      records.push({
        name: manifest.name,
        dir: resolveSourceDir(manifest.name, options),
        manifest,
        state,
        bundleDir: resolveBundleDir(manifest, options)
      });
    } catch {
      continue;
    }
  }

  return records.sort((first, second) => first.name.localeCompare(second.name));
}

export async function removeSource(name: string, options: SourceStoreOptions = {}): Promise<void> {
  const sourceDir = resolveSourceDir(name, options);
  await fs.rm(sourceDir, { recursive: true, force: true });
}

function resolveSourcesRoot(options: SourceStoreOptions): string {
  return path.join(resolveOkfyHome(options), "sources");
}

async function readRefreshStateIfExists(name: string, options: SourceStoreOptions): Promise<RefreshState | undefined> {
  try {
    return await readRefreshState(name, options);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function writeStableJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(orderJson(value), null, 2)}\n`, "utf8");
}

function orderJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderJson);
  if (!isPlainObject(value)) return value;

  const ordered: Record<string, unknown> = {};
  for (const key of orderKeys(value)) {
    ordered[key] = orderJson(value[key]);
  }
  return ordered;
}

function orderKeys(value: Record<string, unknown>): string[] {
  if ("status" in value) return sortByPreferredOrder(Object.keys(value), STATE_KEYS);
  if ("okfyVersion" in value) return sortByPreferredOrder(Object.keys(value), MANIFEST_KEYS);
  if (hasKeys(value, CRAWL_KEYS)) return sortByPreferredOrder(Object.keys(value), CRAWL_KEYS);
  if (hasKeys(value, REFRESH_KEYS)) return sortByPreferredOrder(Object.keys(value), REFRESH_KEYS);
  if (hasKeys(value, STATE_BUNDLE_KEYS)) return sortByPreferredOrder(Object.keys(value), STATE_BUNDLE_KEYS);
  if ("seedUrl" in value) return sortByPreferredOrder(Object.keys(value), ["seedUrl"]);
  if ("dir" in value) return sortByPreferredOrder(Object.keys(value), ["dir"]);
  return Object.keys(value).sort((first, second) => first.localeCompare(second));
}

function hasKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => key in value);
}

function sortByPreferredOrder(keys: string[], preferredOrder: string[]): string[] {
  return keys.sort((first, second) => {
    const firstIndex = preferredOrder.indexOf(first);
    const secondIndex = preferredOrder.indexOf(second);
    if (firstIndex === -1 && secondIndex === -1) return first.localeCompare(second);
    if (firstIndex === -1) return 1;
    if (secondIndex === -1) return -1;
    return firstIndex - secondIndex;
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInsideOrEqual(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
