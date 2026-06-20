#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Command } from "commander";
import pc from "picocolors";
import { crawlWebsite, type CrawlProgressEvent } from "./crawler.js";
import { parseDurationSeconds } from "./duration.js";
import { hashBundleContents } from "./hash.js";
import { importLocal } from "./importer.js";
import { MCP_TOOL_NAMES, serveMcpStdio, serveWorkspaceMcpStdio, type RefreshHooks } from "./mcp.js";
import { evaluateFreshness, refreshSource } from "./refresh.js";
import {
  createSetupReport,
  defaultOkfyHome,
  executableOnPath,
  parseSetupClient,
  probeMcpStdio,
  serveCommand,
  serveCommandArgs,
  setupCheck,
  type McpProbeResult,
  type ServeCommandTarget,
  type SetupCheck,
  type SetupClient,
  type SetupReport
} from "./setup.js";
import {
  listSources,
  readRefreshState,
  readSourceManifest,
  removeSource,
  resolveBundleDir,
  resolveOkfyHome,
  resolveSourceDir,
  validateSourceName,
  writeRefreshState,
  writeSourceManifest,
  type RefreshMode,
  type RefreshState,
  type SourceManifest,
  type SourceRecord
} from "./source-store.js";
import { inspectBundle, validateBundle } from "./validate.js";
import { resolveWorkspaceSources, type WorkspaceSourceRecord } from "./workspace.js";

const program = new Command();
const cliPath = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(cliPath), "..");
const isTty = Boolean(process.stderr.isTTY);

