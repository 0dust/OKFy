import type { DocumentDiagnostic, NormalizedDocument, SemanticLink } from "./types.js";

export const VAULT_DIAGNOSTIC_CODES = new Set([
  "unresolved_wikilink",
  "ambiguous_wikilink",
  "missing_wikilink_fragment"
]);

export function isVaultDiagnosticCode(code: string): boolean {
  return VAULT_DIAGNOSTIC_CODES.has(code);
}

export function vaultDiagnosticTarget(link: SemanticLink): string {
  if (link.heading) return `${link.target}#${link.heading}`;
  if (link.blockId) return `${link.target}#^${link.blockId}`;
  return link.target;
}

export function missingFragmentDiagnostic(
  sourcePath: string,
  rawTarget: string,
  targetPath: string
): DocumentDiagnostic {
  return {
    severity: "warning",
    code: "missing_wikilink_fragment",
    message: `Missing fragment in Obsidian reference ${JSON.stringify(rawTarget)} from ${sourcePath} to ${targetPath}.`,
    sourcePath,
    rawTarget,
    candidates: [targetPath]
  };
}

export function splitMarkdownFragmentTarget(
  target: string
): { targetPath: string; fragment: string } | undefined {
  const hash = target.indexOf("#");
  if (hash < 0) return undefined;
  const targetPath = target.slice(0, hash);
  const encodedFragment = target.slice(hash + 1);
  if (!targetPath || !encodedFragment || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(targetPath)) {
    return undefined;
  }
  try {
    return { targetPath, fragment: decodeURIComponent(encodedFragment) };
  } catch {
    return { targetPath, fragment: encodedFragment };
  }
}

export type DocumentFragmentIndex = {
  headings: Set<string>;
  blocks: Set<string>;
};

export function indexDocumentFragments(
  document: Pick<NormalizedDocument, "headings" | "blockIds">
): DocumentFragmentIndex {
  return {
    headings: new Set(document.headings.map((heading) => heading.slug.normalize("NFC"))),
    blocks: new Set((document.blockIds ?? []).map((block) => block.id.normalize("NFC")))
  };
}

export function fragmentIndexContains(
  index: DocumentFragmentIndex,
  fragment: string,
  kind: "heading" | "block"
): boolean {
  return (kind === "block" ? index.blocks : index.headings).has(fragment.normalize("NFC"));
}

function compareText(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

export function compareVaultDiagnostics(
  first: DocumentDiagnostic,
  second: DocumentDiagnostic
): number {
  return (
    compareText(first.sourcePath, second.sourcePath) ||
    compareText(first.rawTarget, second.rawTarget) ||
    compareText(first.code, second.code) ||
    compareText((first.candidates ?? []).join("\0"), (second.candidates ?? []).join("\0"))
  );
}
