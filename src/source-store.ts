import fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Dirent } from "node:fs";
import { resolveOkfyHome as resolveConfiguredOkfyHome, type OkfyHomeOptions } from "./okfy-home.js";
import {
  parseRefreshState,
  parseSourceManifest,
  persistedFieldOrder,
  sourceManifestFallbacks,
  type RefreshErrorStateSchema,
  type RefreshStateSchema,
  type SourceManifestSchema
} from "./source-store-schema.js";

export type SourceKind = "website";
export type RefreshMode = "off" | "stale-while-refresh" | "blocking";
export type RefreshStatus = "missing" | "fresh" | "stale" | "refreshing" | "failed";

export type SourceStoreOptions = OkfyHomeOptions;

// Keep interfaces at the public boundary so existing consumers retain declaration-merging
// compatibility while the schema-derived shapes remain authoritative internally.
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface SourceManifest extends SourceManifestSchema {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RefreshErrorState extends RefreshErrorStateSchema {}
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface RefreshState extends RefreshStateSchema {}

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
  return parseRefreshState(await readJson<unknown>(path.join(sourceDir, "state.json")), name);
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
  return {
    ...sourceManifestFallbacks,
    name
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
  const manifest = parseSourceManifest(value, expectedName);
  validateSourceName(manifest.name);
  return manifest;
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
  const preferredOrder = persistedFieldOrder(value);
  if (preferredOrder) return sortByPreferredOrder(keys, preferredOrder);
  return keys.sort((first, second) => first.localeCompare(second));
}

function sortByPreferredOrder(keys: string[], preferredOrder: readonly string[]): string[] {
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