function readPackageVersion(): string {
  try {
    const raw = fs.readFileSync(path.join(packageRoot, "package.json"), "utf8");
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function duration(value: string): number {
  return parseDurationSeconds(value);
}

function numberOption(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Expected a non-negative integer, received "${value}".`);
  return parsed;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.promises.access(target);
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function pathLikeTarget(target: string): boolean {
  return path.isAbsolute(target) || target === "." || target === ".." || target.startsWith("./") || target.startsWith("../") || target.includes("/") || target.includes("\\");
}

async function registeredSourceDirExists(name: string): Promise<boolean> {
  try {
    return await pathExists(resolveSourceDir(name));
  } catch {
    return false;
  }
}

async function serveBundleTarget(target: string, options: { name: string; maxResultChars: number }): Promise<void> {
  printStatus(`okfy serve: loading ${target}`);
  printStatus(`okfy serve: starting MCP stdio server "${options.name}"`);
  await serveMcpStdio({ bundleDir: target, name: options.name, maxResultChars: options.maxResultChars });
  printStatus("okfy serve: ready on stdio (stdout is reserved for MCP JSON-RPC)");
  printStatus(`okfy serve: tools ${MCP_TOOL_NAMES.join(", ")}`);
}

function bundleSourceName(bundleDir: string): string {
  const baseName = path.basename(path.resolve(bundleDir));
  const candidate = baseName
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return validateSourceName(candidate || "bundle");
}

function localBundleRecord(bundleDir: string): WorkspaceSourceRecord {
  const resolved = path.resolve(bundleDir);
  const name = bundleSourceName(resolved);
  const timestamp = "1970-01-01T00:00:00.000Z";
  return {
    name,
    dir: resolved,
    bundleDir: resolved,
    manifest: {
      schemaVersion: 1,
      okfyVersion: readPackageVersion(),
      name,
      kind: "local",
      createdAt: timestamp,
      updatedAt: timestamp,
      source: {
        seedUrl: pathToFileURL(resolved).href
      },
      crawl: {
        maxPages: 0,
        maxDepth: 0,
        include: [],
        exclude: [],
        sameOrigin: true,
        respectRobots: true,
        concurrency: 1,
        allowPrivateNetwork: false
      },
      refresh: {
        mode: "off",
        maxAgeSeconds: 0,
        minIntervalSeconds: 0
      },
      bundle: {
        dir: resolved
      }
    }
  };
}

function assertUniqueWorkspaceRecordNames(records: WorkspaceSourceRecord[]): void {
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.name)) throw new Error(`Duplicate workspace source "${record.name}". Rename one bundle directory or source.`);
    seen.add(record.name);
  }
}

function isRegisteredWorkspaceRecord(record: WorkspaceSourceRecord): record is SourceRecord {
  return record.manifest.kind === "website";
}

async function readStateIfExists(name: string): Promise<RefreshState | undefined> {
  try {
    return await readRefreshState(name);
  } catch (error: any) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function emptyState(status: RefreshState["status"], checkedAt: string): RefreshState {
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

async function summarizeState(record: SourceRecord, maxAgeSeconds?: number): Promise<RefreshState> {
  const state = record.state;
  const now = new Date();
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
    bundle: decision.validation
      ? {
          conceptCount: decision.validation.conceptCount,
          warningCount: decision.validation.warningCount,
          valid: decision.validation.valid,
          contentHash: await hashBundleContents(record.bundleDir)
        }
      : decision.status === "missing"
        ? null
        : (state?.bundle ?? null)
  };
}

function sourceRow(record: SourceRecord, state: RefreshState | undefined): Record<string, unknown> {
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

function printSourceRows(rows: Array<Record<string, unknown>>): void {
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

function refreshMode(value: string): RefreshMode {
  if (value === "off" || value === "stale-while-refresh" || value === "blocking") return value;
  throw new Error(`Invalid refresh mode "${value}". Use off, stale-while-refresh, or blocking.`);
}

function setupClient(value: string): SetupClient {
  return parseSetupClient(value);
}

function manifestFromOptions(name: string, seedUrl: string, options: any): SourceManifest {
  const now = new Date().toISOString();
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

function addSourceRegistrationOptions(command: Command): Command {
  return command
    .option("--max-pages <n>", "Maximum pages", numberOption, 100)
    .option("--max-depth <n>", "Maximum crawl depth", numberOption, 4)
    .option("--include <pattern>", "Include glob or regex", collect, [])
    .option("--exclude <pattern>", "Exclude glob or regex", collect, [])
    .option("--same-origin", "Stay on same origin", true)
    .option("--no-same-origin", "Allow cross-origin links")
    .option("--respect-robots", "Respect robots.txt", true)
    .option("--no-respect-robots", "Ignore robots.txt")
    .option("--concurrency <n>", "Fetch concurrency", numberOption, 4)
    .option("--allow-private-network", "Allow localhost/private IP crawl targets", false)
    .option("--refresh-mode <mode>", "Refresh mode: off, stale-while-refresh, or blocking", refreshMode, "stale-while-refresh")
    .option("--max-age <duration>", "Freshness max age", duration, 24 * 60 * 60)
    .option("--min-refresh-interval <duration>", "Minimum interval between refresh attempts", duration, 15 * 60)
    .option("--out <dir>", "Explicit active bundle directory")
    .option("--force", "Overwrite an existing source registration", false);
}

async function registerWebsiteSource(name: string, url: string, options: any) {
  const manifest = manifestFromOptions(name, url, options);
  const sourceDir = resolveSourceDir(manifest.name);
  if ((await pathExists(sourceDir)) && !options.force) {
    throw new Error(`Source "${manifest.name}" already exists. Use --force to overwrite it.`);
  }

  let backupDir: string | undefined;
  if (options.force && (await pathExists(sourceDir))) {
    backupDir = `${sourceDir}.backup-${process.pid}-${Date.now()}`;
    await fs.promises.rename(sourceDir, backupDir);
  }

  try {
    await writeSourceManifest(manifest);
    const result = await runSourceRefresh(manifest, { force: true });
    if (result.status === "fresh") {
      if (backupDir) await fs.promises.rm(backupDir, { recursive: true, force: true });
      return { manifest, result };
    }
    if (backupDir) {
      await restoreSourceBackup(sourceDir, backupDir);
      throw new Error(result.error?.message ?? `Refresh failed for source "${manifest.name}".`);
    }
    return { manifest, result };
  } catch (error) {
    if (backupDir) await restoreSourceBackup(sourceDir, backupDir);
    throw error;
  }
}

async function restoreSourceBackup(sourceDir: string, backupDir: string): Promise<void> {
  await fs.promises.rm(sourceDir, { recursive: true, force: true });
  if (await pathExists(backupDir)) await fs.promises.rename(backupDir, sourceDir);
}

async function runSourceRefresh(manifest: SourceManifest, options: { force?: boolean; dryRun?: boolean } = {}) {
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

async function registeredRecord(name: string): Promise<SourceRecord> {
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

function mcpRefreshHooksForRecord(record: SourceRecord, mode: RefreshMode, maxAgeSeconds?: number): RefreshHooks {
  return {
    mode,
    getFreshness: async () => {
      const latest = await registeredRecord(record.name);
      const nextState = await summarizeState(latest, maxAgeSeconds);
      await writeRefreshState(record.name, nextState);
      return nextState;
    },
    refreshIfNeeded: async () => {
      const latestManifest = await readSourceManifest(record.name);
      const result = await runSourceRefresh(latestManifest, { force: false });
      const bundleDir = resolveBundleDir(latestManifest);
      return {
        bundleDir,
        freshness: result.state ?? (await readStateIfExists(record.name)) ?? emptyState(result.status, new Date().toISOString())
      };
    }
  };
}

function printValidation(report: Awaited<ReturnType<typeof validateBundle>>, json: boolean): void {
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

function printStats(stats: Awaited<ReturnType<typeof inspectBundle>>): void {
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

function printStatus(message: string): void {
  process.stderr.write(`${message}\n`);
}

function setupHomeCheck(okfyHome: string): SetupCheck {
  const defaultHome = defaultOkfyHome();
  if (path.resolve(okfyHome) === path.resolve(defaultHome)) {
    return setupCheck("source_home", "Source store", "pass", `Using default OKFY_HOME ${okfyHome}.`);
  }
  return setupCheck(
    "source_home",
    "Source store",
    "pass",
    `Using non-default OKFY_HOME ${okfyHome}; generated configs include this environment override.`
  );
}

function setupFreshnessCheck(record: SourceRecord, state: RefreshState): SetupCheck {
  if (state.status === "fresh" && state.bundle?.valid === true) {
    return setupCheck(
      "freshness",
      "Freshness",
      "pass",
      `Source "${record.name}" is fresh with ${state.bundle.conceptCount} concepts.`
    );
  }
  if (state.status === "stale") {
    return setupCheck(
      "freshness",
      "Freshness",
      "warn",
      `Source "${record.name}" is stale.`,
      `Run npx -y okfy-ai update ${record.name}, or keep --auto-refresh enabled in the MCP config.`
    );
  }
  if (state.status === "refreshing") {
    return setupCheck(
      "freshness",
      "Freshness",
      "warn",
      `Source "${record.name}" is already refreshing.`,
      `Wait for the current refresh to finish, then run npx -y okfy-ai doctor ${record.name}.`
    );
  }
  return setupCheck(
    "freshness",
    "Freshness",
    "fail",
    state.lastError?.message ?? `Source "${record.name}" is ${state.status}.`,
    `Run npx -y okfy-ai update ${record.name}.`
  );
}

async function setupBundleCheck(bundleDir: string): Promise<SetupCheck> {
  try {
    const validation = await validateBundle(bundleDir);
    if (validation.valid) {
      return setupCheck("bundle", "Bundle validation", "pass", `Bundle is valid with ${validation.conceptCount} concepts.`);
    }
    const firstIssue = validation.issues[0];
    return setupCheck(
      "bundle",
      "Bundle validation",
      "fail",
      firstIssue ? `${firstIssue.code}: ${firstIssue.message}` : "Bundle validation failed.",
      "Run npx -y okfy-ai check <source> --json for validation details."
    );
  } catch (error: any) {
    return setupCheck(
      "bundle",
      "Bundle validation",
      "fail",
      error?.message ?? "Bundle validation failed.",
      "Run npx -y okfy-ai update <source> to rebuild the bundle."
    );
  }
}

async function setupNpxCheck(): Promise<SetupCheck> {
  const fix =
    "Install Node.js >=20 with npm/npx, use an absolute npx path, or switch the config to an installed okfy command.";
  if (!(await executableOnPath("npx"))) {
    return setupCheck("npx", "npx availability", "fail", "`npx` was not found on PATH, but generated MCP configs use npx by default.", fix);
  }
  const health = await commandHealth("npx", ["--version"], process.env);
  if (!health.ok) {
    return setupCheck("npx", "npx availability", "fail", `\`npx\` was found but failed to run: ${health.message}`, fix);
  }
  return setupCheck("npx", "npx availability", "pass", `\`npx\` is available on PATH (${health.message}).`);
}

