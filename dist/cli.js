#!/usr/bin/env node
import {
  crawlWebsite,
  importLocal,
  inspectBundle,
  serveMcpStdio,
  validateBundle
} from "./chunk-QE5W5AJS.js";

// src/cli.ts
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Command } from "commander";
import pc from "picocolors";
var program = new Command();
var packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
var isTty = Boolean(process.stderr.isTTY);
function readPackageVersion() {
  try {
    const raw = fs.readFileSync(path.join(packageRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw);
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}
function collect(value, previous) {
  previous.push(value);
  return previous;
}
function printValidation(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(report.valid ? pc.green("OKF bundle valid") : pc.red("OKF bundle invalid"));
  console.log(`Concepts: ${report.conceptCount}`);
  for (const item of report.issues) {
    const color = item.severity === "error" ? pc.red : pc.yellow;
    console.log(`${color(item.severity.toUpperCase())} ${item.code}${item.path ? ` ${item.path}` : ""}: ${item.message}`);
  }
}
function printStats(stats) {
  console.log(`Title: ${stats.title}`);
  console.log(`Concepts: ${stats.conceptCount}`);
  console.log(`Links: ${stats.linkCount}`);
  console.log(`Broken links: ${stats.brokenLinks}`);
  console.log(`Orphans: ${stats.orphanConcepts.length}`);
  console.log("Types:");
  for (const [type, count] of Object.entries(stats.typeDistribution)) console.log(`  ${type}: ${count}`);
  console.log("Top linked concepts:");
  for (const item of stats.topLinkedConcepts.slice(0, 5)) console.log(`  ${item.id}: ${item.count}`);
  if (Object.keys(stats.sourceDomains).length) {
    console.log("Source domains:");
    for (const [domain, count] of Object.entries(stats.sourceDomains)) console.log(`  ${domain}: ${count}`);
  }
}
function printStatus(message) {
  process.stderr.write(`${message}
`);
}
function printCrawlProgress(event) {
  const clear = isTty ? "\r\x1B[K" : "";
  switch (event.type) {
    case "start":
      process.stderr.write(`okfy crawl: starting ${event.seed} (max ${event.maxPages} pages, depth ${event.maxDepth})
`);
      break;
    case "fetch":
      process.stderr.write(`${clear}okfy crawl: fetching ${event.fetched}/${event.maxPages}, queued ${event.queued}: ${event.url}`);
      if (!isTty) process.stderr.write("\n");
      break;
    case "fetched":
      process.stderr.write(
        `${clear}okfy crawl: fetched ${event.fetched}/${event.maxPages}, queued ${event.queued}, discovered +${event.discovered}: ${event.url}
`
      );
      break;
    case "skipped":
      process.stderr.write(`${clear}okfy crawl: skipped ${event.fetched}/${event.maxPages}, queued ${event.queued}: ${event.url}
`);
      break;
    case "failed":
      process.stderr.write(`${clear}okfy crawl: failed ${event.fetched}/${event.maxPages}, queued ${event.queued}: ${event.url}
`);
      break;
    case "writing":
      process.stderr.write(`${clear}okfy crawl: writing ${event.concepts} concepts to ${event.outDir}
`);
      break;
  }
}
program.name("okfy").description("Turn docs into agent memory with Open Knowledge Format and MCP.").version(readPackageVersion());
program.command("crawl").argument("<url>", "Docs URL to crawl").requiredOption("--out <dir>", "Output OKF bundle directory").option("--max-pages <n>", "Maximum pages", (value) => Number(value), 100).option("--max-depth <n>", "Maximum crawl depth", (value) => Number(value), 4).option("--include <pattern>", "Include glob or regex", collect, []).option("--exclude <pattern>", "Exclude glob or regex", collect, []).option("--same-origin", "Stay on same origin", true).option("--no-same-origin", "Allow cross-origin links").option("--respect-robots", "Respect robots.txt", true).option("--no-respect-robots", "Ignore robots.txt").option("--concurrency <n>", "Fetch concurrency", (value) => Number(value), 4).option("--title <name>", "Bundle title").option("--force", "Overwrite output directory", false).option("--dry-run", "List pages that would be crawled", false).option("--allow-private-network", "Allow localhost/private IP crawl targets", false).option("--dangerously-allow-unsafe-output", "Dangerously allow --force to delete otherwise unsafe output paths", false).option("--stable-timestamps", "Use a deterministic timestamp in generated frontmatter", false).action(async (url, options) => {
  try {
    const result = await crawlWebsite({
      seedUrl: url,
      outDir: options.out,
      ...options,
      timestamp: options.stableTimestamps ? "2026-06-14T00:00:00.000Z" : void 0,
      onProgress: printCrawlProgress
    });
    if (options.dryRun) {
      console.log("okfy crawl dry run");
      for (const page of result.dryRunPages ?? []) console.log(page);
      return;
    }
    console.log("okfy crawl");
    console.log(`Seed: ${url}`);
    console.log(`Pages: ${result.pagesFetched} fetched, ${result.skipped} skipped, ${result.failed} failed`);
    console.log(`Concepts: ${result.documents.length} written`);
    console.log(`Output: ${options.out}`);
    console.log("\nNext:");
    console.log(`  okfy validate ${options.out}`);
    console.log(`  okfy serve ${options.out} --mcp`);
  } catch (error) {
    console.error(pc.red(error?.message ?? "Crawl failed."));
    process.exitCode = 1;
  }
});
program.command("import").argument("<path>", "Local docs folder or file").requiredOption("--out <dir>", "Output OKF bundle directory").option("--source-name <name>", "Source name").option("--include <glob>", "Include glob", collect, []).option("--exclude <glob>", "Exclude glob", collect, []).option("--force", "Overwrite output directory", false).option("--dangerously-allow-unsafe-output", "Dangerously allow --force to delete otherwise unsafe output paths", false).option("--stable-timestamps", "Use a deterministic timestamp in generated frontmatter", false).action(async (input, options) => {
  try {
    printStatus(`okfy import: reading ${input}`);
    printStatus(`okfy import: writing bundle to ${options.out}`);
    const result = await importLocal({
      inputPath: input,
      outDir: options.out,
      ...options,
      timestamp: options.stableTimestamps ? "2026-06-14T00:00:00.000Z" : void 0
    });
    console.log("okfy import");
    console.log(`Source: ${input}`);
    console.log(`Concepts: ${result.documents.length} written`);
    console.log(`Output: ${options.out}`);
    printStatus(`okfy import: done, wrote ${result.documents.length} concepts`);
  } catch (error) {
    console.error(pc.red(error?.message ?? "Import failed."));
    process.exitCode = 1;
  }
});
program.command("validate").argument("<bundle>", "OKF bundle directory").option("--json", "Print JSON report", false).action(async (bundle, options) => {
  printStatus(`okfy validate: checking ${bundle}`);
  const report = await validateBundle(bundle);
  printValidation(report, options.json);
  printStatus(`okfy validate: ${report.valid ? "valid" : "invalid"}, ${report.conceptCount} concepts`);
  if (!report.valid) process.exitCode = 1;
});
program.command("inspect").argument("<bundle>", "OKF bundle directory").action(async (bundle) => {
  try {
    printStatus(`okfy inspect: reading ${bundle}`);
    const stats = await inspectBundle(bundle);
    printStats(stats);
    printStatus(`okfy inspect: done, ${stats.conceptCount} concepts, ${stats.linkCount} links`);
  } catch (error) {
    console.error(pc.red(error?.message ?? "Inspect failed."));
    process.exitCode = 1;
  }
});
program.command("serve").argument("<bundle>", "OKF bundle directory").option("--mcp", "Start MCP server", false).option("--transport <transport>", "Transport: stdio", "stdio").option("--name <server-name>", "MCP server name", "okfy").option("--max-result-chars <n>", "Maximum characters per tool result", (value) => Number(value), 12e3).action(async (bundle, options) => {
  if (!options.mcp) {
    console.error(pc.red("Only --mcp mode is supported in v0.1."));
    process.exitCode = 1;
    return;
  }
  if (options.transport !== "stdio") {
    console.error(pc.red("Only stdio transport is supported in v0.1."));
    process.exitCode = 1;
    return;
  }
  printStatus(`okfy serve: loading ${bundle}`);
  printStatus(`okfy serve: starting MCP stdio server "${options.name}"`);
  await serveMcpStdio({ bundleDir: bundle, name: options.name, maxResultChars: options.maxResultChars });
  printStatus("okfy serve: ready on stdio (stdout is reserved for MCP JSON-RPC)");
  printStatus("okfy serve: tools bundle_summary, search_concepts, read_concept, get_neighbors, list_types, list_tags");
});
function resolveDemoBundle() {
  const relativeBundle = "examples/bundles/okfy-docs";
  if (fs.existsSync(relativeBundle)) return relativeBundle;
  return path.join(packageRoot, relativeBundle);
}
program.command("demo").description("Run offline demo against committed example bundle").action(async () => {
  const bundle = resolveDemoBundle();
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
      { mcpServers: { "okfy-docs": { command: "npx", args: ["-y", "okfy-ai", "serve", bundle, "--mcp"] } } },
      null,
      2
    )
  );
  console.log("");
  console.log("Ask an agent:");
  console.log("1. Search okfy docs for crawler security defaults, then cite source concepts.");
  console.log("2. Read the MCP setup concept and explain the stdio config.");
  console.log("3. Find importer concepts and list supported input formats.");
});
program.parseAsync(process.argv);
