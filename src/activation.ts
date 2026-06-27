import fs from "node:fs/promises";
import path from "node:path";
import { BundleSearch, type SearchResult } from "./search.js";
import {
  codexMcpServerName,
  defaultOkfyHome,
  firstAgentPrompt,
  mcpServerName,
  renderMcpClientArtifacts,
  serveCommand,
  type ServeCommand,
  type ServeCommandTarget,
  type SetupArtifact,
  type SetupClient
} from "./setup.js";
import type { Concept } from "./types.js";
import { assertSafeForceOutDir } from "./writer.js";
import { isRegisteredWorkspaceRecord, type WorkspaceSourceRecord } from "./workspace.js";
import type { InspectorReport } from "./inspector.js";

export interface ActivationPacketFile {
  label: "Inspector HTML" | "Setup Markdown" | "Proof JSON";
  fileName: "okfy-inspector.html" | "okfy-setup.md" | "okfy-proof.json";
  path: string;
}

export interface ActivationSetup {
  client: SetupClient;
  serverName: string;
  codexServerName: string;
  command: ServeCommand;
  artifacts: SetupArtifact[];
  firstPrompt: string;
}

export interface ActivationProofSearchResult {
  sourceName?: string;
  id: string;
  ref: string;
  title?: string;
  type: string;
  resource?: string;
  snippet: string;
  score: number;
}

export interface ActivationProof {
  schemaVersion: 1;
  generatedBy: "okfy";
  generatedAt: string;
  target: InspectorReport["target"];
  summary: {
    tool: "bundle_summary";
    result: {
      title: string;
      readiness: InspectorReport["readiness"];
      sources: InspectorReport["sources"];
    };
  };
  search: {
    tool: "search_concepts";
    input: {
      query: string;
      limit: number;
      source?: string;
    };
    results: ActivationProofSearchResult[];
  };
  read: {
    tool: "read_concept";
    input: {
      id: string;
      source?: string;
      max_chars: number;
    };
    result: {
      id: string;
      ref: string;
      title?: string;
      type: string;
      resource?: string;
      bodyPreview: string;
      citation: {
        ref: string;
        sourceResource?: string;
        sourceName?: string;
      };
    };
  } | null;
  neighbors: {
    tool: "get_neighbors";
    input: {
      id: string;
      source?: string;
      depth: 1;
    };
    result: {
      outbound: string[];
      backlinks: string[];
    };
  } | null;
}

export interface ActivationPacket {
  schemaVersion: 1;
  generatedBy: "okfy";
  outDir: string;
  protectedInputPaths?: string[];
  setup: ActivationSetup;
  proof: ActivationProof;
  files: ActivationPacketFile[];
}

export interface BuildActivationPacketOptions {
  records: WorkspaceSourceRecord[];
  report: InspectorReport;
  client: SetupClient;
  outDir: string;
  commandTarget: ServeCommandTarget;
  proofTask?: string;
  protectedInputPaths?: string[];
  serverIdentity?: string[];
  autoRefresh?: boolean;
  okfyHome?: string;
  generatedAt?: string;
}

type LoadedSource = {
  record: WorkspaceSourceRecord;
  search: BundleSearch;
};

type ProofConcept = {
  record: WorkspaceSourceRecord;
  search: BundleSearch;
  concept: Concept;
  ref: string;
};

const PACKET_FILES: Array<Pick<ActivationPacketFile, "label" | "fileName">> = [
  { label: "Inspector HTML", fileName: "okfy-inspector.html" },
  { label: "Setup Markdown", fileName: "okfy-setup.md" },
  { label: "Proof JSON", fileName: "okfy-proof.json" }
];

export async function buildActivationPacket(
  options: BuildActivationPacketOptions
): Promise<ActivationPacket> {
  const outDir = path.resolve(options.outDir);
  const protectedInputPaths = uniqueResolvedPaths(
    options.protectedInputPaths ?? protectedActivationInputPaths(options.records)
  );
  const files = PACKET_FILES.map((file) => ({ ...file, path: path.join(outDir, file.fileName) }));
  const usesRegistered =
    options.records.some(isRegisteredWorkspaceRecord) || isAllTarget(options.commandTarget);
  const okfyHome = usesRegistered
    ? (options.okfyHome ?? process.env.OKFY_HOME ?? defaultOkfyHome())
    : defaultOkfyHome();
  const serverIdentity = options.serverIdentity ?? options.records.map((record) => record.name);
  const serverName = mcpServerName(serverIdentity);
  const codexServerName = codexMcpServerName(serverIdentity);
  const command = serveCommand(options.commandTarget, okfyHome, defaultOkfyHome(), {
    autoRefresh: options.autoRefresh ?? usesRegistered
  });
  const artifacts = renderMcpClientArtifacts({
    client: options.client,
    serverName,
    codexServerName,
    command
  });
  const workspace = options.report.target.kind !== "bundle";
  const firstPrompt = firstAgentPrompt(options.client === "codex" ? codexServerName : serverName, {
    workspace
  });
  const setup = {
    client: options.client,
    serverName,
    codexServerName,
    command,
    artifacts,
    firstPrompt
  };
  const proof = await buildActivationProof({
    records: options.records,
    report: options.report,
    proofTask: options.proofTask,
    generatedAt: options.generatedAt ?? new Date().toISOString()
  });
  return {
    schemaVersion: 1,
    generatedBy: "okfy",
    outDir,
    protectedInputPaths,
    setup,
    proof,
    files
  };
}