function setupMcpProbeCheck(probe: McpProbeResult): SetupCheck {
  if (probe.ok) {
    return setupCheck("mcp_probe", "MCP stdio probe", "pass", `MCP tools visible: ${probe.tools.join(", ")}.`);
  }
  const message = probe.error?.message ?? "MCP probe failed.";
  const fix =
    probe.error?.code === "stdout_contamination"
      ? "Move human logs to stderr so stdout contains only MCP JSON-RPC messages."
      : "Run the generated serve command in your MCP client, then rerun doctor with the same OKFY_HOME.";
  return setupCheck("mcp_probe", "MCP stdio probe", "fail", message, fix);
}

async function runSetupProbe(sourceNameOrNames: ServeCommandTarget, timeoutSeconds: number): Promise<McpProbeResult> {
  const command = serveCommand(sourceNameOrNames, resolveOkfyHome());
  return probeMcpStdio({
    command: process.execPath,
    args: [cliPath, ...serveCommandArgs(sourceNameOrNames)],
    env: { ...process.env, ...command.env },
    timeoutMs: timeoutSeconds * 1000
  });
}

async function commandHealth(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { env, timeout: 3000 }, (error, stdout, stderr) => {
      const message = (stderr || stdout || (error instanceof Error ? error.message : String(error ?? ""))).trim();
      if (error) resolve({ ok: false, message: message || "command failed" });
      else resolve({ ok: true, message: message || "ok" });
    });
  });
}

