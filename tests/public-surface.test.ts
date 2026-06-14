import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("public surface", () => {
  it("README points at public product assets and current demo output", async () => {
    const cli = path.resolve("dist/cli.js");
    await fs.access(cli);
    const [{ stdout: demoOutput }, { stdout: versionOutput }, readme, packageJson] = await Promise.all([
      execFileAsync(process.execPath, [cli, "demo"]),
      execFileAsync(process.execPath, [cli, "--version"]),
      fs.readFile("README.md", "utf8"),
      fs.readFile("package.json", "utf8")
    ]);
    const parsedPackage = JSON.parse(packageJson) as { version?: string };

    for (const expected of [
      "Offline bundle: examples/bundles/okfy-docs",
      "OKF bundle valid",
      "Concepts: 9",
      "Links: 15",
      "Broken links: 0"
    ]) {
      expect(demoOutput).toContain(expected);
    }
    expect(versionOutput.trim()).toBe(parsedPackage.version);

    expect(readme).toContain("![okfy terminal demo](assets/demo.gif)");
    expect(readme).toContain('<source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.png">');
    expect(readme).toContain('<source media="(prefers-color-scheme: light)" srcset="assets/logo-light.png">');
    expect(readme).toContain('<img src="assets/logo-light.png" alt="okfy logo: hand-drawn OKFY knowledge blocks" width="520">');
    expect(readme).toContain("Open Knowledge Format for AI agents");
    expect(readme).not.toContain("assets/logo.png");
    expect(readme).not.toContain("assets/logo.svg");
    expect(readme).toContain("https://www.npmjs.com/package/okfy-ai");
    expect(readme).toContain("npm-okfy--ai%400.1.2");
    expect(readme).toContain("node-20%2B");
    expect(readme).not.toContain("Node.js >=20");
    expect(readme).toContain("[docs/mcp-clients.md](docs/mcp-clients.md)");
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
    expect(files).toContain("assets/logo-dark.png");
    expect(files).toContain("assets/logo-light.png");
    expect(files).not.toContain("assets/logo.png");
    expect(files).not.toContain("assets/logo.svg");
    expect(files).toContain("assets/demo.gif");
    expect(files).toContain("docs/mcp-clients.md");
    expect(files).toContain("examples/bundles/okfy-docs/index.md");
    expect(files.some((file) => file.startsWith("launch/"))).toBe(false);
    expect(files).not.toContain("docs/okfy-mcp-prd.md");
  });

  it("documents the publishable npm package", async () => {
    const [packageJson, readme, npmReadme, mcpDocs] = await Promise.all([
      fs.readFile("package.json", "utf8"),
      fs.readFile("README.md", "utf8"),
      fs.readFile("scripts/npm-readme.md", "utf8"),
      fs.readFile("docs/mcp-clients.md", "utf8")
    ]);
    const parsed = JSON.parse(packageJson) as { name?: string; bin?: Record<string, string> };

    expect(parsed.name).toBe("okfy-ai");
    expect(parsed.bin?.okfy).toBe("dist/cli.js");
    expect(parsed.bin?.["okfy-ai"]).toBe("dist/cli.js");
    expect(readme).toContain("`okfy-ai` is the npm package name. `okfy` is the installed CLI command.");
    expect(readme).toContain("This `npx -y okfy-ai` form is intentional for MCP configs");
    expect(readme).toContain("Without installing, replace `okfy` with `npx -y okfy-ai`.");
    expect(npmReadme).toContain("# okfy-ai");
    expect(npmReadme).toContain("npm install -g okfy-ai");
    expect(npmReadme).toContain("`okfy-ai` is the npm package name. `okfy` is the installed CLI command.");
    expect(npmReadme).toContain("This `npx -y okfy-ai` form is normal for MCP configs");
    expect(npmReadme).not.toContain("assets/logo.svg");
    expect(mcpDocs).toContain("Shell examples assume `npm install -g okfy-ai`");
    expect(mcpDocs).toContain("MCP config examples use `npx -y okfy-ai` by default.");
    expect(mcpDocs).toContain("okfy serve ./tmp/okfy-docs --mcp");
    expect(`${readme}\n${npmReadme}\n${mcpDocs}`).not.toMatch(/npx -y okfy(?:@|\s)/);
  });
});
