import fs from "node:fs/promises";
import path from "node:path";
import { BundleSearch, type SearchResult } from "./search.js";
import {
  readRefreshState,
  readSourceManifest,
  resolveBundleDir,
  resolveOkfyHome,
  resolveSourceDir,
  validateSourceName,
  type SourceRecord,
  type SourceStoreOptions
} from "./source-store.js";
import type { Concept } from "./types.js";

export interface WorkspaceProfile {
  schemaVersion: 1;
  name: string;
  sources: string[];
}

export interface WorkspaceSourceSelection {
  names?: string[];
  all?: boolean;
  profile?: WorkspaceProfile;
  profileName?: string;
}

export interface WorkspaceSourceSet {
  records: SourceRecord[];
  sourceNames: string[];
  workspaceName?: string;
}

export type WorkspaceSourceRecord = Omit<SourceRecord, "manifest"> & {
  manifest: Omit<SourceRecord["manifest"], "kind"> & {
    kind: SourceRecord["manifest"]["kind"] | "local";
  };
};

export interface WorkspaceSearchSource {
  record: WorkspaceSourceRecord;
  search?: BundleSearch;
  bundleDir?: string;
  loadError?: unknown;
}

export interface WorkspaceSearchResult extends SearchResult {
  sourceName: string;
  sourceKind: string;
  seedUrl: string;
  ref: string;
}

export interface WorkspaceConceptCandidate {
  sourceName: string;
  sourceKind: string;
  seedUrl: string;
  id: string;
  ref: string;
  title?: string;
  type: string;
  resource?: string;
}

export class WorkspaceError extends Error {
  constructor(
    public readonly code:
      | "ambiguous_concept"
      | "duplicate_source"
      | "no_sources"
      | "no_usable_sources"
      | "source_not_in_workspace"
      | "unknown_concept"
      | "unknown_source",
    message: string,
    public readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }

  toJSON(): Record<string, unknown> {
    return {
      code: this.code,
      message: this.message,
      ...this.details
    };
  }
}

export function workspaceProfilePath(name: string, options: SourceStoreOptions = {}): string {
  return path.join(resolveOkfyHome(options), "workspaces", `${validateSourceName(name)}.json`);
}

export async function readWorkspaceProfile(name: string, options: SourceStoreOptions = {}): Promise<WorkspaceProfile> {
  const profile = JSON.parse(await fs.readFile(workspaceProfilePath(name, options), "utf8")) as WorkspaceProfile;
  validateWorkspaceProfile(profile, name);
  return profile;
}

export async function writeWorkspaceProfile(profile: WorkspaceProfile, options: SourceStoreOptions = {}): Promise<void> {
  validateWorkspaceProfile(profile);
  const filePath = workspaceProfilePath(profile.name, options);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
}

export async function resolveWorkspaceSources(
  selection: WorkspaceSourceSelection,
  options: SourceStoreOptions = {}
): Promise<WorkspaceSourceSet> {
  const hasNames = Boolean(selection.names?.length);
  const modeCount = Number(hasNames) + Number(Boolean(selection.all)) + Number(Boolean(selection.profile)) + Number(Boolean(selection.profileName));
  if (modeCount > 1) {
    throw new Error("Choose one workspace source selection: explicit source names, --all, or one workspace profile.");
  }

  let names = selection.names ?? [];
  let workspaceName: string | undefined;
  if (selection.profileName) {
    const profile = await readWorkspaceProfile(selection.profileName, options);
    names = profile.sources;
    workspaceName = profile.name;
  } else if (selection.profile) {
    validateWorkspaceProfile(selection.profile);
    names = selection.profile.sources;
    workspaceName = selection.profile.name;
  }

  if (selection.all) {
    const records = await readAllSourcesFailVisible(options);
    if (!records.length) throw new WorkspaceError("no_sources", "No registered sources found for --all.");
    return { records, sourceNames: records.map((record) => record.name) };
  }

  if (!names.length) throw new WorkspaceError("no_sources", "Select at least one registered source.");
  assertUniqueSourceNames(names);
  const records = await Promise.all(names.map((name) => readSourceRecord(name, options)));
  return { records, sourceNames: records.map((record) => record.name), workspaceName };
}