async function setupReportForRecord(options: {
  record: SourceRecord;
  client: SetupClient;
  maxAge?: number;
  probeTimeoutSeconds: number;
}): Promise<SetupReport> {
  const state = await summarizeState(options.record, options.maxAge);
  await writeRefreshState(options.record.name, state);
  const bundleCheck = await setupBundleCheck(options.record.bundleDir);
  const npxCheck = await setupNpxCheck();
  const checks: SetupCheck[] = [
    setupCheck("source", "Registered source", "pass", `Source "${options.record.name}" exists.`),
    setupHomeCheck(resolveOkfyHome()),
    bundleCheck,
    setupFreshnessCheck(options.record, state),
    npxCheck
  ];
  if (bundleCheck.severity === "fail" || npxCheck.severity === "fail") {
    checks.push(
      setupCheck(
        "mcp_probe",
        "MCP stdio probe",
        "warn",
        "Skipped MCP probe because setup prerequisites failed.",
        "Fix the failed checks above, then rerun doctor."
      )
    );
  } else {
    checks.push(setupMcpProbeCheck(await runSetupProbe(options.record.name, options.probeTimeoutSeconds)));
  }
  return createSetupReport({
    sourceName: options.record.name,
    client: options.client,
    okfyHome: resolveOkfyHome(),
    checks
  });
}

async function setupReportForWorkspace(options: {
  records: SourceRecord[];
  client: SetupClient;
  maxAge?: number;
  probeTimeoutSeconds: number;
  all?: boolean;
}): Promise<SetupReport> {
  const sourceNames = options.records.map((record) => record.name);
  const commandTarget: ServeCommandTarget = options.all ? { all: true } : sourceNames;
  const states = await Promise.all(
    options.records.map(async (record) => {
      const state = await summarizeState(record, options.maxAge);
      await writeRefreshState(record.name, state);
      return { record, state };
    })
  );
  const bundleChecks = await Promise.all(
    options.records.map(async (record) => namespaceWorkspaceCheck(await setupBundleCheck(record.bundleDir), record.name))
  );
  const freshnessChecks = states.map(({ record, state }) => namespaceWorkspaceCheck(setupFreshnessCheck(record, state), record.name));
  const npxCheck = await setupNpxCheck();
  const checks: SetupCheck[] = [
    setupCheck("source", "Registered sources", "pass", `Workspace sources exist: ${sourceNames.join(", ")}.`),
    setupHomeCheck(resolveOkfyHome()),
    ...bundleChecks,
    ...freshnessChecks,
    npxCheck
  ];
  if (bundleChecks.some((check) => check.severity === "fail") || npxCheck.severity === "fail") {
    checks.push(
      setupCheck(
        "mcp_probe",
        "MCP stdio probe",
        "warn",
        "Skipped workspace MCP probe because setup prerequisites failed.",
        "Fix the failed checks above, then rerun doctor."
      )
    );
  } else {
    checks.push(setupMcpProbeCheck(await runSetupProbe(commandTarget, options.probeTimeoutSeconds)));
  }
  return createSetupReport({
    sourceNames,
    workspaceAll: options.all,
    client: options.client,
    okfyHome: resolveOkfyHome(),
    checks
  });
}

function namespaceWorkspaceCheck(check: SetupCheck, sourceName: string): SetupCheck {
  return {
    ...check,
    id: `${check.id}:${sourceName}`,
    label: `${check.label} (${sourceName})`
  };
}

function setupReportForMissingSource(name: string, client: SetupClient, error: unknown): SetupReport {
  const message = error instanceof Error ? error.message : `Source "${name}" was not found.`;
  return createSetupReport({
    sourceName: name,
    client,
    okfyHome: resolveOkfyHome(),
    checks: [
      setupCheck(
        "source",
        "Registered source",
        "fail",
        message,
        `Run npx -y okfy-ai sources to list sources in this OKFY_HOME, or run npx -y okfy-ai init ${name} <docs-url> --client generic.`
      ),
      setupHomeCheck(resolveOkfyHome())
    ]
  });
}

