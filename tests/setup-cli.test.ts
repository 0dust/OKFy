import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { readRefreshState, readSourceManifest, writeRefreshState } from "../src/source-store.js";

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

async function tempHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-setup-cli-"));
  tempDirs.push(dir);
  return dir;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch (error: any) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function startDocsServer(): Promise<{ origin: string; close(): Promise<void> }> {
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    if (request.url === "/") {
      response.end('<main><h1>Checkout</h1><a href="/sessions">Sessions</a></main>');
    } else if (request.url === "/sessions") {
      response.end("<main><h1>Sessions</h1><p>Create Checkout Sessions.</p></main>");
    } else {
      response.statusCode = 404;
      response.end("missing");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP test server.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}

async function runCli(
  args: string[],
  okfyHome: string,
  options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}
): Promise<{ stdout: string; stderr: string }> {
  const cli = path.resolve("dist/cli.js");
  await fs.access(cli);
  return execFileAsync(process.execPath, [cli, ...args], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env, OKFY_HOME: okfyHome }
  });
}

function parseJson<T>(stdout: string): T {
  return JSON.parse(stdout) as T;
}

async function stateHash(okfyHome: string, name: string): Promise<string | undefined> {
  return (await readRefreshState(name, { okfyHome })).bundle?.contentHash;
}

