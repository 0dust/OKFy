import robotsParser from "robots-parser";
import pLimit from "p-limit";
import * as cheerio from "cheerio";
import { normalizeDocument } from "./normalize.js";
import { writeOkfBundle } from "./writer.js";
import { matchesAnyPattern } from "./util/match.js";
import { canonicalizeUrl, isHttpUrl, isPrivateNetworkUrl, sameOrigin } from "./util/url.js";
import type { NormalizedDocument, RawDocument } from "./types.js";

export type CrawlOptions = {
  seedUrl: string;
  outDir: string;
  maxPages?: number;
  maxDepth?: number;
  include?: string[];
  exclude?: string[];
  sameOrigin?: boolean;
  respectRobots?: boolean;
  concurrency?: number;
  title?: string;
  force?: boolean;
  dryRun?: boolean;
  allowPrivateNetwork?: boolean;
  timestamp?: string;
};

export type CrawlResult = {
  pagesFetched: number;
  skipped: number;
  failed: number;
  written: string[];
  documents: NormalizedDocument[];
  dryRunPages?: string[];
};

const USER_AGENT = "okfy/0.1 (+https://github.com/0dust/OKFy)";
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

async function fetchText(url: string): Promise<{ text: string; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { "user-agent": USER_AGENT, accept: "text/html,text/markdown,text/plain,*/*" },
          redirect: "follow"
        });
        if (!response.ok) {
          if ((response.status >= 500 || response.status === 429) && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
            continue;
          }
          throw new Error(`Fetch failed ${response.status} for ${url}`);
        }
        const length = Number(response.headers.get("content-length") ?? "0");
        if (length > MAX_RESPONSE_BYTES) throw new Error(`Response too large for ${url}`);
        const text = await response.text();
        if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error(`Response too large for ${url}`);
        return { text, contentType: response.headers.get("content-type") ?? "" };
      } catch (error: any) {
        lastError = error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
    throw lastError ?? new Error(`Fetch failed for ${url}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function loadRobots(seedUrl: string, enabled: boolean): Promise<ReturnType<typeof robotsParser> | undefined> {
  if (!enabled) return undefined;
  const origin = new URL(seedUrl).origin;
  try {
    const response = await fetch(`${origin}/robots.txt`, { headers: { "user-agent": USER_AGENT } });
    const text = response.ok ? await response.text() : "";
    return robotsParser(`${origin}/robots.txt`, text);
  } catch {
    return robotsParser(`${origin}/robots.txt`, "");
  }
}

function shouldVisit(url: string, seed: string, options: CrawlOptions, robots?: ReturnType<typeof robotsParser>): boolean {
  if (!isHttpUrl(url)) return false;
  if ((options.sameOrigin ?? true) && !sameOrigin(url, seed)) return false;
  if (!options.allowPrivateNetwork && isPrivateNetworkUrl(url)) return false;
  if (options.include?.length && !matchesAnyPattern(url, options.include)) return false;
  if (matchesAnyPattern(url, options.exclude)) return false;
  if (robots && !robots.isAllowed(url, USER_AGENT)) return false;
  return true;
}

function contentTypeFromHeader(header: string): "html" | "markdown" | "text" | undefined {
  const lower = header.toLowerCase();
  if (lower.includes("text/html")) return "html";
  if (lower.includes("markdown")) return "markdown";
  if (lower.includes("text/plain")) return "text";
  if (!lower) return "html";
  return undefined;
}

function extractRawHtmlLinks(raw: string): Array<{ href: string; text: string }> {
  const $ = cheerio.load(raw);
  return $("a[href]")
    .map((_, element) => ({
      href: String($(element).attr("href") ?? ""),
      text: $(element).text().trim()
    }))
    .get()
    .filter((link) => link.href.length > 0);
}

export async function crawlWebsite(options: CrawlOptions): Promise<CrawlResult> {
  const seed = canonicalizeUrl(options.seedUrl);
  if (!options.allowPrivateNetwork && isPrivateNetworkUrl(seed)) {
    throw new Error("Private network crawl target rejected. Use --allow-private-network for trusted local fixtures.");
  }
  const maxPages = options.maxPages ?? 100;
  const maxDepth = options.maxDepth ?? 4;
  const robots = await loadRobots(seed, options.respectRobots ?? true);
  const queue: Array<{ url: string; depth: number }> = [{ url: seed, depth: 0 }];
  const queued = new Set([seed]);
  const visited = new Set<string>();
  const planned: string[] = [];
  const documents: NormalizedDocument[] = [];
  let skipped = 0;
  let failed = 0;
  const limit = pLimit(options.concurrency ?? 4);

  while (queue.length > 0 && visited.size < maxPages) {
    const batch = queue.splice(0, Math.min(queue.length, maxPages - visited.size));
    const results = await Promise.all(
      batch.map((item) =>
        limit(async () => {
          if (visited.has(item.url)) return;
          visited.add(item.url);
          if (!shouldVisit(item.url, seed, options, robots)) {
            skipped += 1;
            return;
          }
          planned.push(item.url);
          try {
            const fetched = await fetchText(item.url);
            const contentType = contentTypeFromHeader(fetched.contentType);
            if (!contentType) {
              skipped += 1;
              return;
            }
            const raw: RawDocument = {
              sourceId: item.url,
              url: item.url,
              contentType,
              raw: fetched.text,
              discoveredAt: options.timestamp ?? new Date().toISOString()
            };
            const doc = normalizeDocument(raw);
            if (!options.dryRun) documents.push(doc);
            if (item.depth < maxDepth) {
              const links = options.dryRun && contentType === "html" ? extractRawHtmlLinks(fetched.text) : doc.links;
              for (const link of links) {
                try {
                  const next = canonicalizeUrl(link.href, item.url);
                  if (!queued.has(next) && shouldVisit(next, seed, options, robots) && queued.size < maxPages * 4) {
                    queued.add(next);
                    queue.push({ url: next, depth: item.depth + 1 });
                  }
                } catch {
                  skipped += 1;
                }
              }
            }
          } catch {
            failed += 1;
          }
        })
      )
    );
    void results;
  }

  if (options.dryRun) {
    return { pagesFetched: planned.length, skipped, failed, written: [], documents: [], dryRunPages: planned.slice(0, maxPages) };
  }
  if (documents.length === 0) throw new Error("Crawl generated zero concepts.");
  const written = await writeOkfBundle(documents, {
    outDir: options.outDir,
    title: options.title,
    sourceName: seed,
    force: options.force,
    timestamp: options.timestamp
  });
  return { pagesFetched: documents.length, skipped, failed, written, documents };
}