function setupReportForMissingWorkspace(names: string[], client: SetupClient, error: unknown, all = false): SetupReport {
  const sourceNames = all ? names : names.length ? names : ["workspace"];
  const message = error instanceof Error ? error.message : "Workspace sources were not found.";
  return createSetupReport({
    sourceNames,
    workspaceAll: all,
    client,
    okfyHome: resolveOkfyHome(),
    checks: [
      setupCheck(
        "source",
        "Registered sources",
        "fail",
        message,
        "Run npx -y okfy-ai sources to list sources in this OKFY_HOME, then rerun doctor with known source names."
      ),
      setupHomeCheck(resolveOkfyHome())
    ]
  });
}

function setupReportForInitFailure(name: string, client: SetupClient, error: unknown): SetupReport {
  const message = error instanceof Error ? error.message : "Init failed.";
  return createSetupReport({
    sourceName: name,
    client,
    okfyHome: resolveOkfyHome(),
    checks: [
      setupCheck(
        "source",
        "Registered source",
        "fail",
        message,
        `Check the source name and URL, then rerun npx -y okfy-ai init ${name} <docs-url>.`
      ),
      setupHomeCheck(resolveOkfyHome())
    ]
  });
}

function printSetupReport(report: SetupReport, json: boolean): void {
  if (json) {
    printJson(report);
    return;
  }

  const color = report.status === "failed" ? pc.red : report.status === "warning" ? pc.yellow : pc.green;
  console.log(color(`Setup status: ${report.status}`));
  console.log(`${report.workspace ? "Sources" : "Source"}: ${report.sourceName}`);
  console.log(`OKFY_HOME: ${report.okfyHome}`);
  console.log("\nChecks:");
  for (const check of report.checks) {
    const label = check.severity === "fail" ? pc.red("FAIL") : check.severity === "warn" ? pc.yellow("WARN") : pc.green("PASS");
    console.log(`  ${label} ${check.label}: ${check.message}`);
    if (check.fix) console.log(`       Fix: ${check.fix}`);
  }
  console.log("\nMCP launch command:");
  console.log(`  ${report.command.display}`);
  if (Object.keys(report.command.env).length) console.log(`  env: ${JSON.stringify(report.command.env)}`);
  for (const artifact of report.artifacts) {
    console.log(`\n${artifact.label}:`);
    console.log(artifact.body);
  }
  console.log("\nFirst prompt:");
  console.log(report.firstPrompt);
}

function printCrawlProgress(event: CrawlProgressEvent): void {
  const clear = isTty ? "\r\x1b[K" : "";
  switch (event.type) {
    case "start":
      process.stderr.write(`okfy crawl: starting ${event.seed} (max ${event.maxPages} pages, depth ${event.maxDepth})\n`);
      break;
    case "fetch":
      process.stderr.write(`${clear}okfy crawl: fetching ${event.fetched}/${event.maxPages}, queued ${event.queued}: ${event.url}`);
      if (!isTty) process.stderr.write("\n");
      break;
    case "fetched":
      process.stderr.write(
        `${clear}okfy crawl: fetched ${event.fetched}/${event.maxPages}, queued ${event.queued}, discovered +${event.discovered}: ${event.url}\n`
      );
      break;
    case "skipped":
      process.stderr.write(`${clear}okfy crawl: skipped ${event.fetched}/${event.maxPages}, queued ${event.queued}: ${event.url}\n`);
      break;
    case "failed":
      process.stderr.write(`${clear}okfy crawl: failed ${event.fetched}/${event.maxPages}, queued ${event.queued}: ${event.url}\n`);
      break;
    case "writing":
      process.stderr.write(`${clear}okfy crawl: writing ${event.concepts} concepts to ${event.outDir}\n`);
      break;
  }
}

program
  .name("okfy")
  .description("Turn docs into agent memory with Open Knowledge Format and MCP.")
  .version(readPackageVersion());

const initCommand = program
  .command("init")
  .argument("<name>", "Local source name")
  .argument("<url>", "Docs URL to crawl")
  .option("--client <client>", "Target client: claude-code, claude-desktop, cursor, codex, or generic", setupClient, parseSetupClient("generic"));

