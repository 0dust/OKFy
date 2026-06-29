import path from "node:path";
import pc from "picocolors";
import {
  buildActivationPacket,
  renderActivationSetupMarkdown,
  withActivationMetadata,
  writeActivationPacketFiles
} from "./activation.js";
import {
  activationInputForResolution,
  inspectorReportForResolution,
  resolveCliTargets
} from "./cli-targets.js";
import { printJson, printStatus, writeFileAtomically } from "./cli-presenters.js";
import { renderInspectorHtml } from "./inspector-html.js";
import {
  MCP_TOOL_NAMES,
  serveMcpStdio,
  serveWorkspaceMcpStdio
} from "./mcp.js";
import { mcpRefreshHooksForRecord } from "./source-lifecycle.js";
import { listSources, resolveOkfyHome } from "./source-store.js";
import { isRegisteredWorkspaceRecord } from "./workspace.js";

async function serveBundleTarget(
  target: string,
  options: { name: string; maxResultChars: number }
): Promise<void> {
  printStatus(`okfy serve: loading ${target}`);
  printStatus(`okfy serve: starting MCP stdio server "${options.name}"`);
  await serveMcpStdio({
    bundleDir: target,
    name: options.name,
    maxResultChars: options.maxResultChars
  });
  printStatus("okfy serve: ready on stdio (stdout is reserved for MCP JSON-RPC)");
  printStatus(`okfy serve: tools ${MCP_TOOL_NAMES.join(", ")}`);
}

export async function runActivateCommand(targets: string[] = [], options: any): Promise<void> {
  try {
    const resolution = await resolveCliTargets(targets, { all: options.all });
    const report = await inspectorReportForResolution(resolution);
    const activationInput = activationInputForResolution(resolution);
    const packet = await buildActivationPacket({
      ...activationInput,
      report,
      client: options.client,
      outDir: options.out,
      proofTask: options.task,
      okfyHome: resolveOkfyHome()
    });
    const reportWithActivation = withActivationMetadata(report, packet);
    await writeActivationPacketFiles(
      packet,
      {
        inspectorHtml: renderInspectorHtml(reportWithActivation),
        setupMarkdown: renderActivationSetupMarkdown(packet)
      },
      { force: options.force, protectedInputPaths: activationInput.protectedInputPaths }
    );
    const manifest = {
      status: "ready",
      outDir: packet.outDir,
      client: packet.setup.client,
      command: packet.setup.command,
      firstPrompt: packet.setup.firstPrompt,
      files: packet.files,
      proof: {
        query: packet.proof.search.input.query,
        searchResultCount: packet.proof.search.results.length,
        readRef: packet.proof.read?.result.ref ?? null,
        citation: packet.proof.read?.result.citation.sourceResource ?? null
      }
    };
    if (options.json) {
      printJson(manifest);
      return;
    }
    console.log("okfy activate");
    console.log(`Output: ${packet.outDir}`);
    for (const file of packet.files) console.log(`${file.label}: ${file.path}`);
    console.log("");
    console.log("MCP launch command:");
    console.log(`  ${packet.setup.command.display}`);
    console.log("");
    console.log("First prompt:");
    console.log(packet.setup.firstPrompt);
  } catch (error: any) {
    if (options.json)
      printJson({ status: "failed", error: { message: error?.message ?? "Activate failed." } });
    else console.error(pc.red(error?.message ?? "Activate failed."));
    process.exitCode = 1;
  }
}

export async function runMapCommand(targets: string[] = [], options: any): Promise<void> {
  try {
    const resolution = await resolveCliTargets(targets, { all: options.all });
    const report = await inspectorReportForResolution(resolution);

    if (options.json) {
      printJson(report);
      return;
    }

    const outputPath = path.resolve(options.out);
    const html = renderInspectorHtml(report);
    await writeFileAtomically(outputPath, html);
    console.log(`Wrote OKFY Inspector: ${outputPath}`);
  } catch (error: any) {
    if (options.json) {
      printJson({ status: "failed", error: { message: error?.message ?? "Map failed." } });
    } else {
      console.error(pc.red(error?.message ?? "Map failed."));
    }
    process.exitCode = 1;
  }
}

export async function runServeCommand(targets: string[] = [], options: any): Promise<void> {
  if (!options.mcp) {
    console.error(pc.red("Only MCP server mode is supported. Pass --mcp to start stdio."));
    process.exitCode = 1;
    return;
  }
  if (options.transport !== "stdio") {
    console.error(pc.red("Only stdio transport is supported."));
    process.exitCode = 1;
    return;
  }

  try {
    const resolution = await resolveCliTargets(targets, { all: options.all });
    if (resolution.kind === "bundle") {
      await serveBundleTarget(resolution.bundleDir, options);
      return;
    }

    if (resolution.kind === "workspace") {
      const availableSourceNames = resolution.all
        ? resolution.sourceNames
        : (await listSources()).map((record) => record.name);
      const workspaceNames = resolution.records.map((record) => record.name);
      printStatus(`okfy serve: loading workspace sources ${workspaceNames.join(", ")}`);
      printStatus(`okfy serve: starting MCP stdio server "${options.name}"`);
      await serveWorkspaceMcpStdio({
        name: options.name,
        maxResultChars: options.maxResultChars,
        availableSourceNames,
        sources: resolution.records.map((record) => {
          if (!isRegisteredWorkspaceRecord(record)) return { record };
          const mode = options.autoRefresh
            ? (options.refreshMode ?? record.manifest.refresh.mode)
            : "off";
          return { record, refresh: mcpRefreshHooksForRecord(record, mode, options.maxAge) };
        })
      });
      printStatus("okfy serve: ready on stdio (stdout is reserved for MCP JSON-RPC)");
      printStatus(`okfy serve: tools ${MCP_TOOL_NAMES.join(", ")}`);
      return;
    }

    const { record } = resolution;
    const { manifest, bundleDir } = record;
    const mode = options.autoRefresh ? (options.refreshMode ?? manifest.refresh.mode) : "off";
    const maxAgeSeconds = options.maxAge;

    printStatus(`okfy serve: loading source ${manifest.name} from ${bundleDir}`);
    printStatus(`okfy serve: starting MCP stdio server "${options.name}"`);
    await serveMcpStdio({
      bundleDir,
      name: options.name,
      maxResultChars: options.maxResultChars,
      source: {
        name: manifest.name,
        kind: manifest.kind,
        seedUrl: manifest.source.seedUrl
      },
      refresh: mcpRefreshHooksForRecord(record, mode, maxAgeSeconds)
    });
    printStatus("okfy serve: ready on stdio (stdout is reserved for MCP JSON-RPC)");
    printStatus(`okfy serve: tools ${MCP_TOOL_NAMES.join(", ")}`);
  } catch (error: any) {
    console.error(pc.red(error?.message ?? "Serve failed."));
    process.exitCode = 1;
  }
}
