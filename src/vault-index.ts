import path from "node:path";
import GithubSlugger from "github-slugger";
import { needsGeneratedTitle, slugGeneratedTitle } from "./markdown-title.js";
import type { DocumentDiagnostic, NormalizedDocument, SemanticLink } from "./types.js";
import {
  compareVaultDiagnostics,
  isVaultDiagnosticCode,
  missingFragmentDiagnostic,
  splitMarkdownFragmentTarget,
  vaultDiagnosticTarget
} from "./vault-diagnostics.js";

type VaultEntry = {
  document: NormalizedDocument;
  sourceKey: string;
  identityPaths: Array<{
    key: string;
    stem: string;
    kind: "source" | "output";
  }>;
  names: string[];
  headings: Set<string>;
  blockIds: Set<string>;
};

type Resolution =
  | { status: "resolved"; entry: VaultEntry }
  | { status: "ambiguous"; entries: VaultEntry[] }
  | { status: "unresolved" };

type CandidateMap = Map<string, VaultEntry[]>;

type PathIdentityIndex = {
  keys: CandidateMap;
  stems: CandidateMap;
  suffixes: CandidateMap;
  basenames: CandidateMap;
};

type VaultIndex = {
  paths: Record<"source" | "output", PathIdentityIndex>;
  foldedPaths: Record<"source" | "output", PathIdentityIndex>;
  names: CandidateMap;
  foldedNames: CandidateMap;
};

