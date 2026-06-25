import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { packageVersion } from "./metadata.js";
import { MCP_TOOL_NAMES } from "./mcp.js";
import { resolveOkfyHome } from "./source-store.js";

export type SetupClient = "claude-code" | "mcp-json" | "codex" | "generic";
export type SetupCheckSeverity = "pass" | "warn" | "fail";
export type SetupStatus = "ready" | "warning" | "failed";

export interface ServeCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
  display: string;
}

export interface ServeCommandOptions {
  autoRefresh?: boolean;
}

export interface SetupArtifact {
  client: SetupClient;
  label: string;
  format: "shell" | "json" | "toml";
  body: string;
}

export interface McpClientArtifactInput {
  client: SetupClient;
  serverName: string;
  codexServerName: string;
  command: ServeCommand;
}

export interface SetupCheck {
  id: string;
  label: string;
  severity: SetupCheckSeverity;
  message: string;
  fix?: string;
}

export interface SetupReport {
  sourceName: string;
  sourceNames: string[];
  workspace: boolean;
  workspaceAll: boolean;
  client: SetupClient;
  serverName: string;
  codexServerName: string;
  okfyHome: string;
  defaultOkfyHome: string;
  command: ServeCommand;
  artifacts: SetupArtifact[];
  firstPrompt: string;
  checks: SetupCheck[];
  status: SetupStatus;
}

export interface SetupReportInput {
  sourceName?: string;
  sourceNames?: string[];
  workspaceAll?: boolean;
  client: SetupClient;
  okfyHome?: string;
  checks: SetupCheck[];
}

export interface McpProbeResult {
  ok: boolean;
  tools: string[];
  stderr: string;
  error?: {
    code:
      | "startup_failed"
      | "timeout"
      | "stdout_contamination"
      | "missing_tools"
      | "protocol_error";
    message: string;
  };
}

