import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createSetupReport,
  defaultOkfyHome,
  evaluateMcpProbeMessages,
  executableOnPath,
  expectedMcpTools,
  firstAgentPrompt,
  parseSetupClient,
  probeMcpStdio,
  renderClientArtifacts,
  renderMcpClientArtifacts,
  serveCommand,
  setupCheck
} from "../src/setup.js";

describe("setup client artifacts", () => {
  it("renders npx serve commands without OKFY_HOME for the default source store", () => {
    const okfyHome = defaultOkfyHome();

    const command = serveCommand("stripe", okfyHome);
    const json = renderClientArtifacts({ client: "generic", sourceName: "stripe", okfyHome })[0];
    const codex = renderClientArtifacts({ client: "codex", sourceName: "stripe", okfyHome })[0];
    const claude = renderClientArtifacts({
      client: "claude-code",
      sourceName: "stripe",
      okfyHome
    })[0];

    expect(command).toMatchObject({
      command: "npx",
      args: ["-y", "okfy-ai", "serve", "stripe", "--mcp", "--auto-refresh"],
      env: {},
      display: "npx -y okfy-ai serve stripe --mcp --auto-refresh"
    });
    expect(json.body).toContain('"args": [');
    expect(json.body).toContain('"okfy-ai"');
    expect(json.body).not.toContain("OKFY_HOME");
    expect(codex.body).toContain("[mcp_servers.stripe_okf]");
    expect(codex.body).not.toContain("OKFY_HOME");
    expect(claude.body).toBe(
      "claude mcp add --transport stdio stripe-okf -- npx -y okfy-ai serve stripe --mcp --auto-refresh"
    );
  });

  it("renders option-like legacy source names without broken CLI parsing", () => {
    const okfyHome = defaultOkfyHome();
    const command = serveCommand("-legacy", okfyHome);
    const claude = renderClientArtifacts({
      client: "claude-code",
      sourceName: "-legacy",
      okfyHome
    })[0];
    const codex = renderClientArtifacts({ client: "codex", sourceName: "-legacy", okfyHome });

    expect(command.args).toEqual([
      "-y",
      "okfy-ai",
      "serve",
      "--mcp",
      "--auto-refresh",
      "--",
      "-legacy"
    ]);
    expect(command.display).toBe("npx -y okfy-ai serve --mcp --auto-refresh -- -legacy");
    expect(claude.body).toContain("legacy-okf");
    expect(claude.body).not.toContain(" -legacy-okf ");
    expect(codex[0]?.body).toContain("[mcp_servers.legacy_okf]");
    expect(codex[1]?.body).toContain("legacy_okf");
  });

  it("renders explicit activation artifacts around local bundle commands", () => {
    const okfyHome = defaultOkfyHome();
    const command = serveCommand("/tmp/docs-okf", okfyHome, okfyHome, { autoRefresh: false });
    const spacedCommand = serveCommand("/tmp/okfy review spaced/okf valid", okfyHome, okfyHome, {
      autoRefresh: false
    });
    const codex = renderMcpClientArtifacts({
      client: "codex",
      serverName: "docs-okf",
      codexServerName: "docs_okf",
      command
    });
    const spacedCodex = renderMcpClientArtifacts({
      client: "codex",
      serverName: "docs-okf",
      codexServerName: "docs_okf",
      command: spacedCommand
    });
    const generic = renderMcpClientArtifacts({
      client: "generic",
      serverName: "docs-okf",
      codexServerName: "docs_okf",
      command
    })[0];

    expect(command.args).toEqual(["-y", "okfy-ai", "serve", "/tmp/docs-okf", "--mcp"]);
    expect(command.display).toBe("npx -y okfy-ai serve /tmp/docs-okf --mcp");
    expect(codex[0]?.body).toContain("[mcp_servers.docs_okf]");
    expect(codex[0]?.body).toContain('"serve", "/tmp/docs-okf", "--mcp"');
    expect(codex[1]?.body).toContain(
      "codex mcp add docs_okf -- npx -y okfy-ai serve /tmp/docs-okf --mcp"
    );
    expect(spacedCommand.args).toEqual([
      "-y",
      "okfy-ai",
      "serve",
      "/tmp/okfy review spaced/okf valid",
      "--mcp"
    ]);
    expect(spacedCommand.display).toBe(
      "npx -y okfy-ai serve '/tmp/okfy review spaced/okf valid' --mcp"
    );
    expect(spacedCodex[0]?.body).toContain('"serve", "/tmp/okfy review spaced/okf valid", "--mcp"');
    expect(spacedCodex[1]?.body).toContain(
      "codex mcp add docs_okf -- npx -y okfy-ai serve '/tmp/okfy review spaced/okf valid' --mcp"
    );
    expect(generic.body).toContain('"docs-okf"');
    expect(generic.body).not.toContain("--auto-refresh");
  });

  it("renders one workspace MCP command for multiple sources", () => {
    const okfyHome = defaultOkfyHome();

    const command = serveCommand(["stripe", "clerk"], okfyHome);
    const generic = renderClientArtifacts({
      client: "generic",
      sourceNames: ["stripe", "clerk"],
      okfyHome
    })[0];
    const codex = renderClientArtifacts({
      client: "codex",
      sourceNames: ["stripe", "clerk"],
      okfyHome
    });
    const claude = renderClientArtifacts({
      client: "claude-code",
      sourceNames: ["stripe", "clerk"],
      okfyHome
    })[0];
    const report = createSetupReport({
      sourceNames: ["stripe", "clerk"],
      client: "codex",
      checks: [setupCheck("source", "Sources", "pass", "Sources exist.")]
    });

    expect(command).toMatchObject({
      command: "npx",
      args: ["-y", "okfy-ai", "serve", "stripe", "clerk", "--mcp", "--auto-refresh"],
      env: {},
      display: "npx -y okfy-ai serve stripe clerk --mcp --auto-refresh"
    });
    expect(generic.body).toContain('"args": [');
    expect(generic.body).toContain('"stripe"');
    expect(generic.body).toContain('"clerk"');
    expect(codex[0]?.body).toContain("[mcp_servers.stripe_clerk_okf]");
    expect(codex[1]?.body).toContain(
      "codex mcp add stripe_clerk_okf -- npx -y okfy-ai serve stripe clerk --mcp --auto-refresh"
    );
    expect(claude.body).toBe(
      "claude mcp add --transport stdio stripe-clerk-okf -- npx -y okfy-ai serve stripe clerk --mcp --auto-refresh"
    );
    expect(report).toMatchObject({
      workspace: true,
      sourceName: "stripe, clerk",
      sourceNames: ["stripe", "clerk"]
    });
    expect(report.firstPrompt).toContain("workspace sources");
    expect(report.firstPrompt).toContain("Filter by source");
  });

  it("renders --all workspace MCP commands without pinning concrete sources", () => {
    const okfyHome = defaultOkfyHome();

    const command = serveCommand({ all: true }, okfyHome);
    const generic = renderClientArtifacts({ client: "generic", workspaceAll: true, okfyHome })[0];
    const report = createSetupReport({
      sourceNames: ["stripe"],
      workspaceAll: true,
      client: "codex",
      checks: [setupCheck("source", "Sources", "pass", "Sources exist.")]
    });

    expect(command).toMatchObject({
      command: "npx",
      args: ["-y", "okfy-ai", "serve", "--all", "--mcp", "--auto-refresh"],
      env: {},
      display: "npx -y okfy-ai serve --all --mcp --auto-refresh"
    });
    expect(generic.body).toContain('"all-okf"');
    expect(generic.body).toContain('"--all"');
    expect(report).toMatchObject({
      workspace: true,
      workspaceAll: true,
      sourceName: "stripe",
      sourceNames: ["stripe"],
      serverName: "all-okf",
      codexServerName: "all_okf"
    });
    expect(report.command.display).toBe("npx -y okfy-ai serve --all --mcp --auto-refresh");
    expect(report.firstPrompt).toContain("workspace sources");
  });

  it("renders workspace OKFY_HOME overrides for non-default source stores", () => {
    const okfyHome = path.join(os.tmpdir(), "okfy workspace setup render test");

    const generic = renderClientArtifacts({
      client: "generic",
      sourceNames: ["stripe", "clerk"],
      okfyHome
    })[0];
    const codexArtifacts = renderClientArtifacts({
      client: "codex",
      sourceNames: ["stripe", "clerk"],
      okfyHome
    });
    const codex = codexArtifacts[0];
    const codexCli = codexArtifacts.find((artifact) => artifact.label === "Codex CLI");
    const claude = renderClientArtifacts({
      client: "claude-code",
      sourceNames: ["stripe", "clerk"],
      okfyHome
    })[0];

    expect(generic.body).toContain(`"OKFY_HOME": "${okfyHome}"`);
    expect(codex.body).toContain(`env = { OKFY_HOME = "${okfyHome}" }`);
    expect(codexCli?.body).toContain(`--env 'OKFY_HOME=${okfyHome}'`);
    expect(claude.body).toContain(`-e 'OKFY_HOME=${okfyHome}'`);
  });

  it("renders OKFY_HOME overrides for non-default source stores", () => {
    const okfyHome = path.join(os.tmpdir(), "okfy setup render test");

    const generic = renderClientArtifacts({ client: "generic", sourceName: "stripe", okfyHome })[0];
    const codexArtifacts = renderClientArtifacts({
      client: "codex",
      sourceName: "stripe",
      okfyHome
    });
    const codex = codexArtifacts[0];
    const codexCli = codexArtifacts.find((artifact) => artifact.label === "Codex CLI");
    const claude = renderClientArtifacts({
      client: "claude-code",
      sourceName: "stripe",
      okfyHome
    })[0];

    expect(generic.body).toContain('"env": {');
    expect(generic.body).toContain(`"OKFY_HOME": "${okfyHome}"`);
    expect(codex.body).toContain(`env = { OKFY_HOME = "${okfyHome}" }`);
    expect(codexCli?.body).toContain(`--env 'OKFY_HOME=${okfyHome}'`);
    expect(claude.body).toContain(`-e 'OKFY_HOME=${okfyHome}'`);
  });

  it("renders every supported client family and normalizes aliases", () => {
    expect(parseSetupClient("claude")).toBe("claude-code");
    expect(parseSetupClient("cursor")).toBe("mcp-json");
    expect(parseSetupClient("claude-desktop")).toBe("mcp-json");
    expect(parseSetupClient("codex")).toBe("codex");
    expect(parseSetupClient("json")).toBe("generic");

    const okfyHome = defaultOkfyHome();
    expect(
      renderClientArtifacts({ client: "claude-code", sourceName: "stripe", okfyHome })[0].format
    ).toBe("shell");
    expect(
      renderClientArtifacts({ client: "mcp-json", sourceName: "stripe", okfyHome })[0].format
    ).toBe("json");
    expect(
      renderClientArtifacts({ client: "codex", sourceName: "stripe", okfyHome }).map(
        (artifact) => artifact.format
      )
    ).toEqual(["toml", "shell"]);
    expect(
      renderClientArtifacts({ client: "generic", sourceName: "stripe", okfyHome })[0].format
    ).toBe("json");
  });

  it("prints first prompt guidance and structured report severity", () => {
    const prompt = firstAgentPrompt("stripe-okf");
    expect(prompt).toContain("bundle_summary");
    expect(prompt).toContain("Search before reading");
    expect(prompt).toContain("inspect neighbors");
    expect(prompt).toContain("cite source_resource");

    const report = createSetupReport({
      sourceName: "stripe",
      client: "codex",
      checks: [
        setupCheck("source", "Source", "pass", "Source exists."),
        setupCheck(
          "freshness",
          "Freshness",
          "warn",
          "Source is stale.",
          "Run npx -y okfy-ai update stripe."
        ),
        setupCheck("mcp", "MCP", "fail", "MCP did not start.", "Run doctor again.")
      ]
    });

    expect(report.status).toBe("failed");
    expect(JSON.stringify(report)).not.toContain(`${String.fromCharCode(27)}[`);
    expect(report.firstPrompt).toContain("stripe_okf");
  });
});

