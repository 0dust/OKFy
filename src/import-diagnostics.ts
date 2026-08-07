import fs from "node:fs/promises";
import path from "node:path";
import { isConceptMarkdownPath } from "./okf.js";
import { isRecord } from "./util/object.js";

export const IMPORT_DIAGNOSTICS_FILE = "okfy-import-diagnostics.json";

export type PersistedImportDiagnostic = {
  code: "missing_wikilink_fragment";
  sourceConceptPath: string;
  sourcePath: string;
  rawTarget: string;
  targetConceptPath: string;
  targetPath: string;
  fragmentKind: "heading" | "block";
  emittedFragment: string;
  targetFragmentPresent: boolean;
};

type ImportDiagnosticsManifest = {
  schemaVersion: 1;
  entries: PersistedImportDiagnostic[];
};

export type ReadImportDiagnosticsResult = {
  entries: PersistedImportDiagnostic[];
  error?: string;
};

function compareText(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

function compareEntries(
  first: PersistedImportDiagnostic,
  second: PersistedImportDiagnostic
): number {
  return (
    compareText(first.sourceConceptPath, second.sourceConceptPath) ||
    compareText(first.sourcePath, second.sourcePath) ||
    compareText(first.rawTarget, second.rawTarget) ||
    compareText(first.targetConceptPath, second.targetConceptPath) ||
    compareText(first.targetPath, second.targetPath) ||
    compareText(first.fragmentKind, second.fragmentKind) ||
    compareText(first.emittedFragment, second.emittedFragment) ||
    Number(first.targetFragmentPresent) - Number(second.targetFragmentPresent)
  );
}

function safeConceptPath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (value.includes("\0") || value.includes("\\") || path.posix.isAbsolute(value)) return false;
  if (path.posix.normalize(value) !== value || value === ".." || value.startsWith("../"))
    return false;
  return isConceptMarkdownPath(value);
}

function safeText(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function parseEntry(value: unknown): PersistedImportDiagnostic | undefined {
  if (!isRecord(value)) return undefined;
  if (value.code !== "missing_wikilink_fragment") return undefined;
  if (!safeConceptPath(value.sourceConceptPath) || !safeConceptPath(value.targetConceptPath)) {
    return undefined;
  }
  if (
    !safeText(value.sourcePath) ||
    !safeText(value.rawTarget) ||
    !safeText(value.targetPath) ||
    (value.fragmentKind !== "heading" && value.fragmentKind !== "block") ||
    !safeText(value.emittedFragment) ||
    typeof value.targetFragmentPresent !== "boolean"
  ) {
    return undefined;
  }
  return {
    code: value.code,
    sourceConceptPath: value.sourceConceptPath,
    sourcePath: value.sourcePath,
    rawTarget: value.rawTarget,
    targetConceptPath: value.targetConceptPath,
    targetPath: value.targetPath,
    fragmentKind: value.fragmentKind,
    emittedFragment: value.emittedFragment,
    targetFragmentPresent: value.targetFragmentPresent
  };
}

export function serializeImportDiagnostics(entries: PersistedImportDiagnostic[]): string {
  const manifest: ImportDiagnosticsManifest = {
    schemaVersion: 1,
    entries: entries.slice().sort(compareEntries)
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

export async function readImportDiagnostics(
  bundleDir: string
): Promise<ReadImportDiagnosticsResult> {
  const file = path.join(bundleDir, IMPORT_DIAGNOSTICS_FILE);
  let stat;
  try {
    stat = await fs.lstat(file);
  } catch (error: any) {
    if (error?.code === "ENOENT") return { entries: [] };
    return { entries: [], error: `Unable to inspect ${IMPORT_DIAGNOSTICS_FILE}.` };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return { entries: [], error: `${IMPORT_DIAGNOSTICS_FILE} must be a regular file.` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return { entries: [], error: `${IMPORT_DIAGNOSTICS_FILE} is not valid JSON.` };
  }
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries)) {
    return { entries: [], error: `${IMPORT_DIAGNOSTICS_FILE} has an unsupported schema.` };
  }
  const entries = parsed.entries.map(parseEntry);
  if (entries.some((entry) => entry === undefined)) {
    return { entries: [], error: `${IMPORT_DIAGNOSTICS_FILE} contains an invalid entry.` };
  }
  return { entries: entries as PersistedImportDiagnostic[] };
}
