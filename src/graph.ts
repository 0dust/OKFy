import { internalLinksFromSemantics } from "./internal-links.js";
import { parseMarkdown } from "./markdown-ast.js";
import type { Concept, KnowledgeGraph, SemanticLink } from "./types.js";

export function extractInternalLinks(concept: Concept): string[] {
  const sourcePath = concept.resource?.split(/[?#]/, 1)[0] ?? "";
  return internalLinksFromSemantics(
    concept.path,
    parseMarkdown(concept.body, { mdx: /\.mdx$/i.test(sourcePath) }).semanticLinks
  );
}

function graphFromTargets(
  conceptsByAnyKey: Map<string, Concept>,
  targetsFor: (concept: Concept) => string[]
): KnowledgeGraph {
  const concepts = new Map<string, Concept>();
  for (const concept of conceptsByAnyKey.values()) concepts.set(concept.id, concept);

  const outbound = new Map<string, string[]>();
  const backlinks = new Map<string, string[]>();
  for (const concept of concepts.values()) {
    const targets = targetsFor(concept).filter((id) => concepts.has(id));
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

export function buildGraph(conceptsByAnyKey: Map<string, Concept>): KnowledgeGraph {
  return graphFromTargets(conceptsByAnyKey, extractInternalLinks);
}

export function buildGraphFromSemantics(
  conceptsByAnyKey: Map<string, Concept>,
  semanticLinksByConceptId: Map<string, SemanticLink[]>
): KnowledgeGraph {
  return graphFromTargets(conceptsByAnyKey, (concept) =>
    internalLinksFromSemantics(concept.path, semanticLinksByConceptId.get(concept.id) ?? [])
  );
}
