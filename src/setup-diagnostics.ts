import { execFile } from "node:child_process";
import path from "node:path";
import { summarizeState } from "./source-lifecycle.js";
import {
  createSetupReport,
  defaultOkfyHome,
  executableOnPath,
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
  resolveOkfyHome,
  writeRefreshState,
  type RefreshState,
  type SourceRecord
} from "./source-store.js";
import { validateBundle } from "./validate.js";

function setupHomeCheck(okfyHome: string): SetupCheck {
  const defaultHome = defaultOkfyHome();
  if (path.resolve(okfyHome) === path.resolve(defaultHome)) {
    return setupCheck(
      "source_home",
      "Source store",
      "pass",
      `Using default OKFY_HOME ${okfyHome}.`
    );
  }
  return setupCheck(
    "source_home",
    "Source store",
    "pass",
    `Using non-default OKFY_HOME ${okfyHome}; generated configs include this environment override.`
  );
}

function setupFreshnessCheck(record: SourceRecord, state: RefreshState): SetupCheck {
  if (record.loadError) {
    return setupCheck(
      "freshness",
      "Freshness",
      "fail",
      record.loadError.message,
      `Run npx -y okfy-ai update ${record.name} to refresh the source state.`
    );
  }
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
      return setupCheck(
        "bundle",
        "Bundle validation",
        "pass",
        `Bundle is valid with ${validation.conceptCount} concepts.`
      );
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
    return setupCheck(
      "npx",
      "npx availability",
      "fail",
      "`npx` was not found on PATH, but generated MCP configs use npx by default.",
      fix
    );
  }
  const health = await commandHealth("npx", ["--version"], process.env);
  if (!health.ok) {
    return setupCheck(
      "npx",
      "npx availability",
      "fail",
      `\`npx\` was found but failed to run: ${health.message}`,
      fix
    );
  }
  return setupCheck(
    "npx",
    "npx availability",
    "pass",
    `\`npx\` is available on PATH (${health.message}).`
  );
}

function setupMcpProbeCheck(probe: McpProbeResult): SetupCheck {
  if (probe.ok) {
    return setupCheck(
      "mcp_probe",
      "MCP stdio probe",
      "pass",
      `MCP tools visible: ${probe.tools.join(", ")}.`
    );
  }
  const message = probe.error?.message ?? "MCP probe failed.";
  const fix =
    probe.error?.code === "stdout_contamination"
      ? "Move human logs to stderr so stdout contains only MCP JSON-RPC messages."
      : "Run the generated serve command in your MCP client, then rerun doctor with the same OKFY_HOME.";
  return setupCheck("mcp_probe", "MCP stdio probe", "fail", message, fix);
}

async function runSetupProbe(options: {
  sourceNameOrNames: ServeCommandTarget;
  timeoutSeconds: number;
  cliPath: string;
}): Promise<McpProbeResult> {
  const command = serveCommand(options.sourceNameOrNames, resolveOkfyHome());
  return probeMcpStdio({
    command: process.execPath,
    args: [options.cliPath, ...serveCommandArgs(options.sourceNameOrNames)],
    env: { ...process.env, ...command.env },
    timeoutMs: options.timeoutSeconds * 1000
  });
}

async function commandHealth(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ ok: true; message: string } | { ok: false; message: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { env, timeout: 3000 }, (error, stdout, stderr) => {
      const message = (
        stderr ||
        stdout ||
        (error instanceof Error ? error.message : String(error ?? ""))
      ).trim();
      if (error) resolve({ ok: false, message: message || "command failed" });
      else resolve({ ok: true, message: message || "ok" });
    });
  });
}

export async function setupReportForRecord(options: {
  record: SourceRecord;
  client: SetupClient;
  maxAge?: number;
  probeTimeoutSeconds: number;
  cliPath: string;
}): Promise<SetupReport> {
  const state = await summarizeState(options.record, options.maxAge);
  if (!options.record.loadError) await writeRefreshState(options.record.name, state);
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
    checks.push(
      setupMcpProbeCheck(
        await runSetupProbe({
          sourceNameOrNames: options.record.name,
          timeoutSeconds: options.probeTimeoutSeconds,
          cliPath: options.cliPath
        })
      )
    );
  }
  return createSetupReport({
    sourceName: options.record.name,
    client: options.client,
    okfyHome: resolveOkfyHome(),
    checks
  });
}

export async function setupReportForWorkspace(options: {
  records: SourceRecord[];
  client: SetupClient;
  maxAge?: number;
  probeTimeoutSeconds: number;
  all?: boolean;
  cliPath: string;
}): Promise<SetupReport> {
  const sourceNames = options.records.map((record) => record.name);
  const commandTarget: ServeCommandTarget = options.all ? { all: true } : sourceNames;
  const states = await Promise.all(
    options.records.map(async (record) => {
      const state = await summarizeState(record, options.maxAge);
      if (!record.loadError) await writeRefreshState(record.name, state);
      return { record, state };
    })
  );
  const bundleChecks = await Promise.all(
    options.records.map(async (record) =>
      namespaceWorkspaceCheck(await setupBundleCheck(record.bundleDir), record.name)
    )
  );
  const freshnessChecks = states.map(({ record, state }) =>
    namespaceWorkspaceCheck(setupFreshnessCheck(record, state), record.name)
  );
  const npxCheck = await setupNpxCheck();
  const checks: SetupCheck[] = [
    setupCheck(
      "source",
      "Registered sources",
      "pass",
      `Workspace sources exist: ${sourceNames.join(", ")}.`
    ),
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
    checks.push(
      setupMcpProbeCheck(
        await runSetupProbe({
          sourceNameOrNames: commandTarget,
          timeoutSeconds: options.probeTimeoutSeconds,
          cliPath: options.cliPath
        })
      )
    );
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

export function setupReportForMissingSource(
  name: string,
  client: SetupClient,
  error: unknown
): SetupReport {
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

export function setupReportForMissingWorkspace(
  names: string[],
  client: SetupClient,
  error: unknown,
  all = false
): SetupReport {
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

export function setupReportForInitFailure(
  name: string,
  client: SetupClient,
  error: unknown
): SetupReport {
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