export class WorkspaceSearch {
  readonly sources: WorkspaceSearchSource[];
  private readonly selectedNames: Set<string>;
  private readonly availableNames: Set<string>;

  constructor(sources: WorkspaceSearchSource[], options: { availableSourceNames?: string[] } = {}) {
    if (!sources.length) throw new WorkspaceError("no_sources", "Workspace contains no sources.");
    assertUniqueSourceNames(sources.map((source) => source.record.name));
    this.sources = [...sources];
    this.selectedNames = new Set(sources.map((source) => source.record.name));
    this.availableNames = new Set([...(options.availableSourceNames ?? []), ...this.selectedNames]);
  }

  static async fromSourceRecords(records: SourceRecord[], options: { availableSourceNames?: string[] } = {}): Promise<WorkspaceSearch> {
    const sources = await Promise.all(
      records.map(async (record) => ({
        record,
        bundleDir: record.bundleDir,
        search: await BundleSearch.fromBundle(record.bundleDir)
      }))
    );
    return new WorkspaceSearch(sources, options);
  }

  search(query: string, options: { source?: string; type?: string; tags?: string[]; limit?: number } = {}): WorkspaceSearchResult[] {
    const limit = options.limit ?? 10;
    const sources = this.usableSources(options.source);
    return sources
      .flatMap((source) =>
        source.search.search(query, { type: options.type, tags: options.tags, limit: Math.max(limit, 50) }).map((result) =>
          this.withSourceResult(source, result)
        )
      )
      .sort((first, second) => second.score - first.score || first.sourceName.localeCompare(second.sourceName) || first.id.localeCompare(second.id))
      .slice(0, limit);
  }

  getConcept(input: { id: string; source?: string }): { source: WorkspaceSearchSource; concept: Concept } {
    const sources = input.source ? this.usableSources(input.source) : this.sourcesWithSearch();
    const matches = sources
      .map((source) => ({ source, concept: source.search.getConcept(input.id) }))
      .filter((row): row is { source: LoadedWorkspaceSource; concept: Concept } => Boolean(row.concept));
    if (matches.length === 0) {
      throw new WorkspaceError("unknown_concept", `No concept found for ${input.id}`, { id: input.id, source: input.source });
    }
    if (!input.source && matches.length > 1) {
      throw new WorkspaceError("ambiguous_concept", `Concept id "${input.id}" exists in multiple workspace sources.`, {
        id: input.id,
        candidates: matches.map(({ source, concept }) => this.conceptCandidate(source, concept))
      });
    }
    return matches[0];
  }

  listTypes(source?: string): Record<string, number> {
    return this.distribution(source, (concept) => [concept.type]);
  }

  listTags(source?: string): Record<string, number> {
    return this.distribution(source, (concept) => concept.tags);
  }

  sourceNames(): string[] {
    return this.sources.map((source) => source.record.name);
  }

  usableSourceNames(): string[] {
    return this.sourcesWithSearch().map((source) => source.record.name);
  }

  private distribution(sourceName: string | undefined, values: (concept: Concept) => string[]): Record<string, number> {
    const distribution: Record<string, number> = {};
    for (const source of this.usableSources(sourceName)) {
      for (const concept of source.search.graph.concepts.values()) {
        for (const value of values(concept)) distribution[value] = (distribution[value] ?? 0) + 1;
      }
    }
    return Object.fromEntries(Object.entries(distribution).sort(([first], [second]) => first.localeCompare(second)));
  }

