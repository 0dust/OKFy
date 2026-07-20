import path from "node:path";
import { parseMarkdown } from "./markdown-ast.js";
import { stripMdExtension } from "./util/path.js";
import type { Concept, KnowledgeGraph, SemanticLink } from "./types.js";

export function extractInternalLinks(concept: Concept): string[] {
  const sourcePath = concept.resource?.split(/[?#]/, 1)[0] ?? "";
  return extractInternalLinksFromSemantics(
    concept.path,
    parseMarkdown(concept.body, { mdx: /\.mdx$/i.test(sourcePath) }).semanticLinks
  );
}

export function extractInternalLinksFromSemantics(
  conceptPath: string,
  semanticLinks: SemanticLink[]
): string[] {
  const links = new Set<string>();
  for (const link of semanticLinks) {
    if (link.kind !== "markdown") continue;
    const href = link.target;
    const noHash = href.split("#")[0] ?? href;
    if (!noHash) continue;
    if (/^(https?:)?\/\//i.test(noHash) || /^mailto:/i.test(noHash)) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(noHash)) continue;
    const resolved = noHash.startsWith("/")
      ? path.posix.normalize(noHash.slice(1))
      : path.posix.normalize(path.posix.join(path.posix.dirname(conceptPath), noHash));
    if (!resolved || resolved === ".") continue;
    links.add(stripMdExtension(resolved));
  }
  return [...links].sort();
}

export function buildGraph(conceptsByAnyKey: Map<string, Concept>): KnowledgeGraph {
  const concepts = new Map<string, Concept>();
  for (const concept of conceptsByAnyKey.values()) concepts.set(concept.id, concept);

  const outbound = new Map<string, string[]>();
  const backlinks = new Map<string, string[]>();
  for (const concept of concepts.values()) {
    const targets = extractInternalLinks(concept).filter((id) => concepts.has(id));
    outbound.set(concept.id, targets);
    for (const target of targets) {
      backlinks.set(target, [...(backlinks.get(target) ?? []), concept.id].sort());
    }
  }
  for (const concept of concepts.values()) {
    if (!backlinks.has(concept.id)) backlinks.set(concept.id, []);
    if (!outbound.has(concept.id)) outbound.set(concept.id, []);
  }
  return { concepts, outbound, backlinks };
}