addSourceRegistrationOptions(initCommand)
  .option("--probe-timeout <duration>", "MCP setup probe timeout", duration, 5)
  .option("--json", "Print JSON output", false)
  .action(async (name, url, options) => {
    try {
      const { manifest } = await registerWebsiteSource(name, url, options);
      const report = await setupReportForRecord({
        record: await registeredRecord(manifest.name),
        client: options.client,
        maxAge: options.maxAge,
        probeTimeoutSeconds: options.probeTimeout
      });
      printSetupReport(report, options.json);
      if (report.status === "failed") process.exitCode = 1;
    } catch (error: any) {
      if (options.json) printSetupReport(setupReportForInitFailure(name, options.client, error), true);
      else console.error(pc.red(error?.message ?? "Init failed."));
      process.exitCode = 1;
    }
  });

program
  .command("doctor")
  .argument("[names...]", "Registered source name(s)")
  .option("--all", "Check all registered sources as one workspace", false)
  .option("--client <client>", "Target client: claude-code, claude-desktop, cursor, codex, or generic", setupClient, parseSetupClient("generic"))
  .option("--max-age <duration>", "Override freshness max age", duration)
  .option("--probe-timeout <duration>", "MCP setup probe timeout", duration, 5)
  .option("--json", "Print JSON output", false)
  .action(async (names: string[] = [], options) => {
    try {
      if (options.all && names.length > 0) {
        throw new Error("Use either --all or explicit source names, not both.");
      }
      if (options.all || names.length > 1) {
        const sourceSet = await resolveWorkspaceSources({ all: options.all, names });
        const report = await setupReportForWorkspace({
          records: sourceSet.records,
          client: options.client,
          maxAge: options.maxAge,
          probeTimeoutSeconds: options.probeTimeout,
          all: options.all
        });
        printSetupReport(report, options.json);
        if (report.status === "failed") process.exitCode = 1;
        return;
      }
      const name = names[0];
      if (!name) throw new Error("Provide a registered source name, multiple source names, or --all.");
      const report = await setupReportForRecord({
        record: await registeredRecord(name),
        client: options.client,
        maxAge: options.maxAge,
        probeTimeoutSeconds: options.probeTimeout
      });
      printSetupReport(report, options.json);
      if (report.status === "failed") process.exitCode = 1;
    } catch (error: any) {
      const report = names.length <= 1 && !options.all
        ? setupReportForMissingSource(names[0] ?? "source", options.client, error)
        : setupReportForMissingWorkspace(names, options.client, error, options.all);
      printSetupReport(report, options.json);
      process.exitCode = 1;
    }
  });

const addCommand = program
  .command("add")
  .argument("<name>", "Local source name")
  .argument("<url>", "Docs URL to crawl");

addSourceRegistrationOptions(addCommand)
  .option("--json", "Print JSON output", false)
  .action(async (name, url, options) => {
    try {
      const { manifest, result } = await registerWebsiteSource(name, url, options);
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
    } catch (error: any) {
      if (options.json) printJson({ status: "failed", error: { message: error?.message ?? "Add failed." } });
      else console.error(pc.red(error?.message ?? "Add failed."));
      process.exitCode = 1;
    }
  });

program
  .command("sources")
  .option("--json", "Print JSON output", false)
  .action(async (options) => {
    try {
      const records = await listSources();
      const rows = await Promise.all(records.map(async (record) => sourceRow(record, await summarizeState(record))));
      if (options.json) printJson(rows);
      else printSourceRows(rows);
    } catch (error: any) {
      if (options.json) printJson({ error: { message: error?.message ?? "Sources failed." } });
      else console.error(pc.red(error?.message ?? "Sources failed."));
      process.exitCode = 1;
    }
  });