describe("MCP probe message evaluation", () => {
  it("passes only when expected read-only tools are visible", () => {
    const passing = evaluateMcpProbeMessages([
      { id: 1, result: {} },
      { id: 2, result: { tools: expectedMcpTools().map((name) => ({ name })) } }
    ]);

    expect(passing).toMatchObject({ ok: true, missingTools: [] });
    expect(passing.tools).toContain("bundle_summary");

    const failing = evaluateMcpProbeMessages([
      { id: 2, result: { tools: [{ name: "bundle_summary" }] } }
    ]);

    expect(failing.ok).toBe(false);
    expect(failing.missingTools).toContain("search_concepts");
  });

  it("treats non-JSON stdout as MCP protocol contamination", async () => {
    const result = await probeMcpStdio({
      command: process.execPath,
      args: ["-e", "console.log('human log on stdout'); setTimeout(() => {}, 5000);"],
      timeoutMs: 1000
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("stdout_contamination");
    expect(result.error?.message).toContain("human log on stdout");
  });

  it("reports startup failure when the subprocess exits before responding", async () => {
    const result = await probeMcpStdio({
      command: process.execPath,
      args: ["-e", "process.stderr.write('boom'); process.exit(2);"],
      timeoutMs: 1000
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("startup_failed");
    expect(result.error?.message).toContain("exit code 2");
    expect(result.error?.message).toContain("boom");
  });
});

describe("setup environment checks", () => {
  it("detects missing executables on PATH", async () => {
    await expect(executableOnPath("npx", { PATH: "" })).resolves.toBe(false);
  });
});
