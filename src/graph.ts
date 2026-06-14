import path from "node:path";
import { stripMdExtension } from "./util/path.js";
import type { Concept, KnowledgeGraph } from "./types.js";

export function extractInternalLinks(concept: Concept): string[] {
  const links = new Set<string>();
  for (const match of concept.body.matchAll(/\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const href = match[1] ?? "";
    if (/^(https?:)?\/\//.test(href) || href.startsWith("mailto:") || href.startsWith("#")) continue;
    const noHash = href.split("#")[0] ?? href;
    if (!noHash) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(concept.path), noHash));
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
