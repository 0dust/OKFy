import type { CrawlOptions, CrawlProgressEvent } from "./types.js";
import type { NormalizedDocument } from "../types.js";
import { writeOkfBundle } from "../writer.js";

export async function writeCrawlBundle(
  documents: NormalizedDocument[],
  options: CrawlOptions
): Promise<string[]> {
  if (documents.length === 0) throw new Error("Crawl generated zero concepts.");
  options.onProgress?.({
    type: "writing",
    concepts: documents.length,
    outDir: options.outDir
  } satisfies CrawlProgressEvent);
  return writeOkfBundle(documents, {
    outDir: options.outDir,
    title: options.title,
    sourceName: options.seedUrl,
    force: options.force,
    dangerouslyAllowUnsafeOutput: options.dangerouslyAllowUnsafeOutput,
    timestamp: options.timestamp
  });
}
