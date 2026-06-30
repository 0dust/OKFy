#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import {
  runCrawlCommand,
  runDemoCommand,
  runImportCommand,
  runInspectCommand,
  runValidateCommand
} from "./cli-content-actions.js";
import {
  runAddCommand,
  runCheckCommand,
  runDoctorCommand,
  runInitCommand,
  runRemoveCommand,
  runSourcesCommand,
  runUpdateCommand
} from "./cli-source-actions.js";
import { parseDurationSeconds } from "./duration.js";
import { packageVersion, runtimePackageRoot } from "./metadata.js";
import {
  parseSetupClient,
  type SetupClient
} from "./setup.js";
import type { RefreshMode } from "./source-store.js";
import {
  runActivateCommand,
  runMapCommand,
  runServeCommand
} from "./cli-workspace-actions.js";

const program = new Command();
const cliPath = fileURLToPath(import.meta.url);
const packageRoot = runtimePackageRoot();

function collect(value: string, previous: string[]): string[] {
  previous.push(value);
  return previous;
}

function duration(value: string): number {
  return parseDurationSeconds(value);
}

function integerOption(value: string, label: string, minimum: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    const expectation = minimum === 0 ? "a non-negative integer" : `an integer >= ${minimum}`;
    throw new Error(`Expected ${label} to be ${expectation}, received "${value}".`);
  }
  return parsed;
}

const positiveIntegerOption =
  (label: string) =>
  (value: string): number =>
    integerOption(value, label, 1);
const nonNegativeIntegerOption =
  (label: string) =>
  (value: string): number =>
    integerOption(value, label, 0);

function refreshMode(value: string): RefreshMode {
  if (value === "off" || value === "stale-while-refresh" || value === "blocking") return value;
  throw new Error(`Invalid refresh mode "${value}". Use off, stale-while-refresh, or blocking.`);
}

function setupClient(value: string): SetupClient {
  return parseSetupClient(value);
}

function addSourceRegistrationOptions(command: Command): Command {
  return command
    .option("--max-pages <n>", "Maximum pages", positiveIntegerOption("max-pages"), 100)
    .option("--max-depth <n>", "Maximum crawl depth", nonNegativeIntegerOption("max-depth"), 4)
    .option("--include <pattern>", "Include glob or regex", collect, [])
    .option("--exclude <pattern>", "Exclude glob or regex", collect, [])
    .option("--same-origin", "Stay on same origin", true)
    .option("--no-same-origin", "Allow cross-origin links")
    .option("--respect-robots", "Respect robots.txt", true)
    .option("--no-respect-robots", "Ignore robots.txt")
    .option("--concurrency <n>", "Fetch concurrency", positiveIntegerOption("concurrency"), 4)
    .option("--allow-private-network", "Allow localhost/private IP crawl targets", false)
    .option(
      "--refresh-mode <mode>",
      "Refresh mode: off, stale-while-refresh, or blocking",
      refreshMode,
      "stale-while-refresh"
    )
    .option("--max-age <duration>", "Freshness max age", duration, 24 * 60 * 60)
    .option(
      "--min-refresh-interval <duration>",
      "Minimum interval between refresh attempts",
      duration,
      15 * 60
    )
    .option("--out <dir>", "Explicit active bundle directory")
    .option("--force", "Overwrite an existing source registration", false);
}

program
  .name("okfy")
  .description("Turn docs into agent memory with Open Knowledge Format and MCP.")
  .version(packageVersion());

const initCommand = program
  .command("init")
  .argument("<name>", "Local source name")
  .argument("<url>", "Docs URL to crawl")
  .option(
    "--client <client>",
    "Target client: claude-code, claude-desktop, cursor, codex, or generic",
    setupClient,
    parseSetupClient("generic")
  );

addSourceRegistrationOptions(initCommand)
  .option("--probe-timeout <duration>", "MCP setup probe timeout", duration, 5)
  .option("--json", "Print JSON output", false)
  .action((name, url, options) => runInitCommand(name, url, options, cliPath));

program
  .command("doctor")
  .argument("[names...]", "Registered source name(s)")
  .option("--all", "Check all registered sources as one workspace", false)
  .option(
    "--client <client>",
    "Target client: claude-code, claude-desktop, cursor, codex, or generic",
    setupClient,
    parseSetupClient("generic")
  )
  .option("--max-age <duration>", "Override freshness max age", duration)
  .option("--probe-timeout <duration>", "MCP setup probe timeout", duration, 5)
  .option("--json", "Print JSON output", false)
  .action((names: string[] = [], options) => runDoctorCommand(names, options, cliPath));

const addCommand = program
  .command("add")
  .argument("<name>", "Local source name")
  .argument("<url>", "Docs URL to crawl");

addSourceRegistrationOptions(addCommand)
  .option("--json", "Print JSON output", false)
  .action(runAddCommand);

program
  .command("sources")
  .option("--json", "Print JSON output", false)
  .action(runSourcesCommand);