export function withActivationMetadata(
  report: InspectorReport,
  packet: ActivationPacket
): InspectorReport {
  return {
    ...report,
    activation: {
      client: packet.setup.client,
      serverName: packet.setup.serverName,
      codexServerName: packet.setup.codexServerName,
      command: {
        display: packet.setup.command.display,
        env: packet.setup.command.env
      },
      firstPrompt: packet.setup.firstPrompt,
      artifacts: packet.setup.artifacts.map((artifact) => ({
        label: artifact.label,
        format: artifact.format,
        body: artifact.body
      })),
      files: packet.files.map((file) => ({ label: file.label, path: file.path }))
    }
  };
}

export function renderActivationSetupMarkdown(packet: ActivationPacket): string {
  const lines = [
    "# OKFY Activation Packet",
    "",
    `Status: ${packet.proof.summary.result.readiness.validationStatus}`,
    `Client: ${packet.setup.client}`,
    `Server: ${packet.setup.serverName}`,
    "",
    "## MCP Launch Command",
    "",
    "```bash",
    packet.setup.command.display,
    "```",
    ""
  ];
  if (Object.keys(packet.setup.command.env).length) {
    lines.push("Environment:", "");
    lines.push("```json", JSON.stringify(packet.setup.command.env, null, 2), "```", "");
  }
  lines.push("## Client Setup", "");
  for (const artifact of packet.setup.artifacts) {
    lines.push(`### ${artifact.label}`, "", codeFence(artifact.format), artifact.body, "```", "");
  }
  lines.push(
    "## First Prompt",
    "",
    "```text",
    packet.setup.firstPrompt,
    "```",
    "",
    "## Proof",
    "",
    `Query: ${packet.proof.search.input.query}`,
    `Search results: ${packet.proof.search.results.length}`,
    `Read concept: ${packet.proof.read?.result.ref ?? "none"}`,
    `Citation: ${packet.proof.read?.result.citation.sourceResource ?? "none"}`,
    "",
    "## Packet Files",
    ""
  );
  for (const file of packet.files) lines.push(`- ${file.label}: \`${file.path}\``);
  return `${lines.join("\n").trimEnd()}\n`;
}

export async function writeActivationPacketFiles(
  packet: ActivationPacket,
  contents: {
    inspectorHtml: string;
    setupMarkdown: string;
  },
  options: { force?: boolean; protectedInputPaths?: string[] } = {}
): Promise<void> {
  await ensureActivationOutDir(packet.outDir, {
    force: Boolean(options.force),
    protectedInputPaths: options.protectedInputPaths ?? packet.protectedInputPaths
  });
  await Promise.all([
    writeFileAtomically(packet.files[0]!.path, contents.inspectorHtml),
    writeFileAtomically(packet.files[1]!.path, contents.setupMarkdown),
    writeFileAtomically(packet.files[2]!.path, `${JSON.stringify(packet.proof, null, 2)}\n`)
  ]);
}

async function buildActivationProof(options: {
  records: WorkspaceSourceRecord[];
  report: InspectorReport;
  proofTask?: string;
  generatedAt: string;
}): Promise<ActivationProof> {
  const loaded = await loadSources(options.records);
  const primary = firstReadableConcept(loaded, options.report);
  const taskQuery = normalizeProofTask(options.proofTask);
  const query = taskQuery ?? (primary ? queryForConcept(primary.concept) : "documentation");
  const searchSource = sourceScopedProofSearch(loaded, options.report);
  const searchResults = loaded.length
    ? searchProofResults(loaded, query, options.report, searchSource)
    : [];
  const searchedTarget = conceptForSearchResult(loaded, searchResults[0], options.report);
  const readTarget = searchedTarget ?? (taskQuery ? undefined : primary);
  return {
    schemaVersion: 1,
    generatedBy: "okfy",
    generatedAt: options.generatedAt,
    target: options.report.target,
    summary: {
      tool: "bundle_summary",
      result: {
        title: options.report.title,
        readiness: options.report.readiness,
        sources: options.report.sources
      }
    },
    search: {
      tool: "search_concepts",
      input: {
        query,
        limit: 5,
        ...(searchSource ? { source: searchSource } : {})
      },
      results: searchResults
    },
    read: readTarget ? readProof(readTarget, options.report) : null,
    neighbors: readTarget ? neighborProof(readTarget, options.report) : null
  };
}

