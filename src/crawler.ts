import pLimit from "p-limit";
import { loadRobots, shouldVisit } from "./crawl/discovery.js";
import {
  contentTypeFromHeader,
  extractRawHtmlLinks,
  normalizeFetchedDocument
} from "./crawl/extraction.js";
import { fetchText, isSecurityRejection } from "./crawl/fetch-policy.js";
import type { CrawlOptions, CrawlResult } from "./crawl/types.js";
import { writeCrawlBundle } from "./crawl/write.js";
import {
  assertPublicNetworkUrl,
  canonicalizeUrl,
  isPrivateNetworkUrl,
  resolvesToPrivateNetwork
} from "./util/url.js";
import type { NormalizedDocument } from "./types.js";

export type { CrawlOptions, CrawlProgressEvent, CrawlResult } from "./crawl/types.js";

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
            const doc = normalizeFetchedDocument({
              url: item.url,
              contentType,
              text: fetched.text,
              discoveredAt: options.timestamp ?? new Date().toISOString()
            });
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
  const written = await writeCrawlBundle(documents, { ...options, seedUrl: seed });
  return { pagesFetched: documents.length, skipped, failed, written, documents };
}