program
  .command("check")
  .argument("<name-or-bundle>", "Registered source name or OKF bundle directory")
  .option("--max-age <duration>", "Override freshness max age", duration)
  .option("--json", "Print JSON output", false)
  .action(runCheckCommand);

program
  .command("update")
  .argument("<name>", "Registered source name")
  .option("--json", "Print JSON output", false)
  .option("--dry-run", "Report what would be refreshed without replacing the active bundle", false)
  .action(runUpdateCommand);

program
  .command("remove")
  .argument("<name>", "Registered source name")
  .option("-y, --yes", "Skip confirmation", false)
  .option("--json", "Print JSON output", false)
  .action(runRemoveCommand);

program
  .command("crawl")
  .argument("<url>", "Docs URL to crawl")
  .requiredOption("--out <dir>", "Output OKF bundle directory")
  .option("--max-pages <n>", "Maximum pages", positiveIntegerOption("max-pages"), 100)
  .option("--max-depth <n>", "Maximum crawl depth", nonNegativeIntegerOption("max-depth"), 4)
  .option("--include <pattern>", "Include glob or regex", collect, [])
  .option("--exclude <pattern>", "Exclude glob or regex", collect, [])
  .option("--same-origin", "Stay on same origin", true)
  .option("--no-same-origin", "Allow cross-origin links")
  .option("--respect-robots", "Respect robots.txt", true)
  .option("--no-respect-robots", "Ignore robots.txt")
  .option("--concurrency <n>", "Fetch concurrency", positiveIntegerOption("concurrency"), 4)
  .option("--title <name>", "Bundle title")
  .option("--force", "Overwrite output directory", false)
  .option("--dry-run", "List pages that would be crawled", false)
  .option("--allow-private-network", "Allow localhost/private IP crawl targets", false)
  .option(
    "--dangerously-allow-unsafe-output",
    "Dangerously allow --force to delete otherwise unsafe output paths",
    false
  )
  .option("--stable-timestamps", "Use a deterministic timestamp in generated frontmatter", false)
  .action(runCrawlCommand);

program
  .command("import")
  .argument("<path>", "Local docs folder or file")
  .requiredOption("--out <dir>", "Output OKF bundle directory")
  .option("--source-name <name>", "Source name")
  .option("--include <glob>", "Include glob", collect, [])
  .option("--exclude <glob>", "Exclude glob", collect, [])
  .option("--force", "Overwrite output directory", false)
  .option(
    "--dangerously-allow-unsafe-output",
    "Dangerously allow --force to delete otherwise unsafe output paths",
    false
  )
  .option("--stable-timestamps", "Use a deterministic timestamp in generated frontmatter", false)
  .action(runImportCommand);

program
  .command("validate")
  .argument("<bundle>", "OKF bundle directory")
  .option("--json", "Print JSON report", false)
  .action(runValidateCommand);

program
  .command("inspect")
  .argument("<bundle>", "OKF bundle directory")
  .action(runInspectCommand);

program
  .command("activate")
  .argument(
    "[targets...]",
    "Registered source name(s), OKF bundle path(s), or one OKF bundle directory"
  )
  .option("--all", "Activate all registered sources as one source-aware workspace", false)
  .option(
    "--client <client>",
    "Target client: claude-code, claude-desktop, cursor, codex, or generic",
    setupClient,
    "generic"
  )
  .option("--out <dir>", "Activation packet output directory", "okfy-activation")
  .option("--task <text>", "Task or question to prove with search_concepts in okfy-proof.json")
  .option("--force", "Overwrite a non-empty activation output directory", false)
  .option("--json", "Print activation packet manifest JSON", false)
  .action(runActivateCommand);

program
  .command("map")
  .argument(
    "[targets...]",
    "Registered source name(s), OKF bundle path(s), or one OKF bundle directory"
  )
  .option("--all", "Map all registered sources as one source-aware workspace", false)
  .option("--out <file>", "Inspector HTML output file", "okfy-inspector.html")
  .option("--json", "Print Inspector report JSON without writing HTML", false)
  .action(runMapCommand);

program
  .command("serve")
  .argument(
    "[targets...]",
    "Registered source name(s), OKF bundle path(s), or one OKF bundle directory"
  )
  .option("--all", "Serve all registered sources as one source-aware workspace", false)
  .option("--mcp", "Start MCP server", false)
  .option("--transport <transport>", "Transport: stdio", "stdio")
  .option("--name <server-name>", "MCP server name", "okfy")
  .option(
    "--max-result-chars <n>",
    "Maximum characters per tool result",
    positiveIntegerOption("max-result-chars"),
    12000
  )
  .option("--auto-refresh", "Enable registered source refresh behavior", false)
  .option(
    "--refresh-mode <mode>",
    "Refresh mode override: off, stale-while-refresh, or blocking",
    refreshMode
  )
  .option("--max-age <duration>", "Override freshness max age", duration)
  .action(runServeCommand);

program
  .command("demo")
  .description("Run offline demo against committed example bundle")
  .action(() => runDemoCommand(packageRoot));

program.parseAsync(process.argv);