export interface McpProbeOptions {
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

const EXPECTED_MCP_TOOLS = [...MCP_TOOL_NAMES];
const MAX_CAPTURE_CHARS = 64_000;
const MAX_DIAGNOSTIC_CHARS = 1_000;
const MAX_MESSAGES = 100;

export function parseSetupClient(value: string): SetupClient {
  const normalized = value.trim().toLowerCase();
  if (normalized === "claude-code" || normalized === "claude") return "claude-code";
  if (
    normalized === "claude-desktop" ||
    normalized === "cursor" ||
    normalized === "mcp-json" ||
    normalized === "desktop"
  ) {
    return "mcp-json";
  }
  if (normalized === "codex") return "codex";
  if (normalized === "generic" || normalized === "json") return "generic";
  throw new Error(
    `Invalid setup client "${value}". Use claude-code, claude-desktop, cursor, codex, or generic.`
  );
}

export function expectedMcpTools(): string[] {
  return [...EXPECTED_MCP_TOOLS];
}

export function defaultOkfyHome(): string {
  return resolveOkfyHome({ env: { OKFY_HOME: "" } });
}

export function setupStatus(checks: SetupCheck[]): SetupStatus {
  if (checks.some((check) => check.severity === "fail")) return "failed";
  if (checks.some((check) => check.severity === "warn")) return "warning";
  return "ready";
}

export function createSetupReport(input: SetupReportInput): SetupReport {
  const okfyHome = path.resolve(input.okfyHome ?? resolveOkfyHome());
  const defaultHome = defaultOkfyHome();
  const sourceNames = setupSourceNames(input);
  const workspace = Boolean(input.workspaceAll) || sourceNames.length > 1;
  const serverIdentity = input.workspaceAll ? ["all"] : sourceNames;
  const commandTarget = input.workspaceAll ? { all: true as const } : sourceNames;
  const serverName = mcpServerName(serverIdentity);
  const codexServerName = codexMcpServerName(serverIdentity);
  const command = serveCommand(commandTarget, okfyHome, defaultHome);
  return {
    sourceName: input.workspaceAll && sourceNames.length === 0 ? "--all" : sourceNames.join(", "),
    sourceNames,
    workspace,
    workspaceAll: Boolean(input.workspaceAll),
    client: input.client,
    serverName,
    codexServerName,
    okfyHome,
    defaultOkfyHome: defaultHome,
    command,
    artifacts: renderClientArtifacts({
      client: input.client,
      sourceNames,
      workspaceAll: input.workspaceAll,
      okfyHome,
      defaultOkfyHome: defaultHome
    }),
    firstPrompt: firstAgentPrompt(input.client === "codex" ? codexServerName : serverName, {
      workspace
    }),
    checks: input.checks,
    status: setupStatus(input.checks)
  };
}

export function renderClientArtifacts(input: {
  client: SetupClient;
  sourceName?: string;
  sourceNames?: string[];
  workspaceAll?: boolean;
  okfyHome?: string;
  defaultOkfyHome?: string;
}): SetupArtifact[] {
  const okfyHome = path.resolve(input.okfyHome ?? resolveOkfyHome());
  const defaultHome = input.defaultOkfyHome ?? defaultOkfyHome();
  const sourceNames = setupSourceNames(input);
  const serverIdentity = input.workspaceAll ? ["all"] : sourceNames;
  const commandTarget = input.workspaceAll ? { all: true as const } : sourceNames;
  const serverName = mcpServerName(serverIdentity);
  const codexName = codexMcpServerName(serverIdentity);
  const command = serveCommand(commandTarget, okfyHome, defaultHome);

  return renderMcpClientArtifacts({
    client: input.client,
    serverName,
    codexServerName: codexName,
    command
  });
}

export function renderMcpClientArtifacts(input: McpClientArtifactInput): SetupArtifact[] {
  const env = Object.keys(input.command.env).length ? input.command.env : undefined;

  if (input.client === "claude-code") {
    return [
      {
        client: input.client,
        label: "Claude Code",
        format: "shell",
        body: `claude mcp add --transport stdio${shellEnvArgs(input.command.env, "-e")} ${input.serverName} -- ${input.command.display}`
      }
    ];
  }

  if (input.client === "codex") {
    return [
      {
        client: input.client,
        label: "Codex config.toml",
        format: "toml",
        body: codexToml(input.codexServerName, input.command, env)
      },
      {
        client: input.client,
        label: "Codex CLI",
        format: "shell",
        body: `codex mcp add${shellEnvArgs(input.command.env, "--env")} ${input.codexServerName} -- ${input.command.display}`
      }
    ];
  }

  const label =
    input.client === "mcp-json"
      ? "Claude Desktop / Cursor mcpServers JSON"
      : "Generic mcpServers JSON";
  return [
    {
      client: input.client,
      label,
      format: "json",
      body: JSON.stringify(
        {
          mcpServers: {
            [input.serverName]: {
              command: input.command.command,
              args: input.command.args,
              ...(env ? { env } : {})
            }
          }
        },
        null,
        2
      )
    }
  ];
}

export function firstAgentPrompt(
  serverName: string,
  options: { workspace?: boolean } = {}
): string {
  if (options.workspace) {
    return `Use the ${serverName} MCP server. Start with bundle_summary to understand the workspace sources and freshness. Filter by source when you know which docs apply, search before reading concepts, read only the most relevant concepts, inspect neighbors when relationships matter, and cite source_resource URLs in the final answer.`;
  }
  return `Use the ${serverName} MCP server. Start with bundle_summary to understand the bundle and freshness. Search before reading concepts, read only the most relevant concepts, inspect neighbors when relationships matter, and cite source_resource URLs in the final answer.`;
}

export type ServeCommandTarget = string | string[] | { all: true };

export function serveCommand(
  sourceNameOrNames: ServeCommandTarget,
  okfyHome: string,
  defaultHome = defaultOkfyHome(),
  options: ServeCommandOptions = {}
): ServeCommand {
  const args = ["-y", "okfy-ai", ...serveCommandArgs(sourceNameOrNames, options)];
  const env: Record<string, string> = needsOkfyHomeEnv(okfyHome, defaultHome)
    ? { OKFY_HOME: path.resolve(okfyHome) }
    : {};
  return {
    command: "npx",
    args,
    env,
    display: ["npx", ...args].join(" ")
  };
}

export function serveCommandArgs(
  sourceNameOrNames: ServeCommandTarget,
  options: ServeCommandOptions = {}
): string[] {
  const autoRefresh = options.autoRefresh ?? true;
  if (isAllCommandTarget(sourceNameOrNames)) {
    return autoRefresh
      ? ["serve", "--all", "--mcp", "--auto-refresh"]
      : ["serve", "--all", "--mcp"];
  }
  const sourceNames = Array.isArray(sourceNameOrNames) ? sourceNameOrNames : [sourceNameOrNames];
  if (sourceNames.some((sourceName) => sourceName.startsWith("-"))) {
    return autoRefresh
      ? ["serve", "--mcp", "--auto-refresh", "--", ...sourceNames]
      : ["serve", "--mcp", "--", ...sourceNames];
  }
  return autoRefresh
    ? ["serve", ...sourceNames, "--mcp", "--auto-refresh"]
    : ["serve", ...sourceNames, "--mcp"];
}

function isAllCommandTarget(
  sourceNameOrNames: ServeCommandTarget
): sourceNameOrNames is { all: true } {
  return (
    typeof sourceNameOrNames === "object" &&
    !Array.isArray(sourceNameOrNames) &&
    sourceNameOrNames.all
  );
}

export function setupCheck(
  id: string,
  label: string,
  severity: SetupCheckSeverity,
  message: string,
  fix?: string
): SetupCheck {
  return { id, label, severity, message, ...(fix ? { fix } : {}) };
}

export async function executableOnPath(
  command: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<boolean> {
  const searchPath = env.PATH ?? "";
  const extensions =
    process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  for (const directory of searchPath.split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      try {
        await fs.access(candidate, fs.constants.X_OK);
        return true;
      } catch {
        // Keep searching PATH.
      }
    }
  }
  return false;
}

export function evaluateMcpProbeMessages(messages: Array<Record<string, unknown>>): {
  ok: boolean;
  tools: string[];
  missingTools: string[];
} {
  const toolsResponse = messages.find((message) => message.id === 2) as
    | { result?: { tools?: Array<{ name?: string }> } }
    | undefined;
  const tools =
    toolsResponse?.result?.tools
      ?.map((tool) => tool.name)
      .filter((name): name is string => Boolean(name)) ?? [];
  const missingTools = EXPECTED_MCP_TOOLS.filter((tool) => !tools.includes(tool));
  return { ok: missingTools.length === 0, tools, missingTools };
}

export async function probeMcpStdio(options: McpProbeOptions): Promise<McpProbeResult> {
  const child = spawn(options.command, options.args, {
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  return probeChildProcess(child, options.timeoutMs ?? 5000);
}

async function probeChildProcess(
  child: ChildProcessWithoutNullStreams,
  timeoutMs: number
): Promise<McpProbeResult> {
  const messages: Array<Record<string, unknown>> = [];
  let stdoutBuffer = "";
  let stderr = "";
  let contamination: string | undefined;
  let spawnError: Error | undefined;
  let exit: ChildExit | undefined;
  const closed = new Promise<ChildExit>((resolve) => {
    child.once("close", (code, signal) => {
      exit = { code, signal };
      resolve(exit);
    });
  });

  child.on("error", (error) => {
    spawnError = error;
  });
  child.stdin.on("error", (error) => {
    spawnError ??= error;
  });
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuffer = appendBounded(stdoutBuffer, chunk.toString("utf8"));
    let newlineIndex = stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        try {
          if (messages.length >= MAX_MESSAGES)
            contamination = `MCP stdout exceeded ${MAX_MESSAGES} JSON-RPC messages.`;
          else messages.push(JSON.parse(line) as Record<string, unknown>);
        } catch {
          contamination = line;
        }
      }
      newlineIndex = stdoutBuffer.indexOf("\n");
    }
    if (stdoutBuffer.length >= MAX_CAPTURE_CHARS)
      contamination = `MCP stdout line exceeded ${MAX_CAPTURE_CHARS} characters.`;
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = appendBounded(stderr, chunk.toString("utf8"));
  });

  const send = (id: number, method: string, params: Record<string, unknown> = {}) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  };

  try {
    send(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "okfy-doctor", version: packageVersion() }
    });
    await waitForMessage(
      1,
      messages,
      () => contamination,
      () => spawnError,
      () => exit,
      () => stderr,
      timeoutMs
    );
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`
    );
    send(2, "tools/list");
    await waitForMessage(
      2,
      messages,
      () => contamination,
      () => spawnError,
      () => exit,
      () => stderr,
      timeoutMs
    );

    const result = evaluateMcpProbeMessages(messages);
    if (!result.ok) {
      return {
        ok: false,
        tools: result.tools,
        stderr,
        error: {
          code: "missing_tools",
          message: `MCP server did not expose expected tools: ${result.missingTools.join(", ")}.`
        }
      };
    }
    return { ok: true, tools: result.tools, stderr };
  } catch (error) {
    if (error instanceof ProbeFailure) {
      return { ok: false, tools: [], stderr, error: { code: error.code, message: error.message } };
    }
    return {
      ok: false,
      tools: [],
      stderr,
      error: {
        code: "protocol_error",
        message: error instanceof Error ? error.message : String(error)
      }
    };
  } finally {
    await stopChild(child, closed, () => exit);
  }
}

type ChildExit = { code: number | null; signal: NodeJS.Signals | null };

class ProbeFailure extends Error {
  constructor(
    public readonly code: NonNullable<McpProbeResult["error"]>["code"],
    message: string
  ) {
    super(message);
  }
}

async function waitForMessage(
  id: number,
  messages: Array<Record<string, unknown>>,
  contamination: () => string | undefined,
  spawnError: () => Error | undefined,
  childExit: () => ChildExit | undefined,
  capturedStderr: () => string,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const badLine = contamination();
    if (badLine)
      throw new ProbeFailure(
        "stdout_contamination",
        `MCP stdout contained non-JSON output: ${badLine}`
      );
    const error = spawnError();
    if (error) throw new ProbeFailure("startup_failed", error.message);
    const message = messages.find((candidate) => candidate.id === id);
    if (message) return message;
    const exit = childExit();
    if (exit) {
      const details = capturedStderr() ? ` stderr: ${truncate(capturedStderr())}` : "";
      throw new ProbeFailure(
        "startup_failed",
        `MCP subprocess exited before response ${id} (${formatExit(exit)}).${details}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new ProbeFailure("timeout", `Timed out waiting for MCP response ${id}.`);
}

