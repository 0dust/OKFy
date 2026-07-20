import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("public surface", () => {
  it("README points at public product assets and current demo output", async () => {
    const cli = path.resolve("dist/cli.js");
    await fs.access(cli);
    const [
      { stdout: demoOutput },
      { stdout: versionOutput },
      { stderr: serveError },
      { stderr: transportError },
      { stderr: maxCharsError },
      readme,
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
    const parsedPackage = JSON.parse(packageJson) as {
      dependencies?: Record<string, string>;
      version?: string;
    };
    const parsedManifest = JSON.parse(manifest) as Record<string, string>;

    for (const expected of [
      "Offline bundle: examples/bundles/okfy-docs",
      "OKF bundle valid",
      "Concepts: 6",
      "Links: 10",
      "Broken links: 0"
    ]) {
      expect(demoOutput).toContain(expected);
    }
    expect(parsedPackage.version).not.toBe("0.3.0");
    expect(parsedPackage.dependencies).not.toHaveProperty("gray-matter");
    expect(parsedPackage.dependencies?.["js-yaml"]).toMatch(/^\^4\./);
    expect(versionOutput.trim()).toBe(parsedPackage.version);
    expect(parsedManifest["."]).toBe(parsedPackage.version);
    expect(serveError).toContain("Only MCP server mode is supported.");
    expect(transportError).toContain("Only stdio transport is supported.");
    expect(maxCharsError).toContain("Expected max-result-chars to be an integer >= 1");
    expect(`${serveError}\n${transportError}\n${maxCharsError}`).not.toContain("v0.1");

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
    expect(readme.indexOf("## Use With Agents")).toBeGreaterThan(-1);
    expect(readme.indexOf("## Use With Agents")).toBeLessThan(
      readme.indexOf("## Activation Packet")
    );
    expect(readme.indexOf("## Activation Packet")).toBeLessThan(
      readme.indexOf("## Preview The Inspector")
    );
    expect(readme.indexOf("## Preview The Inspector")).toBeLessThan(
      readme.indexOf("## Project Stack Workspaces")
    );
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
      'npx -y okfy-ai import ./docs/api --out ./okf/api-docs --source-name "API docs" --force'
    );
    expect(readme).toContain(
      'npx -y okfy-ai import ./docs/product --out ./okf/product-docs --source-name "Product docs" --force'
    );
    expect(readme).toContain("npx -y okfy-ai serve ./okf/api-docs ./okf/product-docs --mcp");
    expect(readme).toContain("[mcp_servers.stripe_clerk_okf]");
    expect(readme).toContain('"source": "stripe"');
    expect(readme).toContain("Start workspace sessions with `bundle_summary`");
    expect(readme).toContain("claude mcp add --transport stdio stripe-okf");
    expect(readme).toContain(".cursor/mcp.json");
    expect(readme).toContain("[mcp_servers.stripe_okf]");
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
    const { stdout } = await execFileAsync("npm", ["pack", "--dry-run", "--json"]);
    const pack = JSON.parse(stdout) as Array<{ files: Array<{ path: string }> }>;
    const files = pack[0]?.files.map((file) => file.path).sort() ?? [];

    expect(files).toContain("README.md");
    expect(files).toContain("dist/setup-artifacts.js");
    expect(files).toContain("dist/setup-artifacts.d.ts");
    expect(files).toContain("assets/logo-dark.png");
    expect(files).toContain("assets/logo-light.png");
    expect(files).not.toContain("assets/logo.png");
    expect(files).not.toContain("assets/logo.svg");
    expect(files).toContain("assets/demo.gif");
    expect(files).toContain("docs/mcp-clients.md");
    expect(files).toContain("examples/bundles/okfy-docs/index.md");
    expect(files.some((file) => file.startsWith("launch/"))).toBe(false);
    expect(files.some((file) => file.startsWith("docs/plans/"))).toBe(false);
    expect(files.some((file) => file.startsWith("docs/brainstorms/"))).toBe(false);
    expect(files.some((file) => file.startsWith("docs/ideation/"))).toBe(false);
    expect(files.some((file) => file.startsWith("docs/prds/"))).toBe(false);
    expect(files).not.toContain("docs/okfy-mcp-prd.md");
  });

  it("imports only declared package API from a clean npm install", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-package-"));
    try {
      const { stdout } = await execFileAsync("npm", [
        "pack",
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
        const requiredRootKeys = [
          "BundleSearch",
          "MCP_TOOL_NAMES",
          "WorkspaceError",
          "WorkspaceSearch",
          "assertUniqueWorkspaceRecordNames",
          "buildActivationPacket",
          "buildBundleInspectorReport",
          "buildWorkspaceInspectorReport",
          "bundleSourceName",
          "createMcpServer",
          "createWorkspaceMcpServer",
          "crawlWebsite",
          "extractHeadings",
          "extractMarkdownLinks",
          "importLocal",
          "inspectBundle",
          "localBundleRecord",
          "normalizeDocument",
          "okfyUserAgent",
          "packageMetadata",
          "packageVersion",
          "readBundle",
          "readConceptFile",
          "renderActivationSetupMarkdown",
          "serveMcpStdio",
          "serveWorkspaceMcpStdio",
          "validateBundle",
          "withActivationMetadata",
          "writeActivationPacketFiles",
          "writeOkfBundle"
        ].sort();
        const legacyRootKeys = [
          "evaluateFreshness",
          "hashBundleContents",
          "listSources",
          "parseDurationSeconds",
          "readRefreshState",
          "readSourceManifest",
          "refreshSource",
          "resolveOkfyHome",
          "writeRefreshState",
          "writeSourceManifest"
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
        const root = await import("okfy-ai");
        const setup = await import("okfy-ai/setup");
        const actualRootKeys = Object.keys(root).sort();
        for (const key of requiredRootKeys) {
          if (!(key in root)) throw new Error("Missing root export: " + key);
        }
        for (const key of legacyRootKeys) {
          if (typeof root[key] !== "function") {
            throw new Error("Missing legacy root export: " + key);
          }
        }
        const actualSetupKeys = Object.keys(setup).sort();
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
        for (const parserInternal of [
          "parseMarkdown",
          "createParser",
          "extractInternalLinksFromSemantics",
          "internalLinksFromSemantics"
        ]) {
          if (parserInternal in root) {
            throw new Error("Parser internal unexpectedly exported: " + parserInternal);
          }
        }
        const fs = await import("node:fs/promises");
        await fs.mkdir("vault");
        await fs.writeFile("vault/source.md", "# Source\n\n[[Missing Note]]\n");
        const imported = await root.importLocal({
          inputPath: "vault",
          outDir: "bundle",
          force: true,
          timestamp: "2026-07-20T00:00:00.000Z"
        });
        if (!Array.isArray(imported.written) || !Array.isArray(imported.documents)) {
          throw new Error("Existing import result fields changed");
        }
        if (!Array.isArray(imported.diagnostics) || imported.diagnostics.length !== 1) {
          throw new Error("Missing additive import diagnostics");
        }
        const diagnostic = imported.diagnostics[0];
        if (
          diagnostic.code !== "unresolved_wikilink" ||
          diagnostic.severity !== "warning" ||
          diagnostic.sourcePath !== "source.md" ||
          diagnostic.rawTarget !== "Missing Note"
        ) {
          throw new Error("Unexpected import diagnostic: " + JSON.stringify(diagnostic));
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
        await expectBlocked("okfy-ai/dist/markdown-ast.js");
        console.log("ok");
      `;
      await expect(
        execFileAsync(process.execPath, ["--input-type=module", "-e", script], { cwd: appDir })
      ).resolves.toMatchObject({ stdout: "ok\n" });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("ships additive import diagnostics types without parser internals", async () => {
    const declarations = await fs.readFile("dist/index.d.ts", "utf8");

    for (const publicType of [
      "DocumentDiagnostic",
      "DocumentProperties",
      "ImportResult",
      "NormalizedDocument",
      "SemanticLink"
    ]) {
      expect(declarations).toMatch(new RegExp(`\\b${publicType}\\b`));
    }
    expect(declarations).not.toMatch(/\bParsedMarkdown\b|\bparseMarkdown\b|\bcreateParser\b/);
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
    expect(npmReadme).toContain("New setup-only code can import");
    expect(npmReadme).toContain("Preflight DNS-resolved private targets");
    expect(npmReadme).toContain(
      "MCP tools are read-only; refresh is server-side maintenance, not an agent-callable write tool."
    );
    expect(npmReadme).not.toContain("including DNS-resolved hosts and redirects");
    for (const documentation of [readme, npmReadme]) {
      expect(documentation).toContain("Obsidian knowledge semantics are recognized automatically");
      expect(documentation).toContain("importLocal");
      expect(documentation).toContain("unresolved_wikilink");
    }
    expect(npmReadme).toContain(
      "Turn docs into agent-readable Open Knowledge Format v0.1-conformant bundles, then serve them to Claude, Codex, Cursor"
    );
    expect(npmReadme).toContain("Preview what your agent will know");
    expect(npmReadme).toContain(
      "npx -y okfy-ai activate stripe --client codex --out okfy-activation"
    );
    expect(npmReadme).toContain("okfy-proof.json");
    expect(npmReadme).toContain("npx -y okfy-ai map stripe --out okfy-inspector.html");
    expect(npmReadme).toContain("local static HTML Inspector");
    expect(npmReadme.indexOf("## Use With Agents")).toBeLessThan(
      npmReadme.indexOf("## Optional CLI Install")
    );
    expect(npmReadme.indexOf("## Use With Agents")).toBeLessThan(
      npmReadme.indexOf("## Activation Packet")
    );
    expect(npmReadme.indexOf("## Activation Packet")).toBeLessThan(
      npmReadme.indexOf("## Preview The Inspector")
    );
    expect(npmReadme.indexOf("## Preview The Inspector")).toBeLessThan(
      npmReadme.indexOf("## Multi-Source Workspaces")
    );
    expect(npmReadme).toContain(
      "npx -y okfy-ai init stripe https://docs.stripe.com/checkout --client generic"
    );
    expect(npmReadme).toContain("npx -y okfy-ai doctor stripe --client codex");
    expect(npmReadme).toContain("npx -y okfy-ai doctor stripe clerk --client codex");
    expect(npmReadme).toContain("npx -y okfy-ai serve stripe clerk --mcp --auto-refresh");
    expect(npmReadme).toContain(
      'npx -y okfy-ai import ./docs/api --out ./okf/api-docs --source-name "API docs" --force'
    );
    expect(npmReadme).toContain(
      'npx -y okfy-ai import ./docs/product --out ./okf/product-docs --source-name "Product docs" --force'
    );
    expect(npmReadme).toContain("npx -y okfy-ai serve ./okf/api-docs ./okf/product-docs --mcp");
    expect(npmReadme).toContain("[mcp_servers.stripe_clerk_okf]");
    expect(npmReadme).toContain("Search and list tools accept a `source` filter");
    expect(npmReadme).toContain("okfy init <name> <url>");
    expect(npmReadme).toContain("okfy doctor <name> [more-names...]");
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
