import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import {
  printCrawlProgress,
  printStats,
  printStatus,
  printValidation
} from "./cli-presenters.js";
import { crawlWebsite } from "./crawler.js";
import { importLocal } from "./importer.js";
import { inspectBundle, validateBundle } from "./validate.js";

export async function runCrawlCommand(url: string, options: any): Promise<void> {
  try {
    const result = await crawlWebsite({
      seedUrl: url,
      outDir: options.out,
      ...options,
      timestamp: options.stableTimestamps ? "2026-06-14T00:00:00.000Z" : undefined,
      onProgress: printCrawlProgress
    });
    if (options.dryRun) {
      console.log("okfy crawl dry run");
      for (const page of result.dryRunPages ?? []) console.log(page);
      return;
    }
    console.log("okfy crawl");
    console.log(`Seed: ${url}`);
    console.log(
      `Pages: ${result.pagesFetched} fetched, ${result.skipped} skipped, ${result.failed} failed`
    );
    console.log(`Concepts: ${result.documents.length} written`);
    console.log(`Output: ${options.out}`);
    console.log("\nNext:");
    console.log(`  okfy validate ${options.out}`);
    console.log(`  okfy serve ${options.out} --mcp`);
  } catch (error: any) {
    console.error(pc.red(error?.message ?? "Crawl failed."));
    process.exitCode = 1;
  }
}

export async function runImportCommand(input: string, options: any): Promise<void> {
  try {
    printStatus(`okfy import: reading ${input}`);
    printStatus(`okfy import: writing bundle to ${options.out}`);
    const result = await importLocal({
      inputPath: input,
      outDir: options.out,
      ...options,
      timestamp: options.stableTimestamps ? "2026-06-14T00:00:00.000Z" : undefined
    });
    console.log("okfy import");
    console.log(`Source: ${input}`);
    console.log(`Concepts: ${result.documents.length} written`);
    console.log(`Output: ${options.out}`);
    printStatus(`okfy import: done, wrote ${result.documents.length} concepts`);
  } catch (error: any) {
    console.error(pc.red(error?.message ?? "Import failed."));
    process.exitCode = 1;
  }
}

export async function runValidateCommand(bundle: string, options: any): Promise<void> {
  printStatus(`okfy validate: checking ${bundle}`);
  const report = await validateBundle(bundle);
  printValidation(report, options.json);
  printStatus(
    `okfy validate: ${report.valid ? "valid" : "invalid"}, ${report.conceptCount} concepts`
  );
  if (!report.valid) process.exitCode = 1;
}

export async function runInspectCommand(bundle: string): Promise<void> {
  try {
    printStatus(`okfy inspect: reading ${bundle}`);
    const stats = await inspectBundle(bundle);
    printStats(stats);
    printStatus(`okfy inspect: done, ${stats.conceptCount} concepts, ${stats.linkCount} links`);
  } catch (error: any) {
    console.error(pc.red(error?.message ?? "Inspect failed."));
    process.exitCode = 1;
  }
}

function resolveDemoBundle(packageRoot: string): string {
  const relativeBundle = "examples/bundles/okfy-docs";
  if (fs.existsSync(relativeBundle)) return relativeBundle;
  return path.join(packageRoot, relativeBundle);
}

export async function runDemoCommand(packageRoot: string): Promise<void> {
  const bundle = resolveDemoBundle(packageRoot);
  console.log("okfy demo");
  console.log(`Offline bundle: ${bundle}`);
  const report = await validateBundle(bundle);
  printValidation(report, false);
  if (!report.valid) {
    process.exitCode = 1;
    return;
  }
  console.log("");
  printStats(await inspectBundle(bundle));
  console.log("");
  console.log("MCP config:");
  console.log(
    JSON.stringify(
      {
        mcpServers: {
          "okfy-docs": { command: "npx", args: ["-y", "okfy-ai", "serve", bundle, "--mcp"] }
        }
      },
      null,
      2
    )
  );
  console.log("");
  console.log("Ask an agent:");
  console.log("1. Search okfy docs for crawler security defaults, then cite source concepts.");
  console.log("2. Read the MCP setup concept and explain the stdio config.");
  console.log("3. Find importer concepts and list supported input formats.");
}