async function markSourceOld(okfyHome: string, name: string): Promise<void> {
  const state = await readRefreshState(name, { okfyHome });
  await writeRefreshState(
    name,
    {
      ...state,
      status: "fresh",
      lastSuccessfulRefreshAt: "2026-01-01T00:00:00.000Z",
      nextRefreshAllowedAt: "2026-01-01T00:00:00.000Z"
    },
    { okfyHome }
  );
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("setup CLI flow", () => {
  it("initializes a registered source and prints Codex config without writing client files", async () => {
    const okfyHome = await tempHome();
    const userHome = await tempHome();
    const projectCwd = await tempHome();
    const xdgHome = path.join(userHome, "xdg");
    await fs.mkdir(xdgHome, { recursive: true });
    const docs = await startDocsServer();
    try {
      const result = await runCli(
        [
          "init",
          "stripe",
          `${docs.origin}/`,
          "--client",
          "codex",
          "--max-pages",
          "3",
          "--max-depth",
          "1",
          "--allow-private-network",
          "--no-respect-robots",
          "--json"
        ],
        okfyHome,
        { cwd: projectCwd, env: { HOME: userHome, XDG_CONFIG_HOME: xdgHome } }
      );

      const payload = parseJson<{
        sourceName: string;
        client: string;
        status: string;
        okfyHome: string;
        command: { display: string; env: Record<string, string> };
        firstPrompt: string;
        artifacts: Array<{ label: string; body: string }>;
        checks: Array<{ id: string; severity: string }>;
      }>(result.stdout);

      expect(payload).toMatchObject({
        sourceName: "stripe",
        client: "codex",
        status: "ready",
        okfyHome
      });
      expect(payload.command.display).toBe("npx -y okfy-ai serve stripe --mcp --auto-refresh");
      expect(payload.command.env).toEqual({ OKFY_HOME: okfyHome });
      expect(payload.firstPrompt).toContain("bundle_summary");
      expect(payload.firstPrompt).toContain("cite source_resource");
      expect(payload.firstPrompt).toContain("stripe_okf");
      expect(payload.artifacts.map((artifact) => artifact.label)).toContain("Codex config.toml");
      expect(payload.artifacts[0]?.body).toContain("[mcp_servers.stripe_okf]");
      expect(payload.checks).toEqual(expect.arrayContaining([expect.objectContaining({ id: "mcp_probe", severity: "pass" })]));
      expect(result.stderr).toContain("okfy crawl: starting");
      expect(await pathExists(path.join(userHome, ".codex", "config.toml"))).toBe(false);
      expect(await pathExists(path.join(xdgHome, "Claude", "claude_desktop_config.json"))).toBe(false);
      expect(await pathExists(path.join(projectCwd, ".mcp.json"))).toBe(false);
      expect(await pathExists(path.join(projectCwd, ".cursor", "mcp.json"))).toBe(false);
    } finally {
      await docs.close();
    }
  });

  it("reports stale, invalid, missing-npx, and unknown sources through doctor", async () => {
    const okfyHome = await tempHome();
    const docs = await startDocsServer();
    try {
      await runCli(
        [
          "add",
          "stripe",
          `${docs.origin}/`,
          "--max-pages",
          "3",
          "--max-depth",
          "1",
          "--allow-private-network",
          "--no-respect-robots",
          "--json"
        ],
        okfyHome
      );
      const hashAfterAdd = await stateHash(okfyHome, "stripe");
      expect(hashAfterAdd).toMatch(/^sha256:/);
      await markSourceOld(okfyHome, "stripe");

      const stale = parseJson<{ status: string; checks: Array<{ id: string; severity: string; fix?: string }> }>(
        (await runCli(["doctor", "stripe", "--json"], okfyHome)).stdout
      );

      expect(stale.status).toBe("warning");
      expect(stale.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "freshness", severity: "warn", fix: expect.stringContaining("update stripe") })
        ])
      );
      await expect(stateHash(okfyHome, "stripe")).resolves.toBe(hashAfterAdd);

      const fakeBin = await tempHome();
      await fs.writeFile(path.join(fakeBin, "npx"), "#!/bin/sh\necho broken npx >&2\nexit 42\n", "utf8");
      await fs.chmod(path.join(fakeBin, "npx"), 0o755);
      let npxError: { stdout?: string } | undefined;
      try {
        await runCli(["doctor", "stripe", "--json"], okfyHome, { env: { PATH: fakeBin } });
      } catch (error) {
        npxError = error as { stdout?: string };
      }
      const npxReport = parseJson<{ status: string; checks: Array<{ id: string; severity: string; message?: string }> }>(
        npxError?.stdout ?? ""
      );
      expect(npxReport.status).toBe("failed");
      expect(npxReport.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "npx", severity: "fail", message: expect.stringContaining("broken npx") }),
          expect.objectContaining({ id: "mcp_probe", severity: "warn" })
        ])
      );

      await fs.rm(path.join(okfyHome, "sources", "stripe", "bundle"), { recursive: true, force: true });
      let missingBundleError: { stdout?: string } | undefined;
      try {
        await runCli(["doctor", "stripe", "--json"], okfyHome);
      } catch (error) {
        missingBundleError = error as { stdout?: string };
      }
      const missingBundle = parseJson<{ status: string; checks: Array<{ id: string; severity: string }> }>(
        missingBundleError?.stdout ?? ""
      );
      expect(missingBundle.status).toBe("failed");
      expect(missingBundle.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "bundle", severity: "fail" }),
          expect.objectContaining({ id: "mcp_probe", severity: "warn" })
        ])
      );

      let missingError: { stdout?: string } | undefined;
      try {
        await runCli(["doctor", "missing", "--json"], okfyHome);
      } catch (error) {
        missingError = error as { stdout?: string };
      }
      const missing = parseJson<{ sourceName: string; status: string; okfyHome: string; checks: Array<{ id: string; severity: string; fix?: string }> }>(
        missingError?.stdout ?? ""
      );
      expect(missing).toMatchObject({ sourceName: "missing", status: "failed", okfyHome });
      expect(missing.checks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "source", severity: "fail", fix: expect.stringContaining("npx -y okfy-ai sources") })
        ])
      );
    } finally {
      await docs.close();
    }
  });

  it("preserves an existing source when forced init fails before replacement", async () => {
    const okfyHome = await tempHome();
    const docs = await startDocsServer();
    try {
      await runCli(
        [
          "add",
          "stripe",
          `${docs.origin}/`,
          "--max-pages",
          "3",
          "--max-depth",
          "1",
          "--allow-private-network",
          "--no-respect-robots",
          "--json"
        ],
        okfyHome
      );
      const before = await readSourceManifest("stripe", { okfyHome });

      let initError: { stdout?: string } | undefined;
      try {
        await runCli(["init", "stripe", "not-a-url", "--force", "--json"], okfyHome);
      } catch (error) {
        initError = error as { stdout?: string };
      }
      const failure = parseJson<{ status: string; checks: Array<{ id: string; severity: string }> }>(initError?.stdout ?? "");

      expect(failure.status).toBe("failed");
      expect(failure.checks).toEqual(expect.arrayContaining([expect.objectContaining({ id: "source", severity: "fail" })]));
      await expect(readSourceManifest("stripe", { okfyHome })).resolves.toEqual(before);
      await expect(fs.access(path.join(okfyHome, "sources", "stripe", "bundle", "sessions.md"))).resolves.toBeUndefined();
    } finally {
      await docs.close();
    }
  });
});
