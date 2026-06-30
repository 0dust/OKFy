import fs from "node:fs";
import path from "node:path";
import { protectedActivationInputPaths } from "./activation.js";
import { buildBundleInspectorReport, buildWorkspaceInspectorReport } from "./inspector.js";
import { readSourceRecord, resolveSourceDir, type SourceRecord } from "./source-store.js";
import type { ServeCommandTarget } from "./setup.js";
import { validateBundle } from "./validate.js";
import {
  assertUniqueWorkspaceRecordNames,
  isRegisteredWorkspaceRecord,
  localBundleRecord,
  resolveWorkspaceSources,
  type WorkspaceSourceRecord
} from "./workspace.js";

export type CliTargetResolution =
  | { kind: "bundle"; bundleDir: string }
  | { kind: "registered"; record: SourceRecord }
  | {
      kind: "workspace";
      all: boolean;
      records: WorkspaceSourceRecord[];
      sourceNames: string[];
    };

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
  return (
    path.isAbsolute(target) ||
    target === "." ||
    target === ".." ||
    target.startsWith("./") ||
    target.startsWith("../") ||
    target.includes("/") ||
    target.includes("\\")
  );
}

async function registeredSourceDirExists(name: string): Promise<boolean> {
  try {
    return await pathExists(resolveSourceDir(name));
  } catch {
    return false;
  }
}

async function assertBundleHasConceptFiles(bundleDir: string): Promise<void> {
  const validation = await validateBundle(bundleDir);
  if (validation.conceptCount === 0) {
    throw new Error(`Bundle path does not contain any OKF concept files: ${bundleDir}`);
  }
}

async function resolveLocalBundleTarget(target: string, label = "Bundle path"): Promise<string> {
  if (!(await pathExists(target))) throw new Error(`${label} does not exist: ${target}`);
  await assertBundleHasConceptFiles(target);
  return target;
}

export async function resolveCliTargets(
  targets: string[],
  options: { all: boolean }
): Promise<CliTargetResolution> {
  if (options.all && targets.length > 0) {
    throw new Error("Use either --all or explicit source names, not both.");
  }
  if (!options.all && targets.length === 0) {
    throw new Error("Provide a registered source name, an OKF bundle directory, or --all.");
  }

  if (!options.all && targets.length === 1) {
    const target = targets[0]!;
    if (pathLikeTarget(target)) {
      return { kind: "bundle", bundleDir: await resolveLocalBundleTarget(target) };
    }

    try {
      return { kind: "registered", record: await readSourceRecord(target) };
    } catch (error) {
      if ((await pathExists(target)) && !(await registeredSourceDirExists(target))) {
        return { kind: "bundle", bundleDir: await resolveLocalBundleTarget(target) };
      }
      throw error;
    }
  }

  const bundleTargets = options.all ? [] : targets.filter(pathLikeTarget);
  const sourceTargets = options.all
    ? []
    : targets.filter((sourceName) => !pathLikeTarget(sourceName));
  const sourceSet =
    options.all || sourceTargets.length
      ? await resolveWorkspaceSources({ all: options.all, names: sourceTargets })
      : { records: [], sourceNames: [] };
  const bundleRecords = await Promise.all(
    bundleTargets.map(async (bundleTarget) => {
      await resolveLocalBundleTarget(bundleTarget, "Workspace bundle path");
      return localBundleRecord(bundleTarget);
    })
  );
  const records: WorkspaceSourceRecord[] = [...sourceSet.records, ...bundleRecords];
  assertUniqueWorkspaceRecordNames(records);
  return { kind: "workspace", all: options.all, records, sourceNames: sourceSet.sourceNames };
}

export async function inspectorReportForResolution(
  resolution: CliTargetResolution
): Promise<Awaited<ReturnType<typeof buildBundleInspectorReport>>> {
  if (resolution.kind === "bundle") return buildBundleInspectorReport(resolution.bundleDir);
  if (resolution.kind === "registered") return buildWorkspaceInspectorReport([resolution.record]);
  return buildWorkspaceInspectorReport(resolution.records, { all: resolution.all });
}

export function activationInputForResolution(resolution: CliTargetResolution): {
  records: WorkspaceSourceRecord[];
  commandTarget: ServeCommandTarget;
  protectedInputPaths: string[];
  autoRefresh: boolean;
  serverIdentity: string[];
} {
  if (resolution.kind === "bundle") {
    const record = localBundleRecord(resolution.bundleDir);
    return {
      records: [record],
      commandTarget: resolution.bundleDir,
      protectedInputPaths: protectedActivationInputPaths([record]),
      autoRefresh: false,
      serverIdentity: [record.name]
    };
  }
  if (resolution.kind === "registered") {
    return {
      records: [resolution.record],
      commandTarget: resolution.record.name,
      protectedInputPaths: protectedActivationInputPaths([resolution.record]),
      autoRefresh: true,
      serverIdentity: [resolution.record.name]
    };
  }
  const commandTargets = resolution.records.map((record) =>
    isRegisteredWorkspaceRecord(record) ? record.name : record.bundleDir
  );
  return {
    records: resolution.records,
    commandTarget: resolution.all ? { all: true } : commandTargets,
    protectedInputPaths: protectedActivationInputPaths(resolution.records),
    autoRefresh: resolution.records.some(isRegisteredWorkspaceRecord) || resolution.all,
    serverIdentity: resolution.all ? ["all"] : resolution.records.map((record) => record.name)
  };
}
