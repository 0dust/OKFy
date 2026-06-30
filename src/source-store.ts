import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Dirent } from "node:fs";
import {
  resolveOkfyHome as resolveConfiguredOkfyHome,
  type OkfyHomeOptions
} from "./okfy-home.js";

export type SourceKind = "website";
export type RefreshMode = "off" | "stale-while-refresh" | "blocking";
export type RefreshStatus = "missing" | "fresh" | "stale" | "refreshing" | "failed";

export type SourceStoreOptions = OkfyHomeOptions;

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

export interface RefreshErrorState {
  [key: string]: unknown;
  message: string;
  code?: string;
  sourceName?: string;
  seedUrl?: string;
  occurredAt?: string;
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
  lastError: RefreshErrorState | null;
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
  loadError?: SourceLoadError;
}

export interface SourceLoadError {
  message: string;
  code?: string;
  sourceDirName?: string;
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
const CRAWL_KEYS = [
  "maxPages",
  "maxDepth",
  "include",
  "exclude",
  "sameOrigin",
  "respectRobots",
  "concurrency",
  "allowPrivateNetwork"
];
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
  return resolveConfiguredOkfyHome(options);
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

export function resolveBundleDir(
  manifest: SourceManifest,
  options: SourceStoreOptions = {}
): string {
  const sourceDir = resolveSourceDir(manifest.name, options);
  const bundleDir = manifest.bundle.dir;
  if (!bundleDir || bundleDir.trim() === "") {
    throw new Error(`Invalid bundle directory for source "${manifest.name}".`);
  }
  if (path.isAbsolute(bundleDir)) return path.normalize(bundleDir);

  const resolved = path.resolve(sourceDir, bundleDir);
  if (resolved === sourceDir || !isInsideOrEqual(sourceDir, resolved)) {
    throw new Error(
      `Invalid bundle directory for source "${manifest.name}". Relative bundle paths must stay inside the source directory.`
    );
  }
  return resolved;
}

export async function writeSourceManifest(
  manifest: SourceManifest,
  options: SourceStoreOptions = {}
): Promise<void> {
  const sourceDir = resolveSourceDir(manifest.name, options);
  await writeStableJson(path.join(sourceDir, "source.json"), manifest);
}

export async function readSourceManifest(
  name: string,
  options: SourceStoreOptions = {}
): Promise<SourceManifest> {
  const sourceDir = resolveSourceDir(name, options);
  const manifest = validateSourceManifest(
    await readJson<unknown>(path.join(sourceDir, "source.json")),
    name
  );
  if (manifest.name !== name) {
    throw new Error(`Source manifest name mismatch: expected "${name}", found "${manifest.name}".`);
  }
  return manifest;
}

export async function writeRefreshState(
  name: string,
  state: RefreshState,
  options: SourceStoreOptions = {}
): Promise<void> {
  const sourceDir = resolveSourceDir(name, options);
  await writeStableJson(path.join(sourceDir, "state.json"), state);
}

export async function readRefreshState(
  name: string,
  options: SourceStoreOptions = {}
): Promise<RefreshState> {
  const sourceDir = resolveSourceDir(name, options);
  return validateRefreshState(await readJson<unknown>(path.join(sourceDir, "state.json")), name);
}

export async function readSourceRecord(
  name: string,
  options: SourceStoreOptions = {}
): Promise<SourceRecord> {
  const manifest = await readSourceManifest(name, options);
  return sourceRecordFromManifest(manifest, options);
}

async function sourceRecordFromManifest(
  manifest: SourceManifest,
  options: SourceStoreOptions = {}
): Promise<SourceRecord> {
  const dir = resolveSourceDir(manifest.name, options);
  let state: RefreshState | undefined;
  let loadError: SourceLoadError | undefined;
  try {
    state = await readRefreshStateIfExists(manifest.name, options);
  } catch (error) {
    loadError = errorDetails(error);
  }

  let bundleDir: string;
  try {
    bundleDir = resolveBundleDir(manifest, options);
  } catch (error) {
    bundleDir = path.join(dir, "bundle");
    loadError ??= errorDetails(error);
  }

  return {
    name: manifest.name,
    dir,
    manifest,
    state,
    bundleDir,
    loadError
  };
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
    let manifest: SourceManifest;
    try {
      manifest = await readSourceManifest(entry.name, options);
    } catch (error) {
      records.push(invalidSourceRecord(sourcesRoot, entry.name, error));
      continue;
    }

    records.push(await sourceRecordFromManifest(manifest, options));
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

function invalidSourceRecord(sourcesRoot: string, name: string, error: unknown): SourceRecord {
  const dir = path.join(sourcesRoot, name);
  const sourceName = fallbackSourceName(name);
  return {
    name: sourceName,
    dir,
    manifest: fallbackSourceManifest(sourceName),
    bundleDir: path.join(dir, "bundle"),
    loadError: errorDetails(error, name)
  };
}

function fallbackSourceManifest(name: string): SourceManifest {
  const timestamp = "1970-01-01T00:00:00.000Z";
  return {
    schemaVersion: 1,
    okfyVersion: "unknown",
    name,
    kind: "website",
    createdAt: timestamp,
    updatedAt: timestamp,
    source: {
      seedUrl: ""
    },
    crawl: {
      maxPages: 0,
      maxDepth: 0,
      include: [],
      exclude: [],
      sameOrigin: true,
      respectRobots: true,
      concurrency: 1,
      allowPrivateNetwork: false
    },
    refresh: {
      mode: "off",
      maxAgeSeconds: 0,
      minIntervalSeconds: 0
    },
    bundle: {
      dir: "bundle"
    }
  };
}

function fallbackSourceName(name: string): string {
  try {
    return validateSourceName(name);
  } catch {
    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    return `invalid-${shortHash(name)}${slug ? `-${slug}` : ""}`;
  }
}

function shortHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function errorDetails(error: unknown, sourceDirName?: string): SourceLoadError {
  const withSourceDir = (details: SourceLoadError): SourceLoadError => ({
    ...details,
    ...(sourceDirName && sourceDirName !== fallbackSourceName(sourceDirName)
      ? { sourceDirName }
      : {})
  });
  if (error instanceof Error) {
    const details: SourceLoadError = { message: error.message };
    if (isNodeError(error) && error.code) details.code = error.code;
    return withSourceDir(details);
  }
  return withSourceDir({ message: String(error) });
}

function validateSourceManifest(value: unknown, expectedName: string): SourceManifest {
  if (!isPlainObject(value))
    throw new Error(`Invalid source manifest for "${expectedName}": expected object.`);

  const name = requiredString(value, "name", expectedName);
  validateSourceName(name);
  if (value.schemaVersion !== 1) {
    throw new Error(`Invalid source manifest for "${expectedName}": schemaVersion must be 1.`);
  }
  if (value.kind !== "website") {
    throw new Error(`Invalid source manifest for "${expectedName}": kind must be "website".`);
  }

  const source = requiredObject(value, "source", expectedName);
  const crawl = requiredObject(value, "crawl", expectedName);
  const refresh = requiredObject(value, "refresh", expectedName);
  const bundle = requiredObject(value, "bundle", expectedName);
  const mode = requiredString(refresh, "mode", expectedName, "refresh");
  if (!["off", "stale-while-refresh", "blocking"].includes(mode)) {
    throw new Error(`Invalid source manifest for "${expectedName}": refresh.mode is invalid.`);
  }

  return {
    schemaVersion: 1,
    okfyVersion: requiredString(value, "okfyVersion", expectedName),
    name,
    kind: "website",
    createdAt: requiredString(value, "createdAt", expectedName),
    updatedAt: requiredString(value, "updatedAt", expectedName),
    source: {
      seedUrl: requiredString(source, "seedUrl", expectedName, "source")
    },
    crawl: {
      maxPages: requiredNumber(crawl, "maxPages", expectedName, "crawl"),
      maxDepth: requiredNumber(crawl, "maxDepth", expectedName, "crawl"),
      include: requiredStringArray(crawl, "include", expectedName, "crawl"),
      exclude: requiredStringArray(crawl, "exclude", expectedName, "crawl"),
      sameOrigin: requiredBoolean(crawl, "sameOrigin", expectedName, "crawl"),
      respectRobots: requiredBoolean(crawl, "respectRobots", expectedName, "crawl"),
      concurrency: requiredNumber(crawl, "concurrency", expectedName, "crawl"),
      allowPrivateNetwork: requiredBoolean(crawl, "allowPrivateNetwork", expectedName, "crawl")
    },
    refresh: {
      mode: mode as RefreshMode,
      maxAgeSeconds: requiredNumber(refresh, "maxAgeSeconds", expectedName, "refresh"),
      minIntervalSeconds: requiredNumber(refresh, "minIntervalSeconds", expectedName, "refresh")
    },
    bundle: {
      dir: requiredString(bundle, "dir", expectedName, "bundle")
    }
  };
}

function validateRefreshState(value: unknown, sourceName: string): RefreshState {
  if (!isPlainObject(value))
    throw new Error(`Invalid refresh state for "${sourceName}": expected object.`);
  if (value.schemaVersion !== 1) {
    throw new Error(`Invalid refresh state for "${sourceName}": schemaVersion must be 1.`);
  }
  const status = stateString(value, "status", sourceName);
  if (!["missing", "fresh", "stale", "refreshing", "failed"].includes(status)) {
    throw new Error(`Invalid refresh state for "${sourceName}": status is invalid.`);
  }
  return {
    schemaVersion: 1,
    status: status as RefreshStatus,
    lastCheckedAt: stateNullableString(value, "lastCheckedAt", sourceName),
    lastRefreshStartedAt: stateNullableString(value, "lastRefreshStartedAt", sourceName),
    lastRefreshCompletedAt: stateNullableString(value, "lastRefreshCompletedAt", sourceName),
    lastSuccessfulRefreshAt: stateNullableString(value, "lastSuccessfulRefreshAt", sourceName),
    nextRefreshAllowedAt: stateNullableString(value, "nextRefreshAllowedAt", sourceName),
    refreshInProgress: stateBoolean(value, "refreshInProgress", sourceName),
    lastError: validateRefreshError(value.lastError, sourceName),
    bundle: validateRefreshBundle(value.bundle, sourceName)
  };
}

function validateRefreshError(value: unknown, sourceName: string): RefreshErrorState | null {
  if (value === null) return null;
  if (!isPlainObject(value))
    throw new Error(`Invalid refresh state for "${sourceName}": lastError must be object or null.`);
  const details: RefreshErrorState = {
    ...value,
    message: stateString(value, "message", sourceName, "lastError")
  };
  for (const key of ["code", "sourceName", "seedUrl", "occurredAt"]) {
    const found = value[key];
    if (found !== undefined && typeof found !== "string") {
      throw invalidStateField(sourceName, key, "string", "lastError");
    }
  }
  return details;
}

function validateRefreshBundle(value: unknown, sourceName: string): RefreshState["bundle"] {
  if (value === null) return null;
  if (!isPlainObject(value))
    throw new Error(`Invalid refresh state for "${sourceName}": bundle must be object or null.`);
  return {
    conceptCount: stateNumber(value, "conceptCount", sourceName, "bundle"),
    warningCount: stateNumber(value, "warningCount", sourceName, "bundle"),
    valid: stateBoolean(value, "valid", sourceName, "bundle"),
    contentHash: stateString(value, "contentHash", sourceName, "bundle")
  };
}

function requiredObject(
  value: Record<string, unknown>,
  key: string,
  sourceName: string,
  prefix?: string
): Record<string, unknown> {
  const found = value[key];
  if (!isPlainObject(found)) throw invalidManifestField(sourceName, key, "object", prefix);
  return found;
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  sourceName: string,
  prefix?: string
): string {
  const found = value[key];
  if (typeof found !== "string" || found.trim() === "") {
    throw invalidManifestField(sourceName, key, "non-empty string", prefix);
  }
  return found;
}

function requiredNumber(
  value: Record<string, unknown>,
  key: string,
  sourceName: string,
  prefix?: string
): number {
  const found = value[key];
  if (typeof found !== "number" || !Number.isFinite(found)) {
    throw invalidManifestField(sourceName, key, "number", prefix);
  }
  return found;
}

function requiredBoolean(
  value: Record<string, unknown>,
  key: string,
  sourceName: string,
  prefix?: string
): boolean {
  const found = value[key];
  if (typeof found !== "boolean") throw invalidManifestField(sourceName, key, "boolean", prefix);
  return found;
}

function requiredStringArray(
  value: Record<string, unknown>,
  key: string,
  sourceName: string,
  prefix?: string
): string[] {
  const found = value[key];
  if (!Array.isArray(found) || !found.every((item) => typeof item === "string")) {
    throw invalidManifestField(sourceName, key, "string array", prefix);
  }
  return found;
}

function invalidManifestField(
  sourceName: string,
  key: string,
  expected: string,
  prefix?: string
): Error {
  return new Error(
    `Invalid source manifest for "${sourceName}": ${prefix ? `${prefix}.` : ""}${key} must be ${expected}.`
  );
}

function stateString(
  value: Record<string, unknown>,
  key: string,
  sourceName: string,
  prefix?: string
): string {
  const found = value[key];
  if (typeof found !== "string" || found.trim() === "") {
    throw invalidStateField(sourceName, key, "non-empty string", prefix);
  }
  return found;
}

function stateNullableString(
  value: Record<string, unknown>,
  key: string,
  sourceName: string
): string | null {
  const found = value[key];
  if (found === null) return null;
  if (typeof found !== "string" || found.trim() === "") {
    throw invalidStateField(sourceName, key, "string or null");
  }
  return found;
}

function stateNumber(
  value: Record<string, unknown>,
  key: string,
  sourceName: string,
  prefix?: string
): number {
  const found = value[key];
  if (typeof found !== "number" || !Number.isFinite(found)) {
    throw invalidStateField(sourceName, key, "number", prefix);
  }
  return found;
}

function stateBoolean(
  value: Record<string, unknown>,
  key: string,
  sourceName: string,
  prefix?: string
): boolean {
  const found = value[key];
  if (typeof found !== "boolean") throw invalidStateField(sourceName, key, "boolean", prefix);
  return found;
}

function invalidStateField(
  sourceName: string,
  key: string,
  expected: string,
  prefix?: string
): Error {
  return new Error(
    `Invalid refresh state for "${sourceName}": ${prefix ? `${prefix}.` : ""}${key} must be ${expected}.`
  );
}

async function readRefreshStateIfExists(
  name: string,
  options: SourceStoreOptions
): Promise<RefreshState | undefined> {
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
  const dir = path.dirname(filePath);
  const tempPath = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  );
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.writeFile(tempPath, `${JSON.stringify(orderJson(value), null, 2)}\n`, "utf8");
    await fs.rename(tempPath, filePath);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
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
  const keys = Object.keys(value);
  if ("status" in value) return sortByPreferredOrder(keys, STATE_KEYS);
  if ("okfyVersion" in value) return sortByPreferredOrder(keys, MANIFEST_KEYS);
  if (hasKeys(value, CRAWL_KEYS)) return sortByPreferredOrder(keys, CRAWL_KEYS);
  if (hasKeys(value, REFRESH_KEYS)) return sortByPreferredOrder(keys, REFRESH_KEYS);
  if (hasKeys(value, STATE_BUNDLE_KEYS)) return sortByPreferredOrder(keys, STATE_BUNDLE_KEYS);
  if ("seedUrl" in value) return sortByPreferredOrder(keys, ["seedUrl"]);
  if ("dir" in value) return sortByPreferredOrder(keys, ["dir"]);
  return keys.sort((first, second) => first.localeCompare(second));
}

function hasKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.some((key) => key in value);
}

function sortByPreferredOrder(keys: string[], preferredOrder: string[]): string[] {
  const preferredIndexes = new Map(preferredOrder.map((key, index) => [key, index]));
  return keys.sort((first, second) => {
    const firstIndex = preferredIndexes.get(first);
    const secondIndex = preferredIndexes.get(second);
    if (firstIndex === undefined && secondIndex === undefined) return first.localeCompare(second);
    if (firstIndex === undefined) return 1;
    if (secondIndex === undefined) return -1;
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
