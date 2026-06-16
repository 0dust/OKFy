#!/usr/bin/env node
import {
  crawlWebsite,
  evaluateFreshness,
  hashBundleContents,
  importLocal,
  inspectBundle,
  listSources,
  parseDurationSeconds,
  readRefreshState,
  readSourceManifest,
  refreshSource,
  removeSource,
  resolveBundleDir,
  resolveSourceDir,
  serveMcpStdio,
  validateBundle,
  validateSourceName,
  writeRefreshState,
  writeSourceManifest
} from "./chunk-JA6B2QIM.js";

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
function duration(value) {
  return parseDurationSeconds(value);
}
function numberOption(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Expected a non-negative integer, received "${value}".`);
  return parsed;
}
function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}
async function pathExists(target) {
  try {
    await fs.promises.access(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
async function readStateIfExists(name) {
  try {
    return await readRefreshState(name);
  } catch (error) {
    if (error?.code === "ENOENT") return void 0;
    throw error;
  }
}
function emptyState(status, checkedAt) {
  return {
    schemaVersion: 1,
    status,
    lastCheckedAt: checkedAt,
    lastRefreshStartedAt: null,
    lastRefreshCompletedAt: null,
    lastSuccessfulRefreshAt: null,
    nextRefreshAllowedAt: null,
    refreshInProgress: false,
    lastError: null,
    bundle: null
  };
}
async function summarizeState(record, maxAgeSeconds) {
  const state = record.state;
  const now = /* @__PURE__ */ new Date();
  const decision = await evaluateFreshness({
    manifest: record.manifest,
    state,
    bundleDir: record.bundleDir,
    now,
    maxAgeSeconds
  });
  return {
    schemaVersion: 1,
    status: decision.status,
    lastCheckedAt: now.toISOString(),
    lastRefreshStartedAt: state?.lastRefreshStartedAt ?? null,
    lastRefreshCompletedAt: state?.lastRefreshCompletedAt ?? null,
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null,
    refreshInProgress: decision.status === "refreshing",
    lastError: state?.lastError ?? null,
    bundle: state?.bundle ?? (decision.validation ? {
      conceptCount: decision.validation.conceptCount,
      warningCount: decision.validation.warningCount,
      valid: decision.validation.valid,
      contentHash: ""
    } : null)
  };
}
function sourceRow(record, state) {
  return {
    name: record.name,
    kind: record.manifest.kind,
    seedUrl: record.manifest.source.seedUrl,
    status: state?.status ?? "missing",
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    conceptCount: state?.bundle?.conceptCount ?? null,
    warningCount: state?.bundle?.warningCount ?? null,
    valid: state?.bundle?.valid ?? false,
    lastError: state?.lastError ?? null,
    refreshInProgress: state?.refreshInProgress ?? false,
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null,
    bundlePath: record.bundleDir
  };
}
function printSourceRows(rows) {
  if (!rows.length) {
    console.log("No registered sources.");
    return;
  }
  for (const row of rows) {
    console.log(`${row.name} (${row.kind})`);
    console.log(`  URL: ${row.seedUrl}`);
    console.log(`  Status: ${row.status}`);
    console.log(`  Last success: ${row.lastSuccessfulRefreshAt ?? "never"}`);
    console.log(`  Concepts: ${row.conceptCount ?? "unknown"}`);
    console.log(`  Bundle: ${row.bundlePath}`);
  }
}
function refreshMode(value) {
  if (value === "off" || value === "stale-while-refresh" || value === "blocking") return value;
  throw new Error(`Invalid refresh mode "${value}". Use off, stale-while-refresh, or blocking.`);
}
function manifestFromOptions(name, seedUrl, options) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    schemaVersion: 1,
    okfyVersion: readPackageVersion(),
    name: validateSourceName(name),
    kind: "website",
    createdAt: now,
    updatedAt: now,
    source: {
      seedUrl: new URL(seedUrl).toString()
    },
    crawl: {
      maxPages: options.maxPages,
      maxDepth: options.maxDepth,
      include: options.include ?? [],
      exclude: options.exclude ?? [],
      sameOrigin: options.sameOrigin,
      respectRobots: options.respectRobots,
      concurrency: options.concurrency,
      allowPrivateNetwork: Boolean(options.allowPrivateNetwork)
    },
    refresh: {
      mode: options.refreshMode,
      maxAgeSeconds: options.maxAge,
      minIntervalSeconds: options.minRefreshInterval
    },
    bundle: {
      dir: options.out ? path.resolve(options.out) : "bundle"
    }
  };
}
async function runSourceRefresh(manifest, options = {}) {
  const state = await readStateIfExists(manifest.name);
  const sourceDir = resolveSourceDir(manifest.name);
  const bundleDir = resolveBundleDir(manifest);
  return refreshSource({
    manifest,
    state,
    sourceDir,
    bundleDir,
    force: options.force,
    dryRun: options.dryRun,
    inspectBundle,
    hashBundleContent: hashBundleContents,
    crawlRunner: (crawlOptions) => crawlWebsite({ ...crawlOptions, onProgress: printCrawlProgress }),
    writeState: (next) => writeRefreshState(manifest.name, next)
  });
}
async function registeredRecord(name) {
  const manifest = await readSourceManifest(name);
  const state = await readStateIfExists(name);
  return {
    name,
    dir: resolveSourceDir(name),
    manifest,
    state,
    bundleDir: resolveBundleDir(manifest)
  };
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
program.command("add").argument("<name>", "Local source name").argument("<url>", "Docs URL to crawl").option("--max-pages <n>", "Maximum pages", numberOption, 100).option("--max-depth <n>", "Maximum crawl depth", numberOption, 4).option("--include <pattern>", "Include glob or regex", collect, []).option("--exclude <pattern>", "Exclude glob or regex", collect, []).option("--same-origin", "Stay on same origin", true).option("--no-same-origin", "Allow cross-origin links").option("--respect-robots", "Respect robots.txt", true).option("--no-respect-robots", "Ignore robots.txt").option("--concurrency <n>", "Fetch concurrency", numberOption, 4).option("--allow-private-network", "Allow localhost/private IP crawl targets", false).option("--refresh-mode <mode>", "Refresh mode: off, stale-while-refresh, or blocking", refreshMode, "stale-while-refresh").option("--max-age <duration>", "Freshness max age", duration, 24 * 60 * 60).option("--min-refresh-interval <duration>", "Minimum interval between refresh attempts", duration, 15 * 60).option("--out <dir>", "Explicit active bundle directory").option("--force", "Overwrite an existing source registration", false).option("--json", "Print JSON output", false).action(async (name, url, options) => {
  try {
    const sourceDir = resolveSourceDir(name);
    if (await pathExists(sourceDir) && !options.force) {
      throw new Error(`Source "${name}" already exists. Use --force to overwrite it.`);
    }
    if (options.force) await removeSource(name);
    const manifest = manifestFromOptions(name, url, options);
    await writeSourceManifest(manifest);
    const result = await runSourceRefresh(manifest, { force: true });
    const bundlePath = resolveBundleDir(manifest);
    const payload = {
      name: manifest.name,
      status: result.state?.status ?? result.status,
      bundlePath,
      conceptCount: result.state?.bundle?.conceptCount ?? 0,
      warningCount: result.state?.bundle?.warningCount ?? 0,
      valid: result.state?.bundle?.valid ?? false,
      nextCommand: `okfy serve ${manifest.name} --mcp --auto-refresh`,
      error: result.error ?? null
    };
    if (options.json) printJson(payload);
    else {
      console.log(`Registered source: ${manifest.name}`);
      console.log(`Status: ${payload.status}`);
      console.log(`Concepts: ${payload.conceptCount}`);
      console.log(`Bundle: ${bundlePath}`);
      console.log("\nNext:");
      console.log(`  okfy sources`);
      console.log(`  ${payload.nextCommand}`);
    }
    if (result.status !== "fresh") process.exitCode = 1;
  } catch (error) {
    if (options.json) printJson({ status: "failed", error: { message: error?.message ?? "Add failed." } });
    else console.error(pc.red(error?.message ?? "Add failed."));
    process.exitCode = 1;
  }
});
program.command("sources").option("--json", "Print JSON output", false).action(async (options) => {
  try {
    const records = await listSources();
    const rows = await Promise.all(records.map(async (record) => sourceRow(record, await summarizeState(record))));
    if (options.json) printJson(rows);
    else printSourceRows(rows);
  } catch (error) {
    if (options.json) printJson({ error: { message: error?.message ?? "Sources failed." } });
    else console.error(pc.red(error?.message ?? "Sources failed."));
    process.exitCode = 1;
  }
});
program.command("check").argument("<name-or-bundle>", "Registered source name or OKF bundle directory").option("--max-age <duration>", "Override freshness max age", duration).option("--json", "Print JSON output", false).action(async (target, options) => {
  try {
    if (await pathExists(target)) {
      const [validation, stats] = await Promise.all([validateBundle(target), inspectBundle(target).catch(() => void 0)]);
      const payload2 = {
        target,
        registeredSource: false,
        status: validation.valid ? "fresh" : "failed",
        valid: validation.valid,
        conceptCount: validation.conceptCount,
        warningCount: validation.warningCount,
        stats
      };
      if (options.json) printJson(payload2);
      else {
        console.log(`Bundle: ${target}`);
        console.log(`Status: ${payload2.status}`);
        console.log(`Valid: ${payload2.valid}`);
        console.log(`Concepts: ${payload2.conceptCount}`);
      }
      if (!validation.valid) process.exitCode = 1;
      return;
    }
    const record = await registeredRecord(target);
    const nextState = await summarizeState(record, options.maxAge);
    await writeRefreshState(record.name, nextState);
    const payload = sourceRow(record, nextState);
    if (options.json) printJson(payload);
    else printSourceRows([payload]);
    if (nextState.status !== "fresh" || nextState.bundle?.valid !== true) process.exitCode = 1;
  } catch (error) {
    if (options.json) printJson({ status: "failed", error: { message: error?.message ?? "Check failed." } });
    else console.error(pc.red(error?.message ?? "Check failed."));
    process.exitCode = 2;
  }
});
program.command("update").argument("<name>", "Registered source name").option("--json", "Print JSON output", false).option("--dry-run", "Report what would be refreshed without replacing the active bundle", false).action(async (name, options) => {
  try {
    const manifest = await readSourceManifest(name);
    const oldState = await readStateIfExists(name);
    const result = await runSourceRefresh(manifest, { force: true, dryRun: options.dryRun });
    const bundlePath = resolveBundleDir(manifest);
    const payload = {
      name: manifest.name,
      status: result.state?.status ?? result.status,
      skipped: result.skipped,
      reason: result.reason ?? null,
      dryRun: Boolean(result.dryRun),
      oldConceptCount: oldState?.bundle?.conceptCount ?? null,
      newConceptCount: result.state?.bundle?.conceptCount ?? oldState?.bundle?.conceptCount ?? null,
      warningCount: result.state?.bundle?.warningCount ?? oldState?.bundle?.warningCount ?? null,
      bundlePath,
      dryRunPages: result.crawlResult?.dryRunPages,
      error: result.error ?? null
    };
    if (options.json) printJson(payload);
    else {
      console.log(`Updated source: ${manifest.name}`);
      console.log(`Status: ${payload.status}`);
      console.log(`Old concepts: ${payload.oldConceptCount ?? "unknown"}`);
      console.log(`New concepts: ${payload.newConceptCount ?? "unknown"}`);
      console.log(`Bundle: ${bundlePath}`);
      if (payload.error) console.log(`Error: ${payload.error.message}`);
    }
    if (result.status === "failed") process.exitCode = 1;
  } catch (error) {
    if (options.json) printJson({ status: "failed", error: { message: error?.message ?? "Update failed." } });
    else console.error(pc.red(error?.message ?? "Update failed."));
    process.exitCode = 1;
  }
});
program.command("remove").argument("<name>", "Registered source name").option("-y, --yes", "Skip confirmation", false).option("--keep-bundle", "Preserve explicit external bundle paths", false).option("--json", "Print JSON output", false).action(async (name, options) => {
  try {
    validateSourceName(name);
    if (!options.yes && !options.json) {
      throw new Error(`Refusing to remove "${name}" without --yes in non-interactive mode.`);
    }
    await removeSource(name);
    const payload = { removed: true, name };
    if (options.json) printJson(payload);
    else console.log(`Removed source: ${name}`);
  } catch (error) {
    if (options.json) printJson({ removed: false, name, error: { message: error?.message ?? "Remove failed." } });
    else console.error(pc.red(error?.message ?? "Remove failed."));
    process.exitCode = 1;
  }
});
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
program.command("serve").argument("<name-or-bundle>", "Registered source name or OKF bundle directory").option("--mcp", "Start MCP server", false).option("--transport <transport>", "Transport: stdio", "stdio").option("--name <server-name>", "MCP server name", "okfy").option("--max-result-chars <n>", "Maximum characters per tool result", (value) => Number(value), 12e3).option("--auto-refresh", "Enable registered source refresh behavior", false).option("--refresh-mode <mode>", "Refresh mode override: off, stale-while-refresh, or blocking", refreshMode).option("--max-age <duration>", "Override freshness max age", duration).action(async (target, options) => {
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
  if (await pathExists(target)) {
    printStatus(`okfy serve: loading ${target}`);
    printStatus(`okfy serve: starting MCP stdio server "${options.name}"`);
    await serveMcpStdio({ bundleDir: target, name: options.name, maxResultChars: options.maxResultChars });
    printStatus("okfy serve: ready on stdio (stdout is reserved for MCP JSON-RPC)");
    printStatus("okfy serve: tools bundle_summary, search_concepts, read_concept, get_neighbors, list_types, list_tags");
    return;
  }
  try {
    const manifest = await readSourceManifest(target);
    const bundleDir = resolveBundleDir(manifest);
    const mode = options.autoRefresh ? options.refreshMode ?? manifest.refresh.mode : "off";
    const maxAgeSeconds = options.maxAge;
    printStatus(`okfy serve: loading source ${manifest.name} from ${bundleDir}`);
    printStatus(`okfy serve: starting MCP stdio server "${options.name}"`);
    await serveMcpStdio({
      bundleDir,
      name: options.name,
      maxResultChars: options.maxResultChars,
      source: {
        name: manifest.name,
        kind: manifest.kind,
        seedUrl: manifest.source.seedUrl
      },
      refresh: {
        mode,
        getFreshness: async () => {
          const record = await registeredRecord(manifest.name);
          const nextState = await summarizeState(record, maxAgeSeconds);
          await writeRefreshState(manifest.name, nextState);
          return nextState;
        },
        refreshIfNeeded: async () => {
          const result = await runSourceRefresh(manifest, { force: false });
          return {
            bundleDir,
            freshness: result.state ?? await readStateIfExists(manifest.name) ?? emptyState(result.status, (/* @__PURE__ */ new Date()).toISOString())
          };
        }
      }
    });
    printStatus("okfy serve: ready on stdio (stdout is reserved for MCP JSON-RPC)");
    printStatus("okfy serve: tools bundle_summary, search_concepts, read_concept, get_neighbors, list_types, list_tags");
  } catch (error) {
    console.error(pc.red(error?.message ?? "Serve failed."));
    process.exitCode = 1;
  }
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