function compareText(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

export function normalizeVaultPath(value: string): string {
  const withSeparators = value.trim().replace(/\\/g, "/").normalize("NFC");
  const withoutRoot = withSeparators.replace(/^\/+/, "");
  const normalized = path.posix.normalize(withoutRoot);
  return normalized === "." ? "" : normalized.replace(/^\.\//, "");
}

function stripMarkdownExtension(value: string): string {
  return value.replace(/\.(?:md|mdx)$/i, "");
}

function emptyPathIdentityIndex(): PathIdentityIndex {
  return {
    keys: new Map(),
    stems: new Map(),
    suffixes: new Map(),
    basenames: new Map()
  };
}

function addCandidate(candidates: CandidateMap, key: string, entry: VaultEntry): void {
  const entries = candidates.get(key);
  if (entries) entries.push(entry);
  else candidates.set(key, [entry]);
}

function suffixesFor(stem: string): string[] {
  const segments = stem.split("/");
  return segments.map((_, index) => segments.slice(index).join("/"));
}

function addIdentity(index: PathIdentityIndex, key: string, stem: string, entry: VaultEntry): void {
  addCandidate(index.keys, key, entry);
  addCandidate(index.stems, stem, entry);
  for (const suffix of suffixesFor(stem)) addCandidate(index.suffixes, suffix, entry);
  addCandidate(index.basenames, path.posix.basename(stem), entry);
}

function buildVaultIndex(entries: VaultEntry[]): VaultIndex {
  const index: VaultIndex = {
    paths: { source: emptyPathIdentityIndex(), output: emptyPathIdentityIndex() },
    foldedPaths: { source: emptyPathIdentityIndex(), output: emptyPathIdentityIndex() },
    names: new Map(),
    foldedNames: new Map()
  };

  for (const entry of entries) {
    for (const identity of entry.identityPaths) {
      addIdentity(index.paths[identity.kind], identity.key, identity.stem, entry);
      addIdentity(
        index.foldedPaths[identity.kind],
        identity.key.toLocaleLowerCase("en-US"),
        identity.stem.toLocaleLowerCase("en-US"),
        entry
      );
    }
    for (const name of entry.names) {
      addCandidate(index.names, name, entry);
      addCandidate(index.foldedNames, name.toLocaleLowerCase("en-US"), entry);
    }
  }

  return index;
}

function uniqueEntries(entries: VaultEntry[]): VaultEntry[] {
  return [...new Set(entries)].sort((a, b) => compareText(a.sourceKey, b.sourceKey));
}

function resultFor(entries: VaultEntry[]): Resolution | undefined {
  const candidates = uniqueEntries(entries);
  if (candidates.length === 0) return undefined;
  if (candidates.length === 1) return { status: "resolved", entry: candidates[0]! };
  return { status: "ambiguous", entries: candidates };
}

function candidatesFrom(...candidateSets: Array<VaultEntry[] | undefined>): VaultEntry[] {
  return candidateSets.flatMap((candidates) => candidates ?? []);
}

function exactPath(index: VaultIndex, target: string, kind: "source" | "output"): VaultEntry[] {
  const paths = index.paths[kind];
  const exactKeyCandidates = paths.keys.get(target);
  if (exactKeyCandidates?.length) return exactKeyCandidates;
  return paths.stems.get(stripMarkdownExtension(target)) ?? [];
}

function suffixOrBasename(
  index: VaultIndex,
  target: string,
  kind: "source" | "output"
): VaultEntry[] {
  const stem = stripMarkdownExtension(target);
  const paths = index.paths[kind];
  return candidatesFrom(
    paths.suffixes.get(stem),
    ...(stem.includes("/") ? [] : [paths.basenames.get(stem)])
  );
}

function titleOrAlias(index: VaultIndex, target: string): VaultEntry[] {
  return index.names.get(target) ?? [];
}

function caseFoldedCandidates(
  index: VaultIndex,
  sourceRelative: string,
  vaultRelative: string,
  kind: "source" | "output",
  includeNames: boolean
): VaultEntry[] {
  const sourceFolded = sourceRelative.toLocaleLowerCase("en-US");
  const vaultFolded = vaultRelative.toLocaleLowerCase("en-US");
  const stemFolded = stripMarkdownExtension(vaultRelative).toLocaleLowerCase("en-US");
  const basenameFolded = path.posix.basename(stemFolded);
  const paths = index.foldedPaths[kind];

  return candidatesFrom(
    paths.keys.get(sourceFolded),
    paths.stems.get(stripMarkdownExtension(sourceFolded)),
    paths.keys.get(vaultFolded),
    paths.stems.get(stemFolded),
    paths.suffixes.get(stemFolded),
    ...(stemFolded.includes("/") ? [] : [paths.basenames.get(basenameFolded)]),
    ...(includeNames ? [index.foldedNames.get(vaultFolded)] : [])
  );
}

function resolveTarget(
  index: VaultIndex,
  sourceKey: string,
  rawTarget: string,
  options: { pathKind?: "source" | "output"; includeNames?: boolean } = {}
): Resolution {
  const target = normalizeVaultPath(rawTarget);
  const sourceRelative = normalizeVaultPath(path.posix.join(path.posix.dirname(sourceKey), target));
  const pathKind = options.pathKind ?? "source";

  let result = resultFor(exactPath(index, sourceRelative, pathKind));
  if (result) return result;
  result = resultFor(exactPath(index, target, pathKind));
  if (result) return result;
  result = resultFor(suffixOrBasename(index, target, pathKind));
  if (result) return result;
  if (options.includeNames !== false) {
    result = resultFor(titleOrAlias(index, target));
    if (result) return result;
  }

  return (
    resultFor(
      caseFoldedCandidates(index, sourceRelative, target, pathKind, options.includeNames !== false)
    ) ?? {
      status: "unresolved"
    }
  );
}

function unresolvedDiagnostic(sourcePath: string, link: SemanticLink): DocumentDiagnostic {
  const rawTarget = vaultDiagnosticTarget(link);
  return {
    severity: "warning",
    code: "unresolved_wikilink",
    message: `Unresolved Obsidian reference ${JSON.stringify(rawTarget)} in ${sourcePath}.`,
    sourcePath,
    rawTarget
  };
}

function ambiguousDiagnostic(
  sourcePath: string,
  link: SemanticLink,
  entries: VaultEntry[]
): DocumentDiagnostic {
  const rawTarget = vaultDiagnosticTarget(link);
  const candidates = entries.map((entry) => entry.sourceKey);
  return {
    severity: "warning",
    code: "ambiguous_wikilink",
    message: `Ambiguous Obsidian reference ${JSON.stringify(rawTarget)} in ${sourcePath}: ${candidates.join(", ")}.`,
    sourcePath,
    rawTarget,
    candidates
  };
}

function hasHeading(entry: VaultEntry, heading: string): boolean {
  const normalized = heading.trim().normalize("NFC");
  const slug = new GithubSlugger().slug(normalized);
  return entry.headings.has(normalized) || entry.headings.has(slug);
}

function indexedHeadings(document: NormalizedDocument): Set<string> {
  const headings = new Set(
    document.headings.flatMap((heading) => [
      heading.text.normalize("NFC"),
      heading.slug.normalize("NFC")
    ])
  );
  // Keep fragment resolution aligned with the H1 that writer.withTitle will prepend.
  if (needsGeneratedTitle(document.markdown.trimStart())) {
    const generatedTitle = document.title.trim().normalize("NFC");
    if (generatedTitle) {
      headings.add(generatedTitle);
      headings.add(slugGeneratedTitle(new GithubSlugger(), generatedTitle));
    }
  }
  return headings;
}

function resolveLink(
  entry: VaultEntry,
  link: SemanticLink,
  index: VaultIndex,
  includeMarkdownFragments: boolean
): DocumentDiagnostic | undefined {
  if (link.kind === "markdown") {
    if (!includeMarkdownFragments) return undefined;
    const destination = splitMarkdownFragmentTarget(link.target);
    if (!destination) return undefined;
    const outputSourceKey = normalizeVaultPath(entry.document.outputPath ?? entry.sourceKey);
    const resolution = resolveTarget(index, outputSourceKey, destination.targetPath, {
      pathKind: "output",
      includeNames: false
    });
    if (resolution.status !== "resolved") return undefined;
    const decodedFragment = destination.fragment.normalize("NFC");
    if (
      resolution.entry.headings.has(decodedFragment) ||
      resolution.entry.blockIds.has(decodedFragment.replace(/^\^/, ""))
    ) {
      return undefined;
    }
    return missingFragmentDiagnostic(
      entry.sourceKey,
      vaultDiagnosticTarget(link),
      resolution.entry.sourceKey
    );
  }
  if (link.kind !== "wikilink" && link.kind !== "note_embed") return undefined;

  const resolution = resolveTarget(index, entry.sourceKey, link.target || entry.sourceKey);
  if (resolution.status === "unresolved") {
    link.resolution = "unresolved";
    delete link.resolvedSourceKey;
    return unresolvedDiagnostic(entry.sourceKey, link);
  }
  if (resolution.status === "ambiguous") {
    link.resolution = "ambiguous";
    delete link.resolvedSourceKey;
    return ambiguousDiagnostic(entry.sourceKey, link, resolution.entries);
  }

  link.resolution = "resolved";
  link.resolvedSourceKey = resolution.entry.sourceKey;
  if (link.heading && !hasHeading(resolution.entry, link.heading)) {
    return missingFragmentDiagnostic(
      entry.sourceKey,
      vaultDiagnosticTarget(link),
      resolution.entry.sourceKey
    );
  }
  if (link.blockId && !resolution.entry.blockIds.has(link.blockId.normalize("NFC"))) {
    return missingFragmentDiagnostic(
      entry.sourceKey,
      vaultDiagnosticTarget(link),
      resolution.entry.sourceKey
    );
  }
  return undefined;
}

function entryFor(document: NormalizedDocument): VaultEntry | undefined {
  const sourceKey = normalizeVaultPath(document.sourcePath ?? document.sourceId);
  if (!/\.(?:md|mdx)$/i.test(sourceKey)) return undefined;
  const outputKey = normalizeVaultPath(document.outputPath ?? "");
  const names = [document.title, ...(document.aliases ?? [])]
    .map((name) => name.trim().normalize("NFC"))
    .filter(Boolean);
  return {
    document,
    sourceKey,
    identityPaths: [
      { key: sourceKey, kind: "source" as const },
      ...(outputKey ? [{ key: outputKey, kind: "output" as const }] : [])
    ].map(({ key, kind }) => {
      const stem = stripMarkdownExtension(key);
      return { key, stem, kind };
    }),
    names: [...new Set(names)].sort(compareText),
    headings: indexedHeadings(document),
    blockIds: new Set((document.blockIds ?? []).map((block) => block.id.normalize("NFC")))
  };
}

export function resolveVaultDocuments(
  documents: NormalizedDocument[],
  options: { includeMarkdownFragments?: boolean } = {}
): DocumentDiagnostic[] {
  const entries = documents
    .map(entryFor)
    .filter((entry): entry is VaultEntry => Boolean(entry))
    .sort((a, b) => compareText(a.sourceKey, b.sourceKey));
  const index = buildVaultIndex(entries);
  const diagnostics: DocumentDiagnostic[] = [];

  for (const entry of entries) {
    const documentDiagnostics = (entry.document.diagnostics ?? []).filter(
      (diagnostic) => !isVaultDiagnosticCode(diagnostic.code)
    );
    for (const link of entry.document.semanticLinks ?? []) {
      const diagnostic = resolveLink(entry, link, index, Boolean(options.includeMarkdownFragments));
      if (diagnostic) documentDiagnostics.push(diagnostic);
    }
    documentDiagnostics.sort(compareVaultDiagnostics);
    entry.document.diagnostics = documentDiagnostics;
    diagnostics.push(...documentDiagnostics);
  }

  const indexedDocuments = new Set(entries.map((entry) => entry.document));
  for (const document of documents) {
    if (indexedDocuments.has(document)) continue;
    diagnostics.push(
      ...(document.diagnostics ?? []).filter(
        (diagnostic) => !isVaultDiagnosticCode(diagnostic.code)
      )
    );
  }

  return diagnostics.sort(compareVaultDiagnostics);
}
