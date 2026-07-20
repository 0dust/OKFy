import path from "node:path";
import GithubSlugger from "github-slugger";
import type { DocumentDiagnostic, NormalizedDocument, SemanticLink } from "./types.js";

type VaultEntry = {
  document: NormalizedDocument;
  sourceKey: string;
  identityPaths: Array<{
    key: string;
    stem: string;
    basename: string;
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

function decodeFragment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function identitiesFor(entry: VaultEntry, kind: "source" | "output") {
  return entry.identityPaths.filter((identity) => identity.kind === kind);
}

function pathMatches(entry: VaultEntry, target: string, kind: "source" | "output"): boolean {
  const stem = stripMarkdownExtension(target);
  return identitiesFor(entry, kind).some(
    (identity) => identity.key === target || identity.stem === stem
  );
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

function exactPath(entries: VaultEntry[], target: string, kind: "source" | "output"): VaultEntry[] {
  return entries.filter((entry) => pathMatches(entry, target, kind));
}

function suffixOrBasename(
  entries: VaultEntry[],
  target: string,
  kind: "source" | "output"
): VaultEntry[] {
  const stem = stripMarkdownExtension(target);
  const basename = path.posix.basename(stem);
  return entries.filter((entry) =>
    identitiesFor(entry, kind).some(
      (identity) =>
        identity.stem === stem ||
        identity.stem.endsWith(`/${stem}`) ||
        identity.basename === basename
    )
  );
}

function titleOrAlias(entries: VaultEntry[], target: string): VaultEntry[] {
  return entries.filter((entry) => entry.names.includes(target));
}

function caseFoldedCandidates(
  entries: VaultEntry[],
  sourceRelative: string,
  vaultRelative: string,
  kind: "source" | "output",
  includeNames: boolean
): VaultEntry[] {
  const sourceFolded = sourceRelative.toLocaleLowerCase("en-US");
  const vaultFolded = vaultRelative.toLocaleLowerCase("en-US");
  const stemFolded = stripMarkdownExtension(vaultRelative).toLocaleLowerCase("en-US");
  const basenameFolded = path.posix.basename(stemFolded);

  return entries.filter((entry) => {
    return (
      identitiesFor(entry, kind).some((identity) => {
        const key = identity.key.toLocaleLowerCase("en-US");
        const stem = identity.stem.toLocaleLowerCase("en-US");
        return (
          key === sourceFolded ||
          stem === stripMarkdownExtension(sourceFolded) ||
          key === vaultFolded ||
          stem === stemFolded ||
          stem.endsWith(`/${stemFolded}`) ||
          identity.basename.toLocaleLowerCase("en-US") === basenameFolded
        );
      }) ||
      (includeNames && entry.names.some((name) => name.toLocaleLowerCase("en-US") === vaultFolded))
    );
  });
}

function resolveTarget(
  entries: VaultEntry[],
  sourceKey: string,
  rawTarget: string,
  options: { pathKind?: "source" | "output"; includeNames?: boolean } = {}
): Resolution {
  const target = normalizeVaultPath(rawTarget);
  const sourceRelative = normalizeVaultPath(path.posix.join(path.posix.dirname(sourceKey), target));
  const pathKind = options.pathKind ?? "source";

  for (const candidates of [
    exactPath(entries, sourceRelative, pathKind),
    exactPath(entries, target, pathKind),
    suffixOrBasename(entries, target, pathKind),
    ...(options.includeNames === false ? [] : [titleOrAlias(entries, target)])
  ]) {
    const result = resultFor(candidates);
    if (result) return result;
  }

  return (
    resultFor(
      caseFoldedCandidates(
        entries,
        sourceRelative,
        target,
        pathKind,
        options.includeNames !== false
      )
    ) ?? {
      status: "unresolved"
    }
  );
}

function diagnosticTarget(link: SemanticLink): string {
  if (link.heading) return `${link.target}#${link.heading}`;
  if (link.blockId) return `${link.target}#^${link.blockId}`;
  return link.target;
}

function unresolvedDiagnostic(sourcePath: string, link: SemanticLink): DocumentDiagnostic {
  const rawTarget = diagnosticTarget(link);
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
  const rawTarget = diagnosticTarget(link);
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

function fragmentDiagnostic(
  sourcePath: string,
  link: SemanticLink,
  targetPath: string
): DocumentDiagnostic {
  const rawTarget = diagnosticTarget(link);
  return {
    severity: "warning",
    code: "missing_wikilink_fragment",
    message: `Missing fragment in Obsidian reference ${JSON.stringify(rawTarget)} from ${sourcePath} to ${targetPath}.`,
    sourcePath,
    rawTarget,
    candidates: [targetPath]
  };
}

function hasHeading(entry: VaultEntry, heading: string): boolean {
  const normalized = heading.trim().normalize("NFC");
  const slug = new GithubSlugger().slug(normalized);
  return entry.headings.has(normalized) || entry.headings.has(slug);
}

function resolveLink(
  entry: VaultEntry,
  link: SemanticLink,
  entries: VaultEntry[],
  includeMarkdownFragments: boolean
): DocumentDiagnostic | undefined {
  if (link.kind === "markdown") {
    if (!includeMarkdownFragments) return undefined;
    const hash = link.target.indexOf("#");
    if (hash < 0) return undefined;
    const target = link.target.slice(0, hash);
    const fragment = link.target.slice(hash + 1);
    if (!target || !fragment || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) return undefined;
    const outputSourceKey = normalizeVaultPath(entry.document.outputPath ?? entry.sourceKey);
    const resolution = resolveTarget(entries, outputSourceKey, target, {
      pathKind: "output",
      includeNames: false
    });
    if (resolution.status !== "resolved") return undefined;
    const decodedFragment = decodeFragment(fragment).normalize("NFC");
    if (
      resolution.entry.headings.has(decodedFragment) ||
      resolution.entry.blockIds.has(decodedFragment.replace(/^\^/, ""))
    ) {
      return undefined;
    }
    return {
      severity: "warning",
      code: "missing_wikilink_fragment",
      message: `Missing fragment in Obsidian reference ${JSON.stringify(link.target)} from ${entry.sourceKey} to ${resolution.entry.sourceKey}.`,
      sourcePath: entry.sourceKey,
      rawTarget: link.target,
      candidates: [resolution.entry.sourceKey]
    };
  }
  if (link.kind !== "wikilink" && link.kind !== "note_embed") return undefined;

  const resolution = resolveTarget(entries, entry.sourceKey, link.target || entry.sourceKey);
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
    return fragmentDiagnostic(entry.sourceKey, link, resolution.entry.sourceKey);
  }
  if (link.blockId && !resolution.entry.blockIds.has(link.blockId.normalize("NFC"))) {
    return fragmentDiagnostic(entry.sourceKey, link, resolution.entry.sourceKey);
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
      return { key, stem, basename: path.posix.basename(stem), kind };
    }),
    names: [...new Set(names)].sort(compareText),
    headings: new Set(
      document.headings.flatMap((heading) => [
        heading.text.normalize("NFC"),
        heading.slug.normalize("NFC")
      ])
    ),
    blockIds: new Set((document.blockIds ?? []).map((block) => block.id.normalize("NFC")))
  };
}

function compareDiagnostics(first: DocumentDiagnostic, second: DocumentDiagnostic): number {
  return (
    compareText(first.sourcePath, second.sourcePath) ||
    compareText(first.rawTarget, second.rawTarget) ||
    compareText(first.code, second.code) ||
    compareText((first.candidates ?? []).join("\0"), (second.candidates ?? []).join("\0"))
  );
}

export function resolveVaultDocuments(
  documents: NormalizedDocument[],
  options: { includeMarkdownFragments?: boolean } = {}
): DocumentDiagnostic[] {
  const entries = documents
    .map(entryFor)
    .filter((entry): entry is VaultEntry => Boolean(entry))
    .sort((a, b) => compareText(a.sourceKey, b.sourceKey));
  const diagnostics: DocumentDiagnostic[] = [];

  for (const entry of entries) {
    const documentDiagnostics: DocumentDiagnostic[] = [];
    for (const link of entry.document.semanticLinks ?? []) {
      const diagnostic = resolveLink(
        entry,
        link,
        entries,
        Boolean(options.includeMarkdownFragments)
      );
      if (diagnostic) documentDiagnostics.push(diagnostic);
    }
    documentDiagnostics.sort(compareDiagnostics);
    entry.document.diagnostics = documentDiagnostics;
    diagnostics.push(...documentDiagnostics);
  }

  return diagnostics.sort(compareDiagnostics);
}