program
  .command("check")
  .argument("<name-or-bundle>", "Registered source name or OKF bundle directory")
  .option("--max-age <duration>", "Override freshness max age", duration)
  .option("--json", "Print JSON output", false)
  .action(async (target, options) => {
    try {
      if (await pathExists(target)) {
        const [validation, stats] = await Promise.all([validateBundle(target), inspectBundle(target).catch(() => undefined)]);
        const payload = {
          target,
          registeredSource: false,
          status: validation.valid ? "fresh" : "failed",
          valid: validation.valid,
          conceptCount: validation.conceptCount,
          warningCount: validation.warningCount,
          stats
        };
        if (options.json) printJson(payload);
        else {
          console.log(`Bundle: ${target}`);
          console.log(`Status: ${payload.status}`);
          console.log(`Valid: ${payload.valid}`);
          console.log(`Concepts: ${payload.conceptCount}`);
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
    } catch (error: any) {
      if (options.json) printJson({ status: "failed", error: { message: error?.message ?? "Check failed." } });
      else console.error(pc.red(error?.message ?? "Check failed."));
      process.exitCode = 2;
    }
  });

program
  .command("update")
  .argument("<name>", "Registered source name")
  .option("--json", "Print JSON output", false)
  .option("--dry-run", "Report what would be refreshed without replacing the active bundle", false)
  .action(async (name, options) => {
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
    } catch (error: any) {
      if (options.json) printJson({ status: "failed", error: { message: error?.message ?? "Update failed." } });
      else console.error(pc.red(error?.message ?? "Update failed."));
      process.exitCode = 1;
    }
  });

program
  .command("remove")
  .argument("<name>", "Registered source name")
  .option("-y, --yes", "Skip confirmation", false)
  .option("--keep-bundle", "Preserve explicit external bundle paths", false)
  .option("--json", "Print JSON output", false)
  .action(async (name, options) => {
    try {
      validateSourceName(name);
      if (!options.yes && !options.json) {
        throw new Error(`Refusing to remove "${name}" without --yes in non-interactive mode.`);
      }
      await removeSource(name);
      const payload = { removed: true, name };
      if (options.json) printJson(payload);
      else console.log(`Removed source: ${name}`);
    } catch (error: any) {
      if (options.json) printJson({ removed: false, name, error: { message: error?.message ?? "Remove failed." } });
      else console.error(pc.red(error?.message ?? "Remove failed."));
      process.exitCode = 1;
    }
  });

program
  .command("crawl")
  .argument("<url>", "Docs URL to crawl")
  .requiredOption("--out <dir>", "Output OKF bundle directory")
  .option("--max-pages <n>", "Maximum pages", (value) => Number(value), 100)
  .option("--max-depth <n>", "Maximum crawl depth", (value) => Number(value), 4)
  .option("--include <pattern>", "Include glob or regex", collect, [])
  .option("--exclude <pattern>", "Exclude glob or regex", collect, [])
  .option("--same-origin", "Stay on same origin", true)
  .option("--no-same-origin", "Allow cross-origin links")
  .option("--respect-robots", "Respect robots.txt", true)
  .option("--no-respect-robots", "Ignore robots.txt")
  .option("--concurrency <n>", "Fetch concurrency", (value) => Number(value), 4)
  .option("--title <name>", "Bundle title")
  .option("--force", "Overwrite output directory", false)
  .option("--dry-run", "List pages that would be crawled", false)
  .option("--allow-private-network", "Allow localhost/private IP crawl targets", false)
  .option("--dangerously-allow-unsafe-output", "Dangerously allow --force to delete otherwise unsafe output paths", false)
  .option("--stable-timestamps", "Use a deterministic timestamp in generated frontmatter", false)
  .action(async (url, options) => {
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
      console.log(`Pages: ${result.pagesFetched} fetched, ${result.skipped} skipped, ${result.failed} failed`);
      console.log(`Concepts: ${result.documents.length} written`);
      console.log(`Output: ${options.out}`);
      console.log("\nNext:");
      console.log(`  okfy validate ${options.out}`);
      console.log(`  okfy serve ${options.out} --mcp`);
    } catch (error: any) {
      console.error(pc.red(error?.message ?? "Crawl failed."));
      process.exitCode = 1;
    }
  });

program
  .command("import")
  .argument("<path>", "Local docs folder or file")
  .requiredOption("--out <dir>", "Output OKF bundle directory")
  .option("--source-name <name>", "Source name")
  .option("--include <glob>", "Include glob", collect, [])
  .option("--exclude <glob>", "Exclude glob", collect, [])
  .option("--force", "Overwrite output directory", false)
  .option("--dangerously-allow-unsafe-output", "Dangerously allow --force to delete otherwise unsafe output paths", false)
  .option("--stable-timestamps", "Use a deterministic timestamp in generated frontmatter", false)
  .action(async (input, options) => {
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
  });

program
  .command("validate")
  .argument("<bundle>", "OKF bundle directory")
  .option("--json", "Print JSON report", false)
  .action(async (bundle, options) => {
    printStatus(`okfy validate: checking ${bundle}`);
    const report = await validateBundle(bundle);
    printValidation(report, options.json);
    printStatus(`okfy validate: ${report.valid ? "valid" : "invalid"}, ${report.conceptCount} concepts`);
    if (!report.valid) process.exitCode = 1;
  });

program
  .command("inspect")
  .argument("<bundle>", "OKF bundle directory")
  .action(async (bundle) => {
    try {
      printStatus(`okfy inspect: reading ${bundle}`);
      const stats = await inspectBundle(bundle);
      printStats(stats);
      printStatus(`okfy inspect: done, ${stats.conceptCount} concepts, ${stats.linkCount} links`);
    } catch (error: any) {
      console.error(pc.red(error?.message ?? "Inspect failed."));
      process.exitCode = 1;
    }
  });