async function loadSources(records: WorkspaceSourceRecord[]): Promise<LoadedSource[]> {
  const loaded: LoadedSource[] = [];
  for (const record of records) {
    if (record.loadError) continue;
    try {
      loaded.push({ record, search: await BundleSearch.fromBundle(record.bundleDir) });
    } catch {
      // The Inspector report already carries unavailable-source diagnostics.
      // Activation should still write setup and diagnostic proof artifacts.
    }
  }
  return loaded;
}

function firstReadableConcept(
  loaded: LoadedSource[],
  report: InspectorReport
): ProofConcept | undefined {
  for (const source of loaded) {
    const concept = [...source.search.graph.concepts.values()].sort((first, second) =>
      first.id.localeCompare(second.id)
    )[0];
    if (concept) return proofConcept(source, concept, report);
  }
  return undefined;
}

function searchProofResults(
  loaded: LoadedSource[],
  query: string,
  report: InspectorReport,
  sourceName?: string
): ActivationProofSearchResult[] {
  const searchable = sourceName
    ? loaded.filter((source) => source.record.name === sourceName)
    : loaded;
  return searchable
    .flatMap((source) =>
      source.search
        .search(query, { limit: 5 })
        .map((result) => proofSearchResult(source, result, report))
    )
    .sort(
      (first, second) =>
        second.score - first.score ||
        (first.sourceName ?? "").localeCompare(second.sourceName ?? "") ||
        first.id.localeCompare(second.id)
    )
    .slice(0, 5);
}

function sourceScopedProofSearch(
  loaded: LoadedSource[],
  report: InspectorReport
): string | undefined {
  if (report.target.kind === "bundle") return undefined;
  return loaded.length === 1 ? loaded[0]!.record.name : undefined;
}

function conceptForSearchResult(
  loaded: LoadedSource[],
  result: ActivationProofSearchResult | undefined,
  report: InspectorReport
): ProofConcept | undefined {
  if (!result) return undefined;
  const source = result.sourceName
    ? loaded.find((candidate) => candidate.record.name === result.sourceName)
    : loaded[0];
  const concept = source?.search.getConcept(result.id);
  return source && concept ? proofConcept(source, concept, report) : undefined;
}

function readProof(
  target: ProofConcept,
  report: InspectorReport
): NonNullable<ActivationProof["read"]> {
  return {
    tool: "read_concept",
    input: {
      id: target.concept.id,
      ...(report.target.kind !== "bundle" ? { source: target.record.name } : {}),
      max_chars: 4000
    },
    result: {
      id: target.concept.id,
      ref: target.ref,
      title: target.concept.title,
      type: target.concept.type,
      resource: target.concept.resource,
      bodyPreview: target.concept.body.replace(/\s+/g, " ").trim().slice(0, 500),
      citation: {
        ref: target.ref,
        sourceResource: target.concept.resource,
        ...(report.target.kind !== "bundle" ? { sourceName: target.record.name } : {})
      }
    }
  };
}

function neighborProof(
  target: ProofConcept,
  report: InspectorReport
): NonNullable<ActivationProof["neighbors"]> {
  return {
    tool: "get_neighbors",
    input: {
      id: target.concept.id,
      ...(report.target.kind !== "bundle" ? { source: target.record.name } : {}),
      depth: 1
    },
    result: {
      outbound: (target.search.graph.outbound.get(target.concept.id) ?? [])
        .map((id) => refFor(target.record, id, report))
        .sort(),
      backlinks: (target.search.graph.backlinks.get(target.concept.id) ?? [])
        .map((id) => refFor(target.record, id, report))
        .sort()
    }
  };
}

function proofSearchResult(
  source: LoadedSource,
  result: SearchResult,
  report: InspectorReport
): ActivationProofSearchResult {
  return {
    ...(report.target.kind !== "bundle" ? { sourceName: source.record.name } : {}),
    id: result.id,
    ref: refFor(source.record, result.id, report),
    title: result.title,
    type: result.type,
    resource: result.resource,
    snippet: result.snippet,
    score: result.score
  };
}

