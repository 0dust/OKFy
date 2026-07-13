import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("public surface", () => {
  let demoOutput: string;
  let versionOutput: string;
  let serveError: string;
  let transportError: string;
  let maxCharsError: string;
  let readme: string;
  let parsedPackage: { dependencies?: Record<string, string>; version?: string };
  let parsedManifest: Record<string, string>;

  beforeAll(async () => {
    const cli = path.resolve("dist/cli.js");
    await fs.access(cli);
    const [
      demoResult,
      versionResult,
      serveResult,
      transportResult,
      maxCharsResult,
      readmeContents,
      packageJson,
      manifest
    ] = await Promise.all([
      execFileAsync(process.execPath, [cli, "demo"]),
      execFileAsync(process.execPath, [cli, "--version"]),
      execFileAsync(process.execPath, [cli, "serve"]).catch((error: { stderr: string }) => ({
        stderr: error.stderr
      })),
      execFileAsync(process.execPath, [
        cli,
        "serve",
        "stripe",
        "--mcp",
        "--transport",
        "http"
      ]).catch((error: { stderr: string }) => ({
        stderr: error.stderr
      })),
      execFileAsync(process.execPath, [
        cli,
        "serve",
        "examples/bundles/okfy-docs",
        "--mcp",
        "--max-result-chars",
        "abc"
      ]).catch((error: { stderr: string }) => ({
        stderr: error.stderr
      })),
      fs.readFile("README.md", "utf8"),
      fs.readFile("package.json", "utf8"),
      fs.readFile(".release-please-manifest.json", "utf8")
    ]);
    demoOutput = demoResult.stdout;
    versionOutput = versionResult.stdout;
    serveError = serveResult.stderr;
    transportError = transportResult.stderr;
    maxCharsError = maxCharsResult.stderr;
    readme = readmeContents;
    parsedPackage = JSON.parse(packageJson) as {
      dependencies?: Record<string, string>;
      version?: string;
    };
    parsedManifest = JSON.parse(manifest) as Record<string, string>;
  });

  it("keeps CLI demo and validation errors on the public contract", () => {
    for (const expected of [
      "Offline bundle: examples/bundles/okfy-docs",
      "OKF bundle valid",
      "Concepts: 6",
      "Links: 10",
      "Broken links: 0"
    ]) {
      expect(demoOutput).toContain(expected);
    }
    expect(versionOutput.trim()).toBe(parsedPackage.version);
    expect(serveError).toContain("Only MCP server mode is supported.");
    expect(transportError).toContain("Only stdio transport is supported.");
    expect(maxCharsError).toContain("Expected max-result-chars to be an integer >= 1");
    expect(`${serveError}\n${transportError}\n${maxCharsError}`).not.toContain("v0.1");
  });

  it("keeps package and release versions aligned", () => {
    expect(parsedPackage.version).not.toBe("0.3.0");
    expect(parsedPackage.dependencies).not.toHaveProperty("gray-matter");
    expect(parsedPackage.dependencies?.["js-yaml"]).toMatch(/^\^4\./);
    expect(parsedManifest["."]).toBe(parsedPackage.version);
  });

  it("README points at public product assets and documents current workflows", () => {
    expect(readme).toContain("![okfy terminal demo](assets/demo.gif)");
    expect(readme).toContain(
      '<source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.png">'
    );
    expect(readme).toContain(
      '<source media="(prefers-color-scheme: light)" srcset="assets/logo-light.png">'
    );
    expect(readme).toContain(
      '<img src="assets/logo-light.png" alt="okfy logo: hand-drawn OKFY knowledge blocks" width="520">'
    );
    expect(readme).toContain("Open Knowledge Format for AI agents");
    expect(readme).not.toContain("assets/logo.png");
    expect(readme).not.toContain("assets/logo.svg");
    expect(readme).toContain("https://www.npmjs.com/package/okfy-ai");
    expect(readme).toContain(`npm-okfy--ai%40${parsedPackage.version}`);
    expect(readme).toContain("node-20%2B");
    expect(readme).not.toContain("Node.js >=20");
    expect(readme).toContain("[docs/mcp-clients.md](docs/mcp-clients.md)");
    expect(readme).toContain("Give coding agents searchable, source-linked documentation—locally.");
    expect(readme).toContain("## Quickstart");
    expect(readme).toContain("## Why OKFy");
    expect(readme).toContain("## Connect Your Agent");
    expect(readme).toContain("## Project Stack Workspaces");
    expect(readme).toContain("## Inspect And Share A Bundle");
    expect(readme).toContain("answer with original source references");
    expect(readme).toContain("No embedding service or LLM API key is required.");
    expect(readme).toContain(
      "npx -y okfy-ai init stripe https://docs.stripe.com/checkout --client codex"
    );
    expect(readme).toContain("npx -y okfy-ai doctor stripe --client codex");
    expect(readme).toContain("npx -y okfy-ai activate stripe --client codex --out okfy-activation");
    expect(readme).toContain("okfy-proof.json");
    expect(readme).toContain("Activation does not write client config files by default.");
    expect(readme).toContain("Preview what your agent will know");
    expect(readme).toContain("npx -y okfy-ai map stripe --out okfy-inspector.html");
    expect(readme).toContain("local static HTML Inspector");
    expect(readme).toContain(
      "Use `--json` when CI or tests need the same Inspector report model without writing HTML."
    );
    expect(readme).toContain("npx -y okfy-ai doctor stripe clerk --client codex");
    expect(readme).toContain("npx -y okfy-ai serve stripe clerk --mcp --auto-refresh");
    expect(readme).toContain(
      'npx -y okfy-ai import ./docs/api --out ./okf/api-docs --source-name "API docs"'
    );
    expect(readme).toContain(
      'npx -y okfy-ai import ./docs/product --out ./okf/product-docs --source-name "Product docs"'
    );
    expect(readme).not.toContain('--source-name "API docs" --force');
    expect(readme).not.toContain('--source-name "Product docs" --force');
    expect(readme).toContain("npx -y okfy-ai serve ./okf/api-docs ./okf/product-docs --mcp");
    expect(readme).toContain('"source": "stripe"');
    expect(readme).toContain("Use `bundle_summary` at the start of a workspace session");
    expect(readme).toContain("claude mcp add --transport stdio stripe-okf");
    expect(readme).toContain("[mcp_servers.stripe_okf]");
    expect(readme).toContain("[skills/okfy/SKILL.md](skills/okfy/SKILL.md)");
  });

  it("ships public README assets", async () => {
    const [demoStat, darkLogoStat, lightLogoStat] = await Promise.all([
      fs.stat("assets/demo.gif"),
      fs.stat("assets/logo-dark.png"),
      fs.stat("assets/logo-light.png")
    ]);
    expect(demoStat.size).toBeGreaterThan(500);
    expect(darkLogoStat.size).toBeGreaterThan(10_000);
    expect(lightLogoStat.size).toBeGreaterThan(10_000);
    expect(darkLogoStat.size).toBeLessThan(100_000);
    expect(lightLogoStat.size).toBeLessThan(100_000);
  });

  it("ships required example metadata for every launch example", async () => {
    for (const file of [
      "examples/bundles/okfy-docs/okfy-example.json",
      "examples/bundles/stripe-checkout-small/okfy-example.json",
      "examples/local-markdown/okfy-example.json"
    ]) {
      const raw = await fs.readFile(file, "utf8");
      const parsed = JSON.parse(raw) as {
        sourceCommand?: string;
        expectedConceptCount?: number;
        expectedValidationStatus?: string;
        suggestedAgentQuestions?: string[];
      };
      expect(parsed.sourceCommand).toBeTruthy();
      expect(parsed.sourceCommand).not.toMatch(/pnpm okfy|test-fixtures/);
      expect(parsed.expectedConceptCount).toBeGreaterThan(0);
      expect(parsed.expectedValidationStatus).toBe("valid");
      expect(parsed.suggestedAgentQuestions).toHaveLength(3);
    }
  });

  it("keeps npm package contents public and self-contained", async () => {
    const { stdout } = await execFileAsync("npm", [
      "pack",
      "--ignore-scripts",
      "--dry-run",
      "--json"
    ]);
    const pack = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
    const files = pack[0]?.files.map((file) => file.path).sort() ?? [];

    expect(files).toContain("README.md");
    expect(files).toContain("dist/setup-artifacts.js");
    expect(files).toContain("dist/setup-artifacts.d.ts");
    expect(files).toContain("dist/public/mcp.js");
    expect(files).toContain("dist/public/mcp.d.ts");
    expect(files).toContain("assets/logo-dark.png");
    expect(files).toContain("assets/logo-light.png");
    expect(files).not.toContain("assets/logo.png");
    expect(files).not.toContain("assets/logo.svg");
    expect(files).toContain("assets/demo.gif");
    expect(files).toContain("docs/mcp-clients.md");
    expect(files).toContain("examples/bundles/okfy-docs/index.md");
    expect(files).toContain("skills/okfy/SKILL.md");
    expect(files).toContain("skills/okfy/agents/openai.yaml");
    expect(files.some((file) => file.startsWith("launch/"))).toBe(false);
    expect(files.some((file) => file.startsWith("docs/plans/"))).toBe(false);
    expect(files.some((file) => file.startsWith("docs/brainstorms/"))).toBe(false);
    expect(files.some((file) => file.startsWith("docs/ideation/"))).toBe(false);
    expect(files.some((file) => file.startsWith("docs/prds/"))).toBe(false);
    expect(files).not.toContain("docs/okfy-mcp-prd.md");
  });

  it("ships an official OKFy agent skill", async () => {
    const [skill, openaiYaml] = await Promise.all([
      fs.readFile("skills/okfy/SKILL.md", "utf8"),
      fs.readFile("skills/okfy/agents/openai.yaml", "utf8")
    ]);

    expect(skill).toMatch(/^---\nname: okfy\ndescription: Use when /);
    expect(skill).toContain("# OKFy");
    expect(skill).toContain("npx -y okfy-ai init <name> <url> --client codex");
    expect(skill).toContain(
      'npx -y okfy-ai import ./docs --out ./docs-okf --source-name "Project docs"'
    );
    expect(skill).not.toContain(
      'npx -y okfy-ai import ./docs --out ./docs-okf --source-name "Project docs" --force'
    );
    expect(skill).toContain("Only add `--force` after the user explicitly approves overwriting");
    expect(skill).toContain("npx -y okfy-ai activate <name-or-bundle>");
    expect(skill).toContain("npx -y okfy-ai doctor <name>");
    expect(skill).toContain("npx -y okfy-ai map <name-or-bundle>");
    expect(skill).toContain("npx -y okfy-ai serve <name-or-bundle> --mcp --auto-refresh");
    expect(skill).toContain("bundle_summary");
    expect(skill).toContain("search_concepts");
    expect(skill).toContain("read_concept");
    expect(skill).toContain("get_neighbors");
    expect(skill).toContain("Use `source` filters");
    expect(skill).toContain("MCP tools are read-only");
    expect(skill).not.toContain("npx okfy ");
    expect(openaiYaml).toContain('display_name: "OKFy"');
    expect(openaiYaml).toContain("short_description:");
    expect(openaiYaml).toContain("default_prompt:");
    expect(openaiYaml).toContain("okfy");
    expect(openaiYaml).toContain("MCP");
  });

  it("imports only declared package API from a clean npm install", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-package-"));
    try {
      const { stdout } = await execFileAsync("npm", [
        "pack",
        "--ignore-scripts",
        "--json",
        "--pack-destination",
        tempRoot
      ]);
      const pack = JSON.parse(stdout) as Array<{ filename: string }>;
      const tarball = path.join(tempRoot, pack[0]!.filename);
      const appDir = path.join(tempRoot, "app");
      await fs.mkdir(appDir);
      await execFileAsync(
        "npm",
        ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
        {
          cwd: appDir
        }
      );

      const script = String.raw`
        const expectedRootKeys = [
          "BundleSearch",
          "MCP_TOOL_NAMES",
          "WorkspaceError",
          "WorkspaceSearch",
          "assertSafeForceOutDir",
          "assertUniqueWorkspaceRecordNames",
          "buildActivationPacket",
          "buildBundleInspectorReport",
          "buildGraph",
          "buildWorkspaceInspectorReport",
          "bundleSourceName",
          "crawlWebsite",
          "createMcpServer",
          "createWorkspaceMcpServer",
          "descriptionFromMarkdown",
          "evaluateFreshness",
          "extractHeadings",
          "extractInternalLinks",
          "extractMarkdownLinks",
          "hashBundleContents",
          "importLocal",
          "inferTags",
          "inferType",
          "inspectBundle",
          "isRegisteredWorkspaceRecord",
          "listSources",
          "localBundleRecord",
          "normalizeDocument",
          "okfyUserAgent",
          "packageMetadata",
          "packageVersion",
          "parseDurationSeconds",
          "protectedActivationInputPaths",
          "readBundle",
          "readConceptFile",
          "readRefreshState",
          "readSourceManifest",
          "readSourceRecord",
          "readWorkspaceProfile",
          "refreshSource",
          "removeSource",
          "renderActivationSetupMarkdown",
          "resolveBundleDir",
          "resolveOkfyHome",
          "resolveSourceDir",
          "resolveWorkspaceSources",
          "runtimePackageRoot",
          "serveMcpStdio",
          "serveWorkspaceMcpStdio",
          "validateBundle",
          "validateSourceName",
          "withActivationMetadata",
          "workspaceProfilePath",
          "writeActivationPacketFiles",
          "writeOkfBundle",
          "writeRefreshState",
          "writeSourceManifest",
          "writeWorkspaceProfile"
        ].sort();
        const expectedSetupKeys = [
          "codexMcpServerName",
          "expectedMcpTools",
          "firstAgentPrompt",
          "mcpServerName",
          "parseSetupClient",
          "renderClientArtifacts",
          "renderMcpClientArtifacts",
          "serveCommand",
          "serveCommandArgs"
        ].sort();
        const expectedMcpKeys = [
          "MCP_TOOL_NAMES",
          "createMcpServer",
          "createWorkspaceMcpServer",
          "serveMcpStdio",
          "serveWorkspaceMcpStdio"
        ].sort();
        const root = await import("okfy-ai");
        const mcp = await import("okfy-ai/mcp");
        const setup = await import("okfy-ai/setup");
        const actualRootKeys = Object.keys(root).sort();
        if (JSON.stringify(actualRootKeys) !== JSON.stringify(expectedRootKeys)) {
          throw new Error("Unexpected root exports: " + actualRootKeys.join(", "));
        }
        const actualSetupKeys = Object.keys(setup).sort();
        const actualMcpKeys = Object.keys(mcp).sort();
        if (JSON.stringify(actualMcpKeys) !== JSON.stringify(expectedMcpKeys)) {
          throw new Error("Unexpected MCP exports: " + actualMcpKeys.join(", "));
        }
        if (JSON.stringify(actualSetupKeys) !== JSON.stringify(expectedSetupKeys)) {
          throw new Error("Unexpected setup exports: " + actualSetupKeys.join(", "));
        }
        if (typeof root.validateBundle !== "function") throw new Error("Missing validateBundle");
        if (typeof root.createMcpServer !== "function") throw new Error("Missing createMcpServer");
        if (typeof root.buildActivationPacket !== "function") {
          throw new Error("Missing buildActivationPacket");
        }
        if (typeof setup.renderClientArtifacts !== "function") {
          throw new Error("Missing setup renderClientArtifacts");
        }
        if (!setup.expectedMcpTools().includes("search_concepts")) {
          throw new Error("Missing setup expectedMcpTools");
        }
        if (!setup.serveCommand("stripe", "/tmp/okfy").display.includes("serve stripe --mcp")) {
          throw new Error("Missing setup serveCommand");
        }
        async function expectBlocked(specifier) {
          try {
            await import(specifier);
          } catch (error) {
            if (error?.code === "ERR_PACKAGE_PATH_NOT_EXPORTED") return;
            throw error;
          }
          throw new Error("Internal subpath unexpectedly imported: " + specifier);
        }
        await expectBlocked("okfy-ai/src/source-store.js");
        await expectBlocked("okfy-ai/dist/index.js");
        await expectBlocked("okfy-ai/bundles");
        await expectBlocked("okfy-ai/sources");
        console.log("ok");
      `;
      await expect(
        execFileAsync(process.execPath, ["--input-type=module", "-e", script], { cwd: appDir })
      ).resolves.toMatchObject({ stdout: "ok\n" });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("documents the publishable npm package", async () => {
    const [packageJson, readme, npmReadme, mcpDocs, examplesReadme] = await Promise.all([
      fs.readFile("package.json", "utf8"),
      fs.readFile("README.md", "utf8"),
      fs.readFile("scripts/npm-readme.md", "utf8"),
      fs.readFile("docs/mcp-clients.md", "utf8"),
      fs.readFile("examples/README.md", "utf8")
    ]);
    const parsed = JSON.parse(packageJson) as {
      name?: string;
      bin?: Record<string, string>;
      main?: string;
      types?: string;
      exports?: Record<string, unknown>;
    };
    const publicCopy = `${readme}\n${npmReadme}\n${mcpDocs}\n${examplesReadme}`;

    expect(parsed.name).toBe("okfy-ai");
    expect(parsed.bin?.okfy).toBe("dist/cli.js");
    expect(parsed.bin?.["okfy-ai"]).toBe("dist/cli.js");
    expect(parsed.main).toBe("./dist/index.js");
    expect(parsed.types).toBe("./dist/index.d.ts");
    expect(parsed.exports?.["."]).toMatchObject({
      types: "./dist/index.d.ts",
      import: "./dist/index.js"
    });
    expect(parsed.exports?.["./setup"]).toMatchObject({
      types: "./dist/setup-artifacts.d.ts",
      import: "./dist/setup-artifacts.js"
    });
    expect(parsed.exports?.["./mcp"]).toEqual({
      types: "./dist/public/mcp.d.ts",
      import: "./dist/public/mcp.js"
    });
    await expect(
      execFileAsync(process.execPath, [
        "--input-type=module",
        "-e",
        "import('okfy-ai').then((mod) => console.log(`${typeof mod.validateBundle}:${typeof mod.writeSourceManifest}`))"
      ])
    ).resolves.toMatchObject({ stdout: "function:function\n" });
    expect(readme).toContain(
      "`okfy-ai` is the npm package name. `okfy` is the installed CLI command."
    );
    expect(readme).toContain("You do not need global install for MCP configs.");
    expect(readme).toContain("MCP clients start it as a subprocess");
    expect(readme).toContain("Programmatic imports remain compatible");
    expect(readme).toContain('from "okfy-ai/mcp"');
    expect(readme).toContain("New setup-only code can import");
    expect(readme).toContain("Preflight DNS-resolved private targets");
    expect(readme).toContain("The MCP server exposes read-only tools.");
    expect(readme).toContain("okfy init <name> <url>");
    expect(readme).toContain("okfy doctor <name> [more-names...]");
    expect(readme).toContain(
      "okfy activate <name-or-bundle> [more-source-names...] --client codex --out okfy-activation"
    );
    expect(readme).not.toContain("including DNS-resolved hosts and redirects");
    expect(npmReadme).toContain("# okfy-ai");
    expect(npmReadme).toContain("npm install -g okfy-ai");
    expect(npmReadme).toContain(
      "`okfy-ai` is the npm package name. `okfy` is the installed CLI command."
    );
    expect(npmReadme).toContain("Programmatic imports remain compatible");
    expect(npmReadme).toContain('from "okfy-ai/mcp"');
    expect(npmReadme).toContain("New setup-only code can import");
    expect(npmReadme).toContain("Preflight DNS-resolved private targets");
    expect(npmReadme).toContain(
      "MCP tools are read-only; refresh is server-side maintenance, not an agent-callable write tool."
    );
    expect(npmReadme).not.toContain("including DNS-resolved hosts and redirects");
    expect(npmReadme).toContain(
      "Give coding agents searchable, source-linked documentation—locally."
    );
    expect(npmReadme).toContain("no hosted index, embedding service, or LLM API key");
    expect(npmReadme).toContain("Preview what your agent will know");
    expect(npmReadme).toContain(
      "npx -y okfy-ai activate stripe --client codex --out okfy-activation"
    );
    expect(npmReadme).toContain("okfy-proof.json");
    expect(npmReadme).toContain("npx -y okfy-ai map stripe --out okfy-inspector.html");
    expect(npmReadme).toContain("local static HTML Inspector");
    expect(npmReadme).toContain("## Quickstart");
    expect(npmReadme).toContain("## Why OKFy");
    expect(npmReadme).toContain("## Connect An MCP Client");
    expect(npmReadme).toContain("## Multi-Source Workspaces");
    expect(npmReadme).toContain("## Inspect And Share");
    expect(npmReadme).toContain(
      "npx -y okfy-ai init stripe https://docs.stripe.com/checkout --client generic"
    );
    expect(npmReadme).toContain("npx -y okfy-ai doctor stripe --client codex");
    expect(npmReadme).toContain("npx -y okfy-ai doctor stripe clerk --client codex");
    expect(npmReadme).toContain("npx -y okfy-ai serve stripe clerk --mcp --auto-refresh");
    expect(npmReadme).toContain(
      'npx -y okfy-ai import ./docs/api --out ./okf/api-docs --source-name "API docs"'
    );
    expect(npmReadme).toContain(
      'npx -y okfy-ai import ./docs/product --out ./okf/product-docs --source-name "Product docs"'
    );
    expect(npmReadme).not.toContain('--source-name "API docs" --force');
    expect(npmReadme).not.toContain('--source-name "Product docs" --force');
    expect(npmReadme).toContain("npx -y okfy-ai serve ./okf/api-docs ./okf/product-docs --mcp");
    expect(npmReadme).toContain("Search and read tools accept a `source` filter");
    expect(npmReadme).toContain("claude mcp add --transport stdio stripe-okf");
    expect(npmReadme).toContain("[mcp_servers.stripe_okf]");
    expect(npmReadme).not.toContain("assets/logo.svg");
    expect(mcpDocs).toContain("The default setup uses `npx -y okfy-ai`");
    expect(mcpDocs).toContain(
      "npx -y okfy-ai init stripe https://docs.stripe.com/checkout --client generic"
    );
    expect(mcpDocs).toContain("npx -y okfy-ai doctor stripe --client codex");
    expect(mcpDocs).toContain(
      "npx -y okfy-ai activate stripe --client codex --out okfy-activation"
    );
    expect(mcpDocs).toContain("okfy-setup.md");
    expect(mcpDocs).toContain("Activation does not write client files.");
    expect(mcpDocs).toContain("npx -y okfy-ai map stripe --out okfy-inspector.html");
    expect(mcpDocs).toContain("local static HTML file");
    expect(mcpDocs).toContain(
      "Use `--json` when you need the Inspector report model on stdout without writing the HTML file."
    );
    expect(mcpDocs).toContain("npx -y okfy-ai doctor stripe clerk --client codex");
    expect(mcpDocs).toContain("npx -y okfy-ai add stripe https://docs.stripe.com/checkout");
    expect(mcpDocs).toContain("npx -y okfy-ai serve stripe --mcp --auto-refresh");
    expect(mcpDocs).toContain("npx -y okfy-ai serve stripe clerk --mcp --auto-refresh");
    expect(mcpDocs).toContain(
      'npx -y okfy-ai import ./docs/api --out ./okf/api-docs --source-name "API docs" --force'
    );
    expect(mcpDocs).toContain(
      'npx -y okfy-ai import ./docs/product --out ./okf/product-docs --source-name "Product docs" --force'
    );
    expect(mcpDocs).toContain("npx -y okfy-ai serve ./okf/api-docs ./okf/product-docs --mcp");
    expect(mcpDocs).toContain(
      'search_concepts({ "query": "checkout sessions", "source": "stripe", "limit": 5 })'
    );
    expect(mcpDocs).toContain("ambiguous_concept");
    expect(mcpDocs).toContain("Workspace mode keeps the same read-only tools.");
    expect(mcpDocs).toContain(
      "Direct bundle paths, including local bundle workspaces, do not use source auto-refresh."
    );
    expect(mcpDocs).toContain('args": ["-y", "okfy-ai", "serve", "./docs-okf", "--mcp"]');
    expect(mcpDocs).toContain("search_concepts(query, source?, type?, tags?, limit?)");
    expect(mcpDocs).toContain("read_concept(id, source?, max_chars?)");
    expect(mcpDocs).toContain("get_neighbors(id, source?, depth?)");
    expect(examplesReadme).toContain("Preview what your agent will know");
    expect(examplesReadme).toContain(
      "npx -y okfy-ai activate examples/bundles/stripe-checkout-small --client codex --out stripe-activation"
    );
    expect(examplesReadme).toContain("npx -y okfy-ai map stripe --out okfy-inspector.html");
    expect(examplesReadme).toContain("okfy map ./tmp/okfy-docs --out okfy-inspector.html");
    expect(examplesReadme).not.toMatch(/pnpm okfy|test-fixtures/);
    expect(`${readme}\n${npmReadme}\n${mcpDocs}`).not.toMatch(/npx -y okfy(?:@|\s)/);
    for (const forbidden of [
      /hosted accounts?/i,
      /hosted dashboards?/i,
      /cloud dashboards?/i,
      /telemetry/i,
      /generic codebase graph/i,
      /generic code graph/i,
      /media graph/i,
      /universal codebase graph/i
    ]) {
      expect(publicCopy).not.toMatch(forbidden);
    }
  });
});
