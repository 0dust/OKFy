import { internalLinksFromSemantics } from "./internal-links.js";
import { parseMarkdown } from "./markdown-ast.js";
import type { Concept, KnowledgeGraph } from "./types.js";

export function extractInternalLinks(concept: Concept): string[] {
  const sourcePath = concept.resource?.split(/[?#]/, 1)[0] ?? "";
  return internalLinksFromSemantics(
    concept.path,
    parseMarkdown(concept.body, { mdx: /\.mdx$/i.test(sourcePath) }).semanticLinks
  );
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