function proofConcept(
  source: LoadedSource,
  concept: Concept,
  report: InspectorReport
): ProofConcept {
  return {
    record: source.record,
    search: source.search,
    concept,
    ref: refFor(source.record, concept.id, report)
  };
}

function refFor(record: WorkspaceSourceRecord, id: string, report: InspectorReport): string {
  return (
    report.concepts.find((concept) => concept.sourceName === record.name && concept.id === id)
      ?.ref ??
    report.concepts.find((concept) => concept.id === id)?.ref ??
    (report.target.kind === "bundle" ? id : `${record.name}:${id}`)
  );
}

function queryForConcept(concept: Concept): string {
  const candidate = concept.title ?? concept.description ?? concept.id;
  return (
    candidate
      .replace(/[^A-Za-z0-9\s._-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim() || concept.id
  );
}

function normalizeProofTask(task: string | undefined): string | undefined {
  const normalized = task?.replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

async function ensureActivationOutDir(
  outDir: string,
  options: { force: boolean; protectedInputPaths?: string[] }
): Promise<void> {
  const protectedInputPaths = uniqueResolvedPaths(options.protectedInputPaths ?? []);
  assertActivationOutDirDoesNotTargetProtectedPaths(outDir, protectedInputPaths);
  if (options.force) {
    if (protectedInputPaths.length) {
      for (const inputPath of protectedInputPaths) {
        await assertSafeForceOutDir(outDir, { outDir, force: true, inputPath });
      }
    } else {
      await assertSafeForceOutDir(outDir, { outDir, force: true });
    }
  }
  try {
    const entries = await fs.readdir(outDir);
    if (entries.length > 0) {
      if (!options.force)
        throw new Error(
          `Activation output directory is not empty: ${outDir}. Use --force to overwrite.`
        );
      await fs.rm(outDir, { recursive: true, force: true });
    }
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fs.mkdir(outDir, { recursive: true });
}

function assertActivationOutDirDoesNotTargetProtectedPaths(
  outDir: string,
  protectedInputPaths: string[]
): void {
  const resolvedOut = path.resolve(outDir);
  let nestedConflict:
    | {
        relation: "ancestor" | "descendant";
        protectedPath: string;
      }
    | undefined;

  for (const inputPath of protectedInputPaths) {
    const protectedPath = path.resolve(inputPath);
    if (resolvedOut === protectedPath) {
      throw new Error(
        `Activation output directory cannot target a selected source path: ${resolvedOut}. Choose a separate --out directory.`
      );
    }
    if (isPathInside(protectedPath, resolvedOut))
      nestedConflict ??= { relation: "descendant", protectedPath };
    if (isPathInside(resolvedOut, protectedPath))
      nestedConflict ??= { relation: "ancestor", protectedPath };
  }

  if (nestedConflict?.relation === "descendant") {
    throw new Error(
      `Activation output directory cannot be inside a selected source path: ${resolvedOut} is inside ${nestedConflict.protectedPath}. Choose a separate --out directory.`
    );
  }
  if (nestedConflict?.relation === "ancestor") {
    throw new Error(
      `Activation output directory cannot contain a selected source path: ${resolvedOut} contains ${nestedConflict.protectedPath}. Choose a separate --out directory.`
    );
  }
}

export function protectedActivationInputPaths(records: WorkspaceSourceRecord[]): string[] {
  return records.flatMap((record) =>
    isRegisteredWorkspaceRecord(record) ? [record.bundleDir, record.dir] : [record.bundleDir]
  );
}

function isPathInside(parentPath: string, childPath: string): boolean {
  const relative = path.relative(parentPath, childPath);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function uniqueResolvedPaths(paths: string[]): string[] {
  return Array.from(new Set(paths.map((filePath) => path.resolve(filePath))));
}

async function writeFileAtomically(filePath: string, contents: string): Promise<void> {
  const resolved = path.resolve(filePath);
  const tempPath = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  try {
    await fs.writeFile(tempPath, contents, "utf8");
    await fs.rename(tempPath, resolved);
  } catch (error) {
    await fs.rm(tempPath, { force: true });
    throw error;
  }
}

function codeFence(format: SetupArtifact["format"]): string {
  if (format === "toml") return "```toml";
  if (format === "json") return "```json";
  return "```bash";
}

function isAllTarget(target: ServeCommandTarget): target is { all: true } {
  return typeof target === "object" && !Array.isArray(target) && target.all;
}