program
  .command("serve")
  .argument("[targets...]", "Registered source name(s), OKF bundle path(s), or one OKF bundle directory")
  .option("--all", "Serve all registered sources as one source-aware workspace", false)
  .option("--mcp", "Start MCP server", false)
  .option("--transport <transport>", "Transport: stdio", "stdio")
  .option("--name <server-name>", "MCP server name", "okfy")
  .option("--max-result-chars <n>", "Maximum characters per tool result", (value) => Number(value), 12000)
  .option("--auto-refresh", "Enable registered source refresh behavior", false)
  .option("--refresh-mode <mode>", "Refresh mode override: off, stale-while-refresh, or blocking", refreshMode)
  .option("--max-age <duration>", "Override freshness max age", duration)
  .action(async (targets: string[] = [], options) => {
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

    if (options.all && targets.length > 0) {
      console.error(pc.red("Use either --all or explicit source names, not both."));
      process.exitCode = 1;
      return;
    }
    if (!options.all && targets.length === 0) {
      console.error(pc.red("Provide a registered source name, an OKF bundle directory, or --all."));
      process.exitCode = 1;
      return;
    }

    const target = targets[0];

    try {
      if (!options.all && targets.length === 1 && pathLikeTarget(target)) {
        if (!(await pathExists(target))) throw new Error(`Bundle path does not exist: ${target}`);
        await serveBundleTarget(target, options);
        return;
      }

      if (options.all || targets.length > 1) {
        const bundleTargets = options.all ? [] : targets.filter(pathLikeTarget);
        const sourceTargets = options.all ? [] : targets.filter((sourceName) => !pathLikeTarget(sourceName));
        const sourceSet = options.all || sourceTargets.length
          ? await resolveWorkspaceSources({ all: options.all, names: sourceTargets })
          : { records: [], sourceNames: [] };
        const bundleRecords = await Promise.all(
          bundleTargets.map(async (bundleTarget) => {
            if (!(await pathExists(bundleTarget))) {
              throw new Error(`Workspace bundle path does not exist: ${bundleTarget}`);
            }
            return localBundleRecord(bundleTarget);
          })
        );
        const records: WorkspaceSourceRecord[] = [...sourceSet.records, ...bundleRecords];
        assertUniqueWorkspaceRecordNames(records);
        const availableSourceNames = options.all ? sourceSet.sourceNames : (await listSources()).map((record) => record.name);
        const workspaceNames = records.map((record) => record.name);
        printStatus(`okfy serve: loading workspace sources ${workspaceNames.join(", ")}`);
        printStatus(`okfy serve: starting MCP stdio server "${options.name}"`);
        await serveWorkspaceMcpStdio({
          name: options.name,
          maxResultChars: options.maxResultChars,
          availableSourceNames,
          sources: records.map((record) => {
            if (!isRegisteredWorkspaceRecord(record)) return { record };
            const mode = options.autoRefresh ? (options.refreshMode ?? record.manifest.refresh.mode) : "off";
            return { record, refresh: mcpRefreshHooksForRecord(record, mode, options.maxAge) };
          })
        });
        printStatus("okfy serve: ready on stdio (stdout is reserved for MCP JSON-RPC)");
        printStatus(`okfy serve: tools ${MCP_TOOL_NAMES.join(", ")}`);
        return;
      }

      let manifest: SourceManifest;
      try {
        manifest = await readSourceManifest(target);
      } catch (error) {
        if (!pathLikeTarget(target) && (await pathExists(target)) && !(await registeredSourceDirExists(target))) {
          await serveBundleTarget(target, options);
          return;
        }
        throw error;
      }
      const bundleDir = resolveBundleDir(manifest);
      const mode = options.autoRefresh ? (options.refreshMode ?? manifest.refresh.mode) : "off";
      const maxAgeSeconds = options.maxAge;
      const record = await registeredRecord(manifest.name);

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
        refresh: mcpRefreshHooksForRecord(record, mode, maxAgeSeconds)
      });
      printStatus("okfy serve: ready on stdio (stdout is reserved for MCP JSON-RPC)");
      printStatus(`okfy serve: tools ${MCP_TOOL_NAMES.join(", ")}`);
    } catch (error: any) {
      console.error(pc.red(error?.message ?? "Serve failed."));
      process.exitCode = 1;
    }
  });

function resolveDemoBundle(): string {
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
