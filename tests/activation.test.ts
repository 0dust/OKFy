import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildActivationPacket,
  renderActivationSetupMarkdown,
  withActivationMetadata
} from "../src/activation.js";
import { buildBundleInspectorReport, buildWorkspaceInspectorReport } from "../src/inspector.js";
import { defaultOkfyHome } from "../src/setup.js";
import { localBundleRecord } from "../src/workspace.js";

function fixture(name: string): string {
  return path.resolve("test-fixtures", name);
}

describe("activation packets", () => {
  it("builds a local bundle proof with search, read, neighbors, and setup markdown", async () => {
    const bundleDir = fixture("okf-valid");
    const report = await buildBundleInspectorReport(bundleDir);
    const packet = await buildActivationPacket({
      records: [localBundleRecord(bundleDir)],
      report,
      client: "codex",
      outDir: "okfy-activation",
      commandTarget: bundleDir,
      autoRefresh: false,
      okfyHome: defaultOkfyHome(),
      generatedAt: "2026-06-25T00:00:00.000Z"
    });

    expect(packet.setup.command.display).toBe(`npx -y okfy-ai serve ${bundleDir} --mcp`);
    expect(packet.setup.artifacts[0]?.body).toContain("[mcp_servers.okf_valid_okf]");
    expect(packet.proof.summary.tool).toBe("bundle_summary");
    expect(packet.proof.search.input).toMatchObject({ query: "Quickstart", limit: 5 });
    expect(packet.proof.search.results[0]).toMatchObject({
      id: "guides/quickstart",
      ref: "guides/quickstart",
      resource: "https://docs.example.com/guides/quickstart"
    });
    expect(packet.proof.read?.result).toMatchObject({
      ref: "guides/quickstart",
      citation: { sourceResource: "https://docs.example.com/guides/quickstart" }
    });
    expect(packet.proof.neighbors?.result.outbound).toContain("reference/api");

    const markdown = renderActivationSetupMarkdown(packet);
    expect(markdown).toContain("# OKFY Activation Packet");
    expect(markdown).toContain("npx -y okfy-ai serve");
    expect(markdown).toContain("Codex config.toml");
    expect(markdown).toContain("okfy-proof.json");
  });

  it("keeps source-scoped refs in workspace activation proofs", async () => {
    const first = localBundleRecord(fixture("okf-valid"));
    const second = localBundleRecord(fixture("okf-broken-link-valid"));
    const report = await buildWorkspaceInspectorReport([first, second], {
      workspaceName: "docs"
    });

    const packet = await buildActivationPacket({
      records: [first, second],
      report,
      client: "generic",
      outDir: "okfy-activation",
      commandTarget: [first.bundleDir, second.bundleDir],
      autoRefresh: false,
      generatedAt: "2026-06-25T00:00:00.000Z"
    });

    expect(packet.proof.search.results[0]?.sourceName).toBe("okf-valid");
    expect(packet.proof.search.results[0]?.ref).toBe("okf-valid:guides/quickstart");
    expect(packet.proof.read?.input).toMatchObject({
      source: "okf-valid",
      id: "guides/quickstart"
    });
    expect(withActivationMetadata(report, packet).activation?.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Inspector HTML" }),
        expect.objectContaining({ label: "Setup Markdown" }),
        expect.objectContaining({ label: "Proof JSON" })
      ])
    );
  });
});