async function stopChild(
  child: ChildProcessWithoutNullStreams,
  closed: Promise<ChildExit>,
  childExit: () => ChildExit | undefined
): Promise<void> {
  try {
    if (!child.stdin.destroyed) child.stdin.end();
  } catch {
    // Child may have already exited.
  }
  if (childExit()) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    closed.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 500))
  ]);
  if (!exited && !childExit()) child.kill("SIGKILL");
}

function appendBounded(current: string, addition: string): string {
  const next = current + addition;
  if (next.length <= MAX_CAPTURE_CHARS) return next;
  return next.slice(next.length - MAX_CAPTURE_CHARS);
}

function truncate(value: string): string {
  const normalized = value.trim();
  if (normalized.length <= MAX_DIAGNOSTIC_CHARS) return normalized;
  return `${normalized.slice(0, MAX_DIAGNOSTIC_CHARS)}...truncated`;
}

function formatExit(exit: ChildExit): string {
  if (exit.signal) return `signal ${exit.signal}`;
  return `exit code ${exit.code ?? "unknown"}`;
}

function needsOkfyHomeEnv(okfyHome: string, defaultHome: string): boolean {
  return path.resolve(okfyHome) !== path.resolve(defaultHome);
}

export function mcpServerName(sourceNameOrNames: string | string[]): string {
  const sourceNames = Array.isArray(sourceNameOrNames) ? sourceNameOrNames : [sourceNameOrNames];
  const safeName = sourceNames
    .map((sourceName) => sourceName.replace(/[._]+/g, "-").replace(/^-+/, ""))
    .filter(Boolean)
    .join("-");
  return `${safeName || "source"}-okf`;
}

