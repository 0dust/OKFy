import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { packageVersion } from "../../src/metadata.js";

export interface McpSession {
  initializeResponse: Record<string, unknown>;
  stdoutLines: string[];
  stderr(): string;
  send(id: number, method: string, params?: Record<string, unknown>): void;
  waitFor<T extends Record<string, unknown> = Record<string, unknown>>(id: number): Promise<T>;
}

export async function withBuiltCliMcpSession<T>(
  args: string[],
  options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
  run: (session: McpSession) => Promise<T>
): Promise<T> {
  const cli = path.resolve("dist/cli.js");
  await fs.access(cli);
  const child = spawn(process.execPath, [cli, ...args], {
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  const stdoutLines: string[] = [];
  let stdoutBuffer = "";
  let stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdoutBuffer += chunk.toString("utf8");
    let newlineIndex = stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line) stdoutLines.push(line);
      newlineIndex = stdoutBuffer.indexOf("\n");
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });
  const send = (id: number, method: string, params: Record<string, unknown> = {}) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  };
  const waitFor = async <TMessage extends Record<string, unknown> = Record<string, unknown>>(
    id: number
  ): Promise<TMessage> => {
    const deadline = Date.now() + (options.timeoutMs ?? 5000);
    while (Date.now() < deadline) {
      for (const line of stdoutLines) {
        const parsed = JSON.parse(line) as { id?: number } & TMessage;
        if (parsed.id === id) return parsed;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(
      `Timed out waiting for MCP response ${id}; stdout=${stdoutLines.join("\n")} stderr=${stderr}`
    );
  };

  try {
    send(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "okfy-vitest", version: packageVersion() }
    });
    const initializeResponse = await waitFor(1);
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`
    );
    return await run({ initializeResponse, stdoutLines, stderr: () => stderr, send, waitFor });
  } finally {
    child.kill("SIGTERM");
  }
}
