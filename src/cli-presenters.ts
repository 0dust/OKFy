import fs from "node:fs";
import path from "node:path";
import pc from "picocolors";
import type { CrawlProgressEvent } from "./crawler.js";
import type { SetupReport } from "./setup.js";
import type { inspectBundle, validateBundle } from "./validate.js";

const isTty = Boolean(process.stderr.isTTY);

function unicodeEscape(codePoint: number): string {
  return `\\u${codePoint.toString(16).padStart(4, "0")}`;
}

function escapeTerminalControls(value: string): string {
  let escaped = "";
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    escaped +=
      codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)
        ? unicodeEscape(codePoint)
        : character;
  }
  return escaped;
}

function terminalSafeJson(value: unknown): string | undefined {
  const serialized = JSON.stringify(value, null, 2);
  if (serialized === undefined) return undefined;
  let escaped = "";
  for (const character of serialized) {
    const codePoint = character.codePointAt(0)!;
    escaped += codePoint >= 0x7f && codePoint <= 0x9f ? unicodeEscape(codePoint) : character;
  }
  return escaped;
}

export function printJson(value: unknown): void {
  console.log(terminalSafeJson(value));
}

export function printSourceRows(rows: Array<Record<string, unknown>>): void {
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
    const lastError = row.lastError as { message?: string } | null;
    if (lastError?.message) console.log(`  Error: ${lastError.message}`);
  }
}

export function printValidation(
  report: Awaited<ReturnType<typeof validateBundle>>,
  json: boolean
): void {
  if (json) {
    printJson(report);
    return;
  }
  console.log(report.valid ? pc.green("OKF bundle valid") : pc.red("OKF bundle invalid"));
  console.log(`Concepts: ${report.conceptCount}`);
  for (const item of report.issues) {
    const color = item.severity === "error" ? pc.red : pc.yellow;
    const itemPath = item.path ? ` ${escapeTerminalControls(item.path)}` : "";
    console.log(
      `${color(item.severity.toUpperCase())} ${item.code}${itemPath}: ${escapeTerminalControls(item.message)}`
    );
  }
}

export function printStats(stats: Awaited<ReturnType<typeof inspectBundle>>): void {
  console.log(`Title: ${stats.title}`);
  console.log(`Concepts: ${stats.conceptCount}`);
  console.log(`Links: ${stats.linkCount}`);
  console.log(`Broken links: ${stats.brokenLinks}`);
  console.log(`Orphans: ${stats.orphanConcepts.length}`);
  console.log("Types:");
  for (const [type, count] of Object.entries(stats.typeDistribution))
    console.log(`  ${type}: ${count}`);
  console.log("Top linked concepts:");
  for (const item of stats.topLinkedConcepts.slice(0, 5))
    console.log(`  ${item.id}: ${item.count}`);
  if (Object.keys(stats.sourceDomains).length) {
    console.log("Source domains:");
    for (const [domain, count] of Object.entries(stats.sourceDomains))
      console.log(`  ${domain}: ${count}`);
  }
}

export function printStatus(message: string): void {
  process.stderr.write(`${message}\n`);
}

export async function writeFileAtomically(filePath: string, contents: string): Promise<void> {
  const resolved = path.resolve(filePath);
  const tempPath = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
  try {
    await fs.promises.writeFile(tempPath, contents, "utf8");
    await fs.promises.rename(tempPath, resolved);
  } catch (error) {
    await fs.promises.rm(tempPath, { force: true });
    throw error;
  }
}

export function printSetupReport(report: SetupReport, json: boolean): void {
  if (json) {
    printJson(report);
    return;
  }

  const color =
    report.status === "failed" ? pc.red : report.status === "warning" ? pc.yellow : pc.green;
  console.log(color(`Setup status: ${report.status}`));
  console.log(`${report.workspace ? "Sources" : "Source"}: ${report.sourceName}`);
  console.log(`OKFY_HOME: ${report.okfyHome}`);
  console.log("\nChecks:");
  for (const check of report.checks) {
    const label =
      check.severity === "fail"
        ? pc.red("FAIL")
        : check.severity === "warn"
          ? pc.yellow("WARN")
          : pc.green("PASS");
    console.log(`  ${label} ${check.label}: ${check.message}`);
    if (check.fix) console.log(`       Fix: ${check.fix}`);
  }
  console.log("\nMCP launch command:");
  console.log(`  ${report.command.display}`);
  if (Object.keys(report.command.env).length)
    console.log(`  env: ${JSON.stringify(report.command.env)}`);
  for (const artifact of report.artifacts) {
    console.log(`\n${artifact.label}:`);
    console.log(artifact.body);
  }
  console.log("\nFirst prompt:");
  console.log(report.firstPrompt);
}

export function printCrawlProgress(event: CrawlProgressEvent): void {
  const clear = isTty ? "\r\x1b[K" : "";
  switch (event.type) {
    case "start":
      process.stderr.write(
        `okfy crawl: starting ${event.seed} (max ${event.maxPages} pages, depth ${event.maxDepth})\n`
      );
      break;
    case "fetch":
      process.stderr.write(
        `${clear}okfy crawl: fetching ${event.fetched}/${event.maxPages}, queued ${event.queued}: ${event.url}`
      );
      if (!isTty) process.stderr.write("\n");
      break;
    case "fetched":
      process.stderr.write(
        `${clear}okfy crawl: fetched ${event.fetched}/${event.maxPages}, queued ${event.queued}, discovered +${event.discovered}: ${event.url}\n`
      );
      break;
    case "skipped":
      process.stderr.write(
        `${clear}okfy crawl: skipped ${event.fetched}/${event.maxPages}, queued ${event.queued}: ${event.url}\n`
      );
      break;
    case "failed":
      process.stderr.write(
        `${clear}okfy crawl: failed ${event.fetched}/${event.maxPages}, queued ${event.queued}: ${event.url}\n`
      );
      break;
    case "writing":
      process.stderr.write(
        `${clear}okfy crawl: writing ${event.concepts} concepts to ${event.outDir}\n`
      );
      break;
  }
}
