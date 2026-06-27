import robotsParser from "robots-parser";
import pLimit from "p-limit";
import * as cheerio from "cheerio";
import { normalizeDocument } from "./normalize.js";
import { writeOkfBundle } from "./writer.js";
import { okfyUserAgent } from "./metadata.js";
import { matchesAnyPattern } from "./util/match.js";
import {
  assertPublicNetworkUrl,
  canonicalizeUrl,
  isHttpUrl,
  isPrivateNetworkUrl,
  resolvesToPrivateNetwork,
  sameOrigin
} from "./util/url.js";
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
  dangerouslyAllowUnsafeOutput?: boolean;
  timestamp?: string;
  onProgress?: (event: CrawlProgressEvent) => void;
};

export type CrawlProgressEvent =
  | { type: "start"; seed: string; maxPages: number; maxDepth: number }
  | { type: "fetch"; url: string; fetched: number; queued: number; maxPages: number }
  | {
      type: "fetched";
      url: string;
      fetched: number;
      queued: number;
      discovered: number;
      maxPages: number;
    }
  | { type: "skipped"; url: string; fetched: number; queued: number; maxPages: number }
  | { type: "failed"; url: string; fetched: number; queued: number; maxPages: number }
  | { type: "writing"; concepts: number; outDir: string };

export type CrawlResult = {
  pagesFetched: number;
  skipped: number;
  failed: number;
  written: string[];
  documents: NormalizedDocument[];
  dryRunPages?: string[];
};

const USER_AGENT = okfyUserAgent();
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

type FetchTextOptions = {
  allowPrivateNetwork?: boolean;
  sameOriginSeed?: string;
};

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400;
}

function isSecurityRejection(error: unknown): boolean {
  const message = error instanceof Error ? error.message : "";
  return (
    message.includes("Private network crawl target rejected") ||
    message.includes("Cross-origin redirect rejected")
  );
}

async function fetchWithRedirects(
  url: string,
  options: FetchTextOptions,
  signal: AbortSignal
): Promise<Response> {
  let current = url;
  for (let redirectCount = 0; redirectCount <= 10; redirectCount += 1) {
    if (!options.allowPrivateNetwork) await assertPublicNetworkUrl(current);
    if (options.sameOriginSeed && !sameOrigin(current, options.sameOriginSeed)) {
      throw new Error(`Cross-origin redirect rejected: ${current}`);
    }
    const response = await fetch(current, {
      signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,text/markdown,text/plain,*/*" },
      redirect: "manual"
    });
    if (!isRedirect(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error(`Redirect missing location for ${current}`);
    current = canonicalizeUrl(location, current);
  }
  throw new Error(`Too many redirects for ${url}`);
}

async function fetchText(
  url: string,
  options: FetchTextOptions = {}
): Promise<{ text: string; contentType: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetchWithRedirects(url, options, controller.signal);
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
        if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES)
          throw new Error(`Response too large for ${url}`);
        return { text, contentType: response.headers.get("content-type") ?? "" };
      } catch (error: any) {
        lastError = error;
        if (isSecurityRejection(error)) throw error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
    throw lastError ?? new Error(`Fetch failed for ${url}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function loadRobots(
  seedUrl: string,
  enabled: boolean
): Promise<ReturnType<typeof robotsParser> | undefined> {
  if (!enabled) return undefined;
  const origin = new URL(seedUrl).origin;
  try {
    const fetched = await fetchText(`${origin}/robots.txt`, { sameOriginSeed: seedUrl });
    const text = fetched.text;
    return robotsParser(`${origin}/robots.txt`, text);
  } catch {
    return robotsParser(`${origin}/robots.txt`, "");
  }
}

function shouldVisit(
  url: string,
  seed: string,
  options: CrawlOptions,
  robots?: ReturnType<typeof robotsParser>
): boolean {
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
    throw new Error(
      "Private network crawl target rejected. Use --allow-private-network for trusted local fixtures."
    );
  }
  if (!options.allowPrivateNetwork) await assertPublicNetworkUrl(seed);
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
  options.onProgress?.({ type: "start", seed, maxPages, maxDepth });

  while (queue.length > 0 && visited.size < maxPages) {
    const batch = queue.splice(0, Math.min(queue.length, maxPages - visited.size));
    await Promise.all(
      batch.map((item) =>
        limit(async () => {
          if (visited.has(item.url)) return;
          visited.add(item.url);
          if (!shouldVisit(item.url, seed, options, robots)) {
            skipped += 1;
            options.onProgress?.({
              type: "skipped",
              url: item.url,
              fetched: documents.length,
              queued: queue.length,
              maxPages
            });
            return;
          }
          planned.push(item.url);
          options.onProgress?.({
            type: "fetch",
            url: item.url,
            fetched: documents.length,
            queued: queue.length,
            maxPages
          });
          try {
            const fetched = await fetchText(item.url, {
              allowPrivateNetwork: options.allowPrivateNetwork,
              sameOriginSeed: (options.sameOrigin ?? true) ? seed : undefined
            });
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
            let discovered = 0;
            if (item.depth < maxDepth) {
              const links =
                options.dryRun && contentType === "html"
                  ? extractRawHtmlLinks(fetched.text)
                  : doc.links;
              for (const link of links) {
                try {
                  const next = canonicalizeUrl(link.href, item.url);
                  if (
                    !queued.has(next) &&
                    shouldVisit(next, seed, options, robots) &&
                    (options.allowPrivateNetwork || !(await resolvesToPrivateNetwork(next))) &&
                    queued.size < maxPages * 4
                  ) {
                    queued.add(next);
                    queue.push({ url: next, depth: item.depth + 1 });
                    discovered += 1;
                  }
                } catch {
                  skipped += 1;
                }
              }
            }
            options.onProgress?.({
              type: "fetched",
              url: item.url,
              fetched: options.dryRun ? planned.length : documents.length,
              queued: queue.length,
              discovered,
              maxPages
            });
          } catch (error) {
            if (isSecurityRejection(error)) throw error;
            failed += 1;
            options.onProgress?.({
              type: "failed",
              url: item.url,
              fetched: documents.length,
              queued: queue.length,
              maxPages
            });
          }
        })
      )
    );
  }

  if (options.dryRun) {
    return {
      pagesFetched: planned.length,
      skipped,
      failed,
      written: [],
      documents: [],
      dryRunPages: planned.slice(0, maxPages)
    };
  }
  if (documents.length === 0) throw new Error("Crawl generated zero concepts.");
  options.onProgress?.({ type: "writing", concepts: documents.length, outDir: options.outDir });
  const written = await writeOkfBundle(documents, {
    outDir: options.outDir,
    title: options.title,
    sourceName: seed,
    force: options.force,
    dangerouslyAllowUnsafeOutput: options.dangerouslyAllowUnsafeOutput,
    timestamp: options.timestamp
  });
  return { pagesFetched: documents.length, skipped, failed, written, documents };
}
