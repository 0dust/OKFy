import fs from "node:fs";
import pc from "picocolors";
import {
  printCrawlProgress,
  printJson,
  printSetupReport,
  printSourceRows
} from "./cli-presenters.js";
import {
  readStateIfExists,
  registeredRecord,
  registerWebsiteSource,
  runSourceRefresh,
  sourceRow,
  summarizeState
} from "./source-lifecycle.js";
import {
  setupReportForInitFailure,
  setupReportForMissingSource,
  setupReportForMissingWorkspace,
  setupReportForRecord,
  setupReportForWorkspace
} from "./setup-diagnostics.js";
import {
  listSources,
  readSourceManifest,
  removeSource,
  resolveBundleDir,
  validateSourceName,
  writeRefreshState
} from "./source-store.js";
import { inspectBundle, validateBundle } from "./validate.js";
import { resolveWorkspaceSources } from "./workspace.js";

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.promises.access(target);
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function runInitCommand(
  name: string,
  url: string,
  options: any,
  cliPath: string
): Promise<void> {
  try {
    const { manifest } = await registerWebsiteSource(name, url, options, {
      onProgress: printCrawlProgress
    });
    const report = await setupReportForRecord({
      record: await registeredRecord(manifest.name),
      client: options.client,
      maxAge: options.maxAge,
      probeTimeoutSeconds: options.probeTimeout,
      cliPath
    });
    printSetupReport(report, options.json);
    if (report.status === "failed") process.exitCode = 1;
  } catch (error: any) {
    if (options.json)
      printSetupReport(setupReportForInitFailure(name, options.client, error), true);
    else console.error(pc.red(error?.message ?? "Init failed."));
    process.exitCode = 1;
  }
}

export async function runDoctorCommand(
  names: string[] = [],
  options: any,
  cliPath: string
): Promise<void> {
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
        all: options.all,
        cliPath
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
      probeTimeoutSeconds: options.probeTimeout,
      cliPath
    });
    printSetupReport(report, options.json);
    if (report.status === "failed") process.exitCode = 1;
  } catch (error: any) {
    const report =
      names.length <= 1 && !options.all
        ? setupReportForMissingSource(names[0] ?? "source", options.client, error)
        : setupReportForMissingWorkspace(names, options.client, error, options.all);
    printSetupReport(report, options.json);
    process.exitCode = 1;
  }
}

export async function runAddCommand(name: string, url: string, options: any): Promise<void> {
  try {
    const { manifest, result } = await registerWebsiteSource(name, url, options, {
      onProgress: printCrawlProgress
    });
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
    if (options.json)
      printJson({ status: "failed", error: { message: error?.message ?? "Add failed." } });
    else console.error(pc.red(error?.message ?? "Add failed."));
    process.exitCode = 1;
  }
}

export async function runSourcesCommand(options: any): Promise<void> {
  try {
    const records = await listSources();
    const rows = await Promise.all(
      records.map(async (record) => sourceRow(record, await summarizeState(record)))
    );
    if (options.json) printJson(rows);
    else printSourceRows(rows);
  } catch (error: any) {
    if (options.json) printJson({ error: { message: error?.message ?? "Sources failed." } });
    else console.error(pc.red(error?.message ?? "Sources failed."));
    process.exitCode = 1;
  }
}

export async function runCheckCommand(target: string, options: any): Promise<void> {
  try {
    if (await pathExists(target)) {
      const [validation, stats] = await Promise.all([
        validateBundle(target),
        inspectBundle(target).catch(() => undefined)
      ]);
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
    if (!record.loadError) await writeRefreshState(record.name, nextState);
    const payload = sourceRow(record, nextState);
    if (options.json) printJson(payload);
    else printSourceRows([payload]);
    if (nextState.status !== "fresh" || nextState.bundle?.valid !== true) process.exitCode = 1;
  } catch (error: any) {
    if (options.json)
      printJson({ status: "failed", error: { message: error?.message ?? "Check failed." } });
    else console.error(pc.red(error?.message ?? "Check failed."));
    process.exitCode = 2;
  }
}

export async function runUpdateCommand(name: string, options: any): Promise<void> {
  try {
    const manifest = await readSourceManifest(name);
    const oldState = await readStateIfExists(name);
    const result = await runSourceRefresh(manifest, {
      force: true,
      dryRun: options.dryRun,
      onProgress: printCrawlProgress
    });
    const bundlePath = resolveBundleDir(manifest);
    const payload = {
      name: manifest.name,
      status: result.state?.status ?? result.status,
      skipped: result.skipped,
      reason: result.reason ?? null,
      dryRun: Boolean(result.dryRun),
      oldConceptCount: oldState?.bundle?.conceptCount ?? null,
      newConceptCount:
        result.state?.bundle?.conceptCount ?? oldState?.bundle?.conceptCount ?? null,
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
    if (options.json)
      printJson({ status: "failed", error: { message: error?.message ?? "Update failed." } });
    else console.error(pc.red(error?.message ?? "Update failed."));
    process.exitCode = 1;
  }
}

export async function runRemoveCommand(name: string, options: any): Promise<void> {
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
    if (options.json)
      printJson({ removed: false, name, error: { message: error?.message ?? "Remove failed." } });
    else console.error(pc.red(error?.message ?? "Remove failed."));
    process.exitCode = 1;
  }
}