export function codexMcpServerName(sourceNameOrNames: string | string[]): string {
  const sourceNames = Array.isArray(sourceNameOrNames) ? sourceNameOrNames : [sourceNameOrNames];
  const safeName = sourceNames
    .map((sourceName) => sourceName.replace(/[^a-z0-9]+/g, "_").replace(/^_+/, ""))
    .filter(Boolean)
    .join("_");
  return `${safeName || "source"}_okf`;
}

function setupSourceNames(input: {
  sourceName?: string;
  sourceNames?: string[];
  workspaceAll?: boolean;
}): string[] {
  const names = input.sourceNames ?? (input.sourceName ? [input.sourceName] : []);
  if (input.workspaceAll) return [...names];
  if (!names.length) throw new Error("Setup report requires at least one source name.");
  return [...names];
}

function shellEnvArgs(env: Record<string, string>, flag: "-e" | "--env"): string {
  const entries = Object.entries(env);
  if (!entries.length) return "";
  return entries.map(([key, value]) => ` ${flag} ${shellQuote(`${key}=${value}`)}`).join("");
}

function shellQuote(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function codexToml(
  serverName: string,
  command: ServeCommand,
  env: Record<string, string> | undefined
): string {
  const lines = [
    `[mcp_servers.${serverName}]`,
    `command = ${JSON.stringify(command.command)}`,
    `args = [${command.args.map((arg) => JSON.stringify(arg)).join(", ")}]`
  ];
  if (env?.OKFY_HOME) lines.push(`env = { OKFY_HOME = ${JSON.stringify(env.OKFY_HOME)} }`);
  lines.push("startup_timeout_sec = 20", "tool_timeout_sec = 60", "enabled = true");
  return lines.join("\n");
}
