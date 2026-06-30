import type { NormalizedDocument } from "../types.js";

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