  private usableSources(sourceName?: string): LoadedWorkspaceSource[] {
    const sources = sourceName ? [this.sourceByName(sourceName)] : this.sources;
    const usable = sources.filter((source): source is LoadedWorkspaceSource => Boolean(source.search));
    if (!usable.length) {
      throw new WorkspaceError("no_usable_sources", "No usable OKF bundle is available in this workspace.", {
        source: sourceName,
        sources: sources.map((source) => source.record.name)
      });
    }
    return usable;
  }

  private sourcesWithSearch(): LoadedWorkspaceSource[] {
    return this.sources.filter((source): source is LoadedWorkspaceSource => Boolean(source.search));
  }

  private sourceByName(sourceName: string): WorkspaceSearchSource {
    if (this.selectedNames.has(sourceName)) {
      return this.sources.find((source) => source.record.name === sourceName)!;
    }
    if (this.availableNames.has(sourceName)) {
      throw new WorkspaceError("source_not_in_workspace", `Source "${sourceName}" is not selected in this workspace.`, {
        source: sourceName,
        workspaceSources: [...this.selectedNames]
      });
    }
    throw new WorkspaceError("unknown_source", `Unknown source "${sourceName}".`, { source: sourceName });
  }

  private withSourceResult(source: WorkspaceSearchSource, result: SearchResult): WorkspaceSearchResult {
    return {
      ...result,
      sourceName: source.record.name,
      sourceKind: source.record.manifest.kind,
      seedUrl: source.record.manifest.source.seedUrl,
      ref: `${source.record.name}:${result.id}`
    };
  }

  private conceptCandidate(source: WorkspaceSearchSource, concept: Concept): WorkspaceConceptCandidate {
    return {
      sourceName: source.record.name,
      sourceKind: source.record.manifest.kind,
      seedUrl: source.record.manifest.source.seedUrl,
      id: concept.id,
      ref: `${source.record.name}:${concept.id}`,
      title: concept.title,
      type: concept.type,
      resource: concept.resource
    };
  }
}

type LoadedWorkspaceSource = WorkspaceSearchSource & { search: BundleSearch };

function validateWorkspaceProfile(profile: WorkspaceProfile, expectedName?: string): void {
  if (profile.schemaVersion !== 1) throw new Error("Workspace profile schemaVersion must be 1.");
  validateSourceName(profile.name);
  if (expectedName && profile.name !== expectedName) {
    throw new Error(`Workspace profile name mismatch: expected "${expectedName}", found "${profile.name}".`);
  }
  if (!Array.isArray(profile.sources) || profile.sources.length === 0) {
    throw new Error(`Workspace profile "${profile.name}" must list at least one source.`);
  }
  for (const source of profile.sources) validateSourceName(source);
  assertUniqueSourceNames(profile.sources);
}

function assertUniqueSourceNames(names: string[]): void {
  const seen = new Set<string>();
  for (const name of names) {
    validateSourceName(name);
    if (seen.has(name)) throw new WorkspaceError("duplicate_source", `Duplicate workspace source "${name}".`, { source: name });
    seen.add(name);
  }
}

async function readSourceRecord(name: string, options: SourceStoreOptions): Promise<SourceRecord> {
  const manifest = await readSourceManifest(name, options);
  return {
    name: manifest.name,
    dir: resolveSourceDir(manifest.name, options),
    manifest,
    state: await readRefreshStateIfExists(manifest.name, options),
    bundleDir: resolveBundleDir(manifest, options)
  };
}

async function readAllSourcesFailVisible(options: SourceStoreOptions): Promise<SourceRecord[]> {
  const sourcesRoot = path.join(resolveOkfyHome(options), "sources");
  let entries: string[];
  try {
    entries = (await fs.readdir(sourcesRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((first, second) => first.localeCompare(second));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }

  return Promise.all(entries.map((name) => readSourceRecord(name, options)));
}

async function readRefreshStateIfExists(name: string, options: SourceStoreOptions): Promise<SourceRecord["state"]> {
  try {
    return await readRefreshState(name, options);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
