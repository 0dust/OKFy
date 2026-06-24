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

type SearchFilters = {
  tags?: string[];
  type?: string;
};

type SearchHit = {
  id: string;
  queryTerms?: string[];
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

const STOPWORDS = new Set([
  "about",
  "after",
  "and",
  "are",
  "can",
  "could",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "into",
  "onto",
  "should",
  "that",
  "the",
  "their",
  "there",
  "this",
  "what",
  "when",
  "where",
  "who",
  "why",
  "with",
  "would",
  "you",
  "your"
]);

function meaningfulQueryTerms(query: string): Set<string> {
  const terms = new Set<string>();
  for (const token of query.match(/[A-Za-z0-9]+/g) ?? []) {
    const normalized = token.toLowerCase();
    const isAcronym =
      normalized.length >= 2 && ["api", "cli", "mcp", "okf", "sdk"].includes(normalized);
    if ((normalized.length >= 4 || isAcronym) && !STOPWORDS.has(normalized)) {
      terms.add(normalized);
    }
  }
  return terms;
}

function matchesMeaningfulQueryTerm(hit: SearchHit, terms: Set<string>): boolean {
  if (terms.size === 0) return false;
  return (hit.queryTerms ?? []).some((term) => terms.has(term.toLowerCase()));
}

export class BundleSearch {
  readonly graph: KnowledgeGraph;
  private readonly index: MiniSearch<SearchDoc>;

  constructor(conceptsByAnyKey: Map<string, Concept>) {
    this.graph = buildGraph(conceptsByAnyKey);
    this.index = new MiniSearch<SearchDoc>({
      fields: ["title", "description", "tags", "type", "body"],
      storeFields: ["id"],
      searchOptions: {
        boost: { title: 4, tags: 3, type: 2, description: 2 },
        fuzzy: 0.2,
        prefix: true
      }
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

  search(
    query: string,
    options: { type?: string; tags?: string[]; limit?: number } = {}
  ): SearchResult[] {
    const limit = options.limit ?? 10;
    const trimmedQuery = query.trim();
    const strict = this.resultsForHits(
      this.index.search(trimmedQuery || MiniSearch.wildcard, { combineWith: "AND" }).slice(0, 100),
      query,
      options
    );
    if (!trimmedQuery || strict.length > 0 || trimmedQuery.split(/\s+/).length < 2)
      return strict.slice(0, limit);

    const fallbackTerms = meaningfulQueryTerms(trimmedQuery);
    const fallback = this.resultsForHits(
      this.index
        .search(trimmedQuery, { combineWith: "OR" })
        .filter((hit) => matchesMeaningfulQueryTerm(hit, fallbackTerms))
        .slice(0, 100),
      query,
      options
    );

    return fallback.slice(0, limit);
  }

  private resultsForHits(hits: SearchHit[], query: string, options: SearchFilters): SearchResult[] {
    const tagFilter = new Set(options.tags ?? []);
    return hits
      .map((hit) => ({ hit, concept: this.graph.concepts.get(hit.id) }))
      .filter((row): row is { hit: (typeof hits)[number]; concept: Concept } =>
        Boolean(row.concept)
      )
      .filter(({ concept }) => !options.type || concept.type === options.type)
      .filter(
        ({ concept }) => tagFilter.size === 0 || concept.tags.some((tag) => tagFilter.has(tag))
      )
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
    return (
      this.graph.concepts.get(id) ??
      [...this.graph.concepts.values()].find((concept) => concept.path === idOrPath)
    );
  }
}
