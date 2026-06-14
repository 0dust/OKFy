import MiniSearch from "minisearch";
import { buildGraph } from "./graph.js";
import { readBundle } from "./reader.js";
import type { Concept, KnowledgeGraph } from "./types.js";

export type SearchResult = {
  id: string;
  title?: string;
  type: string;
  description?: string;
  tags: string[];
  resource?: string;
  snippet: string;
  score: number;
};

type SearchDoc = {
  id: string;
  title: string;
  type: string;
  description: string;
  tags: string;
  body: string;
};

function snippet(concept: Concept, query: string, max = 240): string {
  const text = `${concept.description ?? ""} ${concept.body}`.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const term = query.toLowerCase().split(/\s+/).find(Boolean) ?? "";
  const index = term ? lower.indexOf(term) : -1;
  const start = Math.max(0, index - 80);
  return text.slice(start, start + max);
}

export class BundleSearch {
  readonly graph: KnowledgeGraph;
  private readonly index: MiniSearch<SearchDoc>;

  constructor(conceptsByAnyKey: Map<string, Concept>) {
    this.graph = buildGraph(conceptsByAnyKey);
    this.index = new MiniSearch<SearchDoc>({
      fields: ["title", "description", "tags", "type", "body"],
      storeFields: ["id"],
      searchOptions: { boost: { title: 4, tags: 3, type: 2, description: 2 }, fuzzy: 0.2, prefix: true }
    });
    this.index.addAll(
      [...this.graph.concepts.values()].map((concept) => ({
        id: concept.id,
        title: concept.title ?? concept.id,
        type: concept.type,
        description: concept.description ?? "",
        tags: concept.tags.join(" "),
        body: concept.body
      }))
    );
  }

  static async fromBundle(bundleDir: string): Promise<BundleSearch> {
    return new BundleSearch(await readBundle(bundleDir));
  }

  search(query: string, options: { type?: string; tags?: string[]; limit?: number } = {}): SearchResult[] {
    const hits = this.index.search(query || MiniSearch.wildcard, { combineWith: "AND" }).slice(0, 100);
    const tagFilter = new Set(options.tags ?? []);
    return hits
      .map((hit) => ({ hit, concept: this.graph.concepts.get(hit.id) }))
      .filter((row): row is { hit: typeof hits[number]; concept: Concept } => Boolean(row.concept))
      .filter(({ concept }) => !options.type || concept.type === options.type)
      .filter(({ concept }) => tagFilter.size === 0 || concept.tags.some((tag) => tagFilter.has(tag)))
      .slice(0, options.limit ?? 10)
      .map(({ hit, concept }) => ({
        id: concept.id,
        title: concept.title,
        type: concept.type,
        description: concept.description,
        tags: concept.tags,
        resource: concept.resource,
        snippet: snippet(concept, query),
        score: hit.score
      }));
  }

  getConcept(idOrPath: string): Concept | undefined {
    const id = idOrPath.replace(/\.md$/i, "");
    return this.graph.concepts.get(id) ?? [...this.graph.concepts.values()].find((concept) => concept.path === idOrPath);
  }
}
