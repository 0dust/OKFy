#!/usr/bin/env node
import {
  MCP_TOOL_NAMES,
  buildBundleInspectorReport,
  buildWorkspaceInspectorReport,
  crawlWebsite,
  evaluateFreshness,
  hashBundleContents,
  importLocal,
  inspectBundle,
  listSources,
  packageVersion,
  parseDurationSeconds,
  readRefreshState,
  readSourceManifest,
  refreshSource,
  removeSource,
  resolveBundleDir,
  resolveOkfyHome,
  resolveSourceDir,
  resolveWorkspaceSources,
  runtimePackageRoot,
  serveMcpStdio,
  serveWorkspaceMcpStdio,
  validateBundle,
  validateSourceName,
  writeRefreshState,
  writeSourceManifest
} from "./chunk-JRGLJVQG.js";

// src/cli.ts
import fs2 from "fs";
import path2 from "path";
import { execFile } from "child_process";
import { fileURLToPath, pathToFileURL } from "url";
import { Command } from "commander";
import pc from "picocolors";

// src/inspector-html.ts
function renderInspectorHtml(report) {
  const normalized = normalizeReport(report);
  const json = escapeJsonForHtml(stableStringify(report));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(normalized.title)} - OKFY Inspector</title>
<style>
:root{color-scheme:light;--ink:#17211d;--muted:#60706a;--line:#d8e0dc;--surface:#f7f9f6;--paper:#ffffff;--accent:#0c7c59;--accent-2:#2846a3;--warn:#a56300;--bad:#b53636}
*{box-sizing:border-box}
body{margin:0;background:var(--surface);color:var(--ink);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.45}
button,input,select{font:inherit}
.shell{max-width:1180px;margin:0 auto;padding:32px 24px 44px}
header{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:end;padding:0 0 24px;border-bottom:1px solid var(--line)}
.eyebrow{margin:0 0 8px;color:var(--accent);font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:0}
h1{margin:0;font-size:34px;letter-spacing:0;line-height:1.08}
.lede{max-width:660px;margin:12px 0 0;color:var(--muted);font-size:16px}
.status-pill{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);border-radius:999px;background:var(--paper);padding:9px 13px;color:var(--muted);font-size:14px}
.dot{width:9px;height:9px;border-radius:999px;background:var(--accent)}
.dot.invalid,.dot.unavailable,.dot.failed{background:var(--bad)}
.dot.warning,.dot.stale,.dot.refreshing{background:var(--warn)}
main{display:grid;gap:22px;margin-top:24px}
section{background:var(--paper);border:1px solid var(--line);border-radius:8px;padding:20px}
section h2{margin:0 0 14px;font-size:18px;letter-spacing:0}
.metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}
.metric{border-left:3px solid var(--accent);background:#f4faf7;padding:12px;min-height:82px}
.metric strong{display:block;font-size:24px;line-height:1.1}
.metric span{display:block;margin-top:7px;color:var(--muted);font-size:13px}
.source-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:16px}
.source{border:1px solid var(--line);border-radius:6px;padding:12px;background:#fbfcfb}
.source b{display:block}
.source small{display:block;margin-top:4px;color:var(--muted)}
.workspace{display:grid;grid-template-columns:minmax(320px,0.95fr) minmax(320px,1.05fr);gap:18px;align-items:start}
.toolbar{display:grid;grid-template-columns:minmax(180px,1fr) minmax(130px,180px) minmax(130px,180px);gap:10px;align-items:center;margin-bottom:14px}
.toolbar input,.toolbar select{width:100%;border:1px solid var(--line);border-radius:6px;padding:10px 12px;background:var(--paper);color:var(--ink)}
.map{position:relative;min-height:360px;border:1px solid var(--line);border-radius:8px;background:linear-gradient(#fbfcfb,#f4f7f5)}
.edge{position:absolute;height:2px;background:#a7b5ae;transform-origin:left center}
.node{position:absolute;min-width:150px;max-width:190px;border:1px solid #bdd0c7;border-radius:6px;background:var(--paper);padding:10px;text-align:left;box-shadow:0 3px 10px rgba(23,33,29,.08);cursor:pointer}
.node:hover,.node.active{border-color:var(--accent);outline:2px solid rgba(12,124,89,.16)}
.node b{display:block;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.node small{display:block;color:var(--muted);margin-top:4px}
.detail{border:1px solid var(--line);border-radius:8px;padding:16px;background:#fbfcfb;min-height:360px}
.detail h3{margin:0 0 8px;font-size:18px}
.detail dl{display:grid;grid-template-columns:112px minmax(0,1fr);gap:8px;margin:14px 0}
.detail dt{color:var(--muted)}
.detail dd{margin:0;word-break:break-word}
.tags{display:flex;flex-wrap:wrap;gap:6px}
.tag{display:inline-flex;border:1px solid var(--line);border-radius:999px;padding:3px 8px;font-size:12px;background:var(--paper)}
.steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
.step{border:1px solid var(--line);border-radius:6px;padding:13px;background:#fbfcfb}
.step code{display:block;color:var(--accent-2);font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.questions{margin:16px 0 0;padding-left:20px;color:var(--muted)}
.error{color:var(--bad)}
@media (max-width:820px){header,.workspace,.toolbar{grid-template-columns:1fr}.metrics,.steps{grid-template-columns:repeat(2,minmax(0,1fr))}.shell{padding:22px 14px}.map{min-height:460px}}
</style>
</head>
<body>
<div class="shell">
<header>
<div>
<p class="eyebrow">OKFY Inspector</p>
<h1>${escapeHtml(normalized.title)}</h1>
<p class="lede">Preview what your agent will know: readiness, graph relationships, citation sources, and the MCP path to read this local OKF memory.</p>
</div>
<div class="status-pill"><span class="dot ${escapeAttribute(normalized.readiness.validationStatus)}"></span>${escapeHtml(normalized.readiness.validationStatus)}</div>
</header>
<main>
<section aria-labelledby="readiness-title">
<h2 id="readiness-title">Readiness Summary</h2>
${renderMetrics(normalized.readiness)}
${renderSources(normalized.sources)}
</section>
<section aria-labelledby="map-title">
<h2 id="map-title">Knowledge Map</h2>
<div class="workspace">
<div>
${renderToolbar(normalized.concepts)}
${renderMap(normalized.concepts, normalized.edges)}
</div>
<aside class="detail" id="concept-detail">${renderConceptDetail(normalized.concepts[0])}</aside>
</div>
</section>
<section aria-labelledby="agent-preview-title">
<h2 id="agent-preview-title">Agent Preview</h2>
${renderAgentPreview(normalized.agentPreview)}
</section>
</main>
</div>
<script id="okfy-inspector-report" type="application/json">${json}</script>
<script>
const report=JSON.parse(document.getElementById("okfy-inspector-report").textContent);
const detail=document.getElementById("concept-detail");
const nodes=[...document.querySelectorAll(".node")];
const edges=[...document.querySelectorAll(".edge")];
const search=document.getElementById("concept-filter");
const sourceFilter=document.getElementById("source-filter");
const typeFilter=document.getElementById("type-filter");
const esc=(value)=>String(value??"").replace(/[&<>"']/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
function renderDetail(concept){
  if(!concept){detail.innerHTML="<h3>No concept selected</h3>";return}
  const resource=concept.resourceUrl||concept.resource||"";
  const outbound=concept.outbound||concept.outboundLinks||[];
  const backlinks=concept.backlinks||[];
  detail.innerHTML='<h3>'+esc(concept.title||concept.id)+'</h3><dl>'+
    '<dt>Type</dt><dd>'+esc(concept.type||"")+'</dd>'+
    '<dt>Reference</dt><dd><code>'+esc(concept.ref)+'</code></dd>'+
    '<dt>Source</dt><dd>'+esc(concept.sourceName||"local bundle")+'</dd>'+
    '<dt>Resource URL</dt><dd>'+esc(resource||"none")+'</dd>'+
    '<dt>Tags</dt><dd>'+(concept.tags||[]).map((tag)=>'<span class="tag">'+esc(tag)+'</span>').join(" ")+'</dd>'+
    '<dt>Outbound</dt><dd>'+esc(outbound.join(", ")||"none")+'</dd>'+
    '<dt>Backlinks</dt><dd>'+esc(backlinks.join(", ")||"none")+'</dd>'+
    '</dl><p>'+esc(concept.description||"")+'</p>';
}
nodes.forEach((node)=>node.addEventListener("click",()=>{nodes.forEach((item)=>item.classList.remove("active"));node.classList.add("active");renderDetail(report.concepts.find((concept)=>concept.ref===node.dataset.ref));}));
function applyFilters(){
  const query=(search&&search.value?search.value:"").toLowerCase();
  const source=sourceFilter&&sourceFilter.value?sourceFilter.value:"";
  const type=typeFilter&&typeFilter.value?typeFilter.value:"";
  nodes.forEach((node)=>{
    const textMatch=!query||node.textContent.toLowerCase().includes(query);
    const sourceMatch=!source||node.dataset.source===source;
    const typeMatch=!type||node.dataset.type===type;
    node.hidden=!(textMatch&&sourceMatch&&typeMatch);
  });
  const visibleRefs=new Set(nodes.filter((node)=>!node.hidden).map((node)=>node.dataset.ref));
  edges.forEach((edge)=>{edge.hidden=!visibleRefs.has(edge.dataset.from)||!visibleRefs.has(edge.dataset.to)});
  const active=nodes.find((node)=>node.classList.contains("active")&&!node.hidden);
  const next=active||nodes.find((node)=>!node.hidden);
  if(next&&!active) next.click();
}
[search,sourceFilter,typeFilter].forEach((control)=>{if(control)control.addEventListener("input",applyFilters)});
</script>
</body>
</html>
`;
}
function renderToolbar(concepts) {
  const sources = uniqueSorted(concepts.map((concept) => concept.sourceName).filter(isNonEmptyString));
  const types = uniqueSorted(concepts.map((concept) => concept.type).filter(isNonEmptyString));
  return `<div class="toolbar">
<input id="concept-filter" type="search" placeholder="Filter concepts" aria-label="Filter concepts">
<select id="source-filter" aria-label="Filter by source">
<option value="">All sources</option>
${sources.map((source) => `<option value="${escapeAttribute(source)}">${escapeHtml(source)}</option>`).join("")}
</select>
<select id="type-filter" aria-label="Filter by type">
<option value="">All types</option>
${types.map((type) => `<option value="${escapeAttribute(type)}">${escapeHtml(type)}</option>`).join("")}
</select>
</div>`;
}
function renderMetrics(readiness) {
  const metrics = [
    ["Validation status", readiness.validationStatus],
    ["Concepts", readiness.conceptCount],
    ["Warnings", readiness.warningCount],
    ["Broken links", readiness.brokenLinkCount],
    ["Orphan concepts", readiness.orphanConcepts.length],
    ["Source freshness", readiness.freshnessStatus ?? "snapshot"]
  ];
  const error = readiness.lastRefreshError ? `<p class="error">${escapeHtml(errorMessage(readiness.lastRefreshError))}</p>` : "";
  return `<div class="metrics">${metrics.map(
    ([label, value]) => `<div class="metric"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(String(label))}</span></div>`
  ).join("")}</div>${error}`;
}
function renderSources(sources) {
  if (!sources.length) return "";
  return `<div class="source-grid">${sources.map(
    (source) => `<div class="source"><b>${escapeHtml(source.label ?? source.name ?? source.sourceName ?? "source")}</b><small>${escapeHtml(source.kind ?? sourceKind(source) ?? "local")} / ${escapeHtml(source.validationStatus ?? "unknown")} / ${escapeHtml(source.freshnessStatus ?? "snapshot")}</small><small>Concepts: ${escapeHtml(String(source.conceptCount ?? 0))}</small>${source.lastRefreshError ? `<small class="error">${escapeHtml(errorMessage(source.lastRefreshError))}</small>` : ""}</div>`
  ).join("")}</div>`;
}
function renderMap(concepts, edges) {
  const positions = layout(concepts);
  const edgeHtml = edges.map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) return "";
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    return `<span class="edge" data-from="${escapeAttribute(edge.from)}" data-to="${escapeAttribute(edge.to)}" style="left:${from.x + 74}px;top:${from.y + 28}px;width:${Math.max(12, length)}px;transform:rotate(${angle.toFixed(3)}deg)" title="${escapeAttribute(edge.label ?? "Markdown link")}"></span>`;
  }).join("");
  const nodeHtml = concepts.map((concept, index) => {
    const position = positions.get(concept.ref) ?? { x: 20, y: 20 };
    return `<button class="node${index === 0 ? " active" : ""}" data-ref="${escapeAttribute(concept.ref)}" data-source="${escapeAttribute(concept.sourceName ?? "")}" data-type="${escapeAttribute(concept.type ?? "")}" style="left:${position.x}px;top:${position.y}px" type="button"><b>${escapeHtml(concept.title ?? concept.id)}</b><small>${escapeHtml([concept.sourceName, concept.type].filter(Boolean).join(" / "))}</small></button>`;
  }).join("");
  return `<div class="map">${edgeHtml}${nodeHtml}</div>`;
}
function renderConceptDetail(concept) {
  if (!concept) return "<h3>No concept selected</h3>";
  return `<h3>${escapeHtml(concept.title ?? concept.id)}</h3>
<dl>
<dt>Type</dt><dd>${escapeHtml(concept.type ?? "")}</dd>
<dt>Reference</dt><dd><code>${escapeHtml(concept.ref)}</code></dd>
<dt>Source</dt><dd>${escapeHtml(concept.sourceName ?? "local bundle")}</dd>
<dt>Resource URL</dt><dd>${escapeHtml(concept.resourceUrl ?? concept.resource ?? "none")}</dd>
<dt>Tags</dt><dd class="tags">${(concept.tags ?? []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</dd>
<dt>Outbound</dt><dd>${escapeHtml((concept.outbound ?? concept.outboundLinks ?? []).join(", ") || "none")}</dd>
<dt>Backlinks</dt><dd>${escapeHtml((concept.backlinks ?? []).join(", ") || "none")}</dd>
</dl>
<p>${escapeHtml(concept.description ?? "")}</p>`;
}
function renderAgentPreview(agentPreview) {
  const tools = agentPreview.tools.length ? agentPreview.tools : agentPreview.sequence.map((step) => ({ name: step.tool, purpose: step.purpose }));
  return `<div class="steps">${tools.map(
    (tool, index) => `<div class="step"><code>${index + 1}. ${escapeHtml(tool.name)}</code><p>${escapeHtml(tool.purpose)}</p></div>`
  ).join("")}</div>
<p>${escapeHtml(agentPreview.citationGuidance ?? "")}</p>
<ol class="questions">${(agentPreview.suggestedQuestions ?? []).map((question) => `<li>${escapeHtml(question)}</li>`).join("")}</ol>`;
}
function normalizeReport(report) {
  const readiness = report.readiness ?? {};
  const agentPreview = report.agentPreview ?? {};
  return {
    title: report.title || "OKFY Inspector",
    readiness: {
      validationStatus: readiness.validationStatus ?? "unknown",
      availabilityStatus: readiness.availabilityStatus ?? "available",
      sourceCount: readiness.sourceCount ?? report.sources.length,
      usableSourceCount: readiness.usableSourceCount ?? report.sources.length,
      conceptCount: readiness.conceptCount ?? 0,
      warningCount: readiness.warningCount ?? 0,
      brokenLinkCount: readiness.brokenLinkCount ?? readiness.brokenLinks ?? 0,
      brokenLinks: readiness.brokenLinks ?? readiness.brokenLinkCount ?? 0,
      orphanConcepts: readiness.orphanConcepts ?? [],
      freshnessStatus: readiness.freshnessStatus ?? "snapshot",
      freshnessStatuses: readiness.freshnessStatuses ?? {},
      refreshInProgress: Boolean(readiness.refreshInProgress),
      lastSuccessfulRefreshAt: readiness.lastSuccessfulRefreshAt ?? null,
      nextRefreshAllowedAt: readiness.nextRefreshAllowedAt ?? null,
      lastRefreshError: readiness.lastRefreshError ?? null,
      sources: readiness.sources ?? []
    },
    sources: [...report.sources ?? []].map((source) => ({
      ...source,
      name: source.name ?? source.sourceName,
      label: source.label ?? source.name ?? source.sourceName ?? "source",
      kind: source.kind ?? sourceKind(source) ?? "local"
    })).sort(compareSources),
    concepts: [...report.concepts ?? []].sort(compareConcepts),
    edges: [...report.edges ?? []].sort(compareEdges),
    agentPreview: {
      sequence: agentPreview.sequence ?? [],
      tools: agentPreview.tools ?? [],
      citationGuidance: agentPreview.citationGuidance ?? "",
      suggestedQuestions: agentPreview.suggestedQuestions ?? []
    }
  };
}
function compareSources(first, second) {
  return compareText(first.label ?? first.name ?? "", second.label ?? second.name ?? "") || compareText(first.name ?? "", second.name ?? "");
}
function compareConcepts(first, second) {
  return compareText(first.sourceName ?? "", second.sourceName ?? "") || compareText(first.type ?? "", second.type ?? "") || compareText(first.title ?? first.id, second.title ?? second.id) || compareText(first.ref, second.ref);
}
function compareEdges(first, second) {
  return compareText(first.sourceName ?? "", second.sourceName ?? "") || compareText(first.from, second.from) || compareText(first.to, second.to) || compareText(first.label ?? "", second.label ?? "");
}
function layout(concepts) {
  const positions = /* @__PURE__ */ new Map();
  const groups = /* @__PURE__ */ new Map();
  for (const concept of concepts) {
    const group = concept.sourceName || concept.type || "bundle";
    groups.set(group, [...groups.get(group) ?? [], concept]);
  }
  const columns = [...groups.entries()].sort(([first], [second]) => compareText(first, second));
  columns.forEach(([, groupConcepts], columnIndex) => {
    groupConcepts.sort(compareConcepts).forEach((concept, rowIndex) => {
      positions.set(concept.ref, {
        x: 20 + columnIndex * 230,
        y: 20 + rowIndex * 92
      });
    });
  });
  return positions;
}
function uniqueSorted(values) {
  return [...new Set(values)].sort(compareText);
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function compareText(first, second) {
  if (first < second) return -1;
  if (first > second) return 1;
  return 0;
}
function errorMessage(error) {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error) {
    return String(error.message);
  }
  return String(error);
}
function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
function escapeAttribute(value) {
  return escapeHtml(value);
}
function stableStringify(value) {
  return JSON.stringify(sortJson(value));
}
function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort(compareText).reduce((result, key) => {
    const item = value[key];
    if (item !== void 0) result[key] = sortJson(item);
    return result;
  }, {});
}
function escapeJsonForHtml(value) {
  return value.replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
function sourceKind(source) {
  return source.sourceKind;
}

// src/setup.ts
import fs from "fs/promises";
import path from "path";
import { spawn } from "child_process";
var EXPECTED_MCP_TOOLS = [...MCP_TOOL_NAMES];
var MAX_CAPTURE_CHARS = 64e3;
var MAX_DIAGNOSTIC_CHARS = 1e3;
var MAX_MESSAGES = 100;
function parseSetupClient(value) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "claude-code" || normalized === "claude") return "claude-code";
  if (normalized === "claude-desktop" || normalized === "cursor" || normalized === "mcp-json" || normalized === "desktop") {
    return "mcp-json";
  }
  if (normalized === "codex") return "codex";
  if (normalized === "generic" || normalized === "json") return "generic";
  throw new Error(
    `Invalid setup client "${value}". Use claude-code, claude-desktop, cursor, codex, or generic.`
  );
}
function defaultOkfyHome() {
  return resolveOkfyHome({ env: { OKFY_HOME: "" } });
}
function setupStatus(checks) {
  if (checks.some((check) => check.severity === "fail")) return "failed";
  if (checks.some((check) => check.severity === "warn")) return "warning";
  return "ready";
}
function createSetupReport(input) {
  const okfyHome = path.resolve(input.okfyHome ?? resolveOkfyHome());
  const defaultHome = defaultOkfyHome();
  const sourceNames = setupSourceNames(input);
  const workspace = Boolean(input.workspaceAll) || sourceNames.length > 1;
  const serverIdentity = input.workspaceAll ? ["all"] : sourceNames;
  const commandTarget = input.workspaceAll ? { all: true } : sourceNames;
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
function renderClientArtifacts(input) {
  const okfyHome = path.resolve(input.okfyHome ?? resolveOkfyHome());
  const defaultHome = input.defaultOkfyHome ?? defaultOkfyHome();
  const sourceNames = setupSourceNames(input);
  const serverIdentity = input.workspaceAll ? ["all"] : sourceNames;
  const commandTarget = input.workspaceAll ? { all: true } : sourceNames;
  const serverName = mcpServerName(serverIdentity);
  const codexName = codexMcpServerName(serverIdentity);
  const command = serveCommand(commandTarget, okfyHome, defaultHome);
  const env = Object.keys(command.env).length ? command.env : void 0;
  if (input.client === "claude-code") {
    return [
      {
        client: input.client,
        label: "Claude Code",
        format: "shell",
        body: `claude mcp add --transport stdio${shellEnvArgs(command.env, "-e")} ${serverName} -- ${command.display}`
      }
    ];
  }
  if (input.client === "codex") {
    return [
      {
        client: input.client,
        label: "Codex config.toml",
        format: "toml",
        body: codexToml(codexName, command, env)
      },
      {
        client: input.client,
        label: "Codex CLI",
        format: "shell",
        body: `codex mcp add${shellEnvArgs(command.env, "--env")} ${codexName} -- ${command.display}`
      }
    ];
  }
  const label = input.client === "mcp-json" ? "Claude Desktop / Cursor mcpServers JSON" : "Generic mcpServers JSON";
  return [
    {
      client: input.client,
      label,
      format: "json",
      body: JSON.stringify(
        {
          mcpServers: {
            [serverName]: {
              command: command.command,
              args: command.args,
              ...env ? { env } : {}
            }
          }
        },
        null,
        2
      )
    }
  ];
}
function firstAgentPrompt(serverName, options = {}) {
  if (options.workspace) {
    return `Use the ${serverName} MCP server. Start with bundle_summary to understand the workspace sources and freshness. Filter by source when you know which docs apply, search before reading concepts, read only the most relevant concepts, inspect neighbors when relationships matter, and cite source_resource URLs in the final answer.`;
  }
  return `Use the ${serverName} MCP server. Start with bundle_summary to understand the bundle and freshness. Search before reading concepts, read only the most relevant concepts, inspect neighbors when relationships matter, and cite source_resource URLs in the final answer.`;
}
function serveCommand(sourceNameOrNames, okfyHome, defaultHome = defaultOkfyHome()) {
  const args = ["-y", "okfy-ai", ...serveCommandArgs(sourceNameOrNames)];
  const env = needsOkfyHomeEnv(okfyHome, defaultHome) ? { OKFY_HOME: path.resolve(okfyHome) } : {};
  return {
    command: "npx",
    args,
    env,
    display: ["npx", ...args].join(" ")
  };
}
function serveCommandArgs(sourceNameOrNames) {
  if (isAllCommandTarget(sourceNameOrNames)) {
    return ["serve", "--all", "--mcp", "--auto-refresh"];
  }
  const sourceNames = Array.isArray(sourceNameOrNames) ? sourceNameOrNames : [sourceNameOrNames];
  return sourceNames.some((sourceName) => sourceName.startsWith("-")) ? ["serve", "--mcp", "--auto-refresh", "--", ...sourceNames] : ["serve", ...sourceNames, "--mcp", "--auto-refresh"];
}
function isAllCommandTarget(sourceNameOrNames) {
  return typeof sourceNameOrNames === "object" && !Array.isArray(sourceNameOrNames) && sourceNameOrNames.all;
}
function setupCheck(id, label, severity, message, fix) {
  return { id, label, severity, message, ...fix ? { fix } : {} };
}
async function executableOnPath(command, env = process.env) {
  const searchPath = env.PATH ?? "";
  const extensions = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  for (const directory of searchPath.split(path.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      try {
        await fs.access(candidate, fs.constants.X_OK);
        return true;
      } catch {
      }
    }
  }
  return false;
}
function evaluateMcpProbeMessages(messages) {
  const toolsResponse = messages.find((message) => message.id === 2);
  const tools = toolsResponse?.result?.tools?.map((tool) => tool.name).filter((name) => Boolean(name)) ?? [];
  const missingTools = EXPECTED_MCP_TOOLS.filter((tool) => !tools.includes(tool));
  return { ok: missingTools.length === 0, tools, missingTools };
}
async function probeMcpStdio(options) {
  const child = spawn(options.command, options.args, {
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  return probeChildProcess(child, options.timeoutMs ?? 5e3);
}
async function probeChildProcess(child, timeoutMs) {
  const messages = [];
  let stdoutBuffer = "";
  let stderr = "";
  let contamination;
  let spawnError;
  let exit;
  const closed = new Promise((resolve) => {
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
  child.stdout.on("data", (chunk) => {
    stdoutBuffer = appendBounded(stdoutBuffer, chunk.toString("utf8"));
    let newlineIndex = stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        try {
          if (messages.length >= MAX_MESSAGES)
            contamination = `MCP stdout exceeded ${MAX_MESSAGES} JSON-RPC messages.`;
          else messages.push(JSON.parse(line));
        } catch {
          contamination = line;
        }
      }
      newlineIndex = stdoutBuffer.indexOf("\n");
    }
    if (stdoutBuffer.length >= MAX_CAPTURE_CHARS)
      contamination = `MCP stdout line exceeded ${MAX_CAPTURE_CHARS} characters.`;
  });
  child.stderr.on("data", (chunk) => {
    stderr = appendBounded(stderr, chunk.toString("utf8"));
  });
  const send = (id, method, params = {}) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}
`);
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
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}
`
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
var ProbeFailure = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
async function waitForMessage(id, messages, contamination, spawnError, childExit, capturedStderr, timeoutMs) {
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
async function stopChild(child, closed, childExit) {
  try {
    if (!child.stdin.destroyed) child.stdin.end();
  } catch {
  }
  if (childExit()) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    closed.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 500))
  ]);
  if (!exited && !childExit()) child.kill("SIGKILL");
}
function appendBounded(current, addition) {
  const next = current + addition;
  if (next.length <= MAX_CAPTURE_CHARS) return next;
  return next.slice(next.length - MAX_CAPTURE_CHARS);
}
function truncate(value) {
  const normalized = value.trim();
  if (normalized.length <= MAX_DIAGNOSTIC_CHARS) return normalized;
  return `${normalized.slice(0, MAX_DIAGNOSTIC_CHARS)}...truncated`;
}
function formatExit(exit) {
  if (exit.signal) return `signal ${exit.signal}`;
  return `exit code ${exit.code ?? "unknown"}`;
}
function needsOkfyHomeEnv(okfyHome, defaultHome) {
  return path.resolve(okfyHome) !== path.resolve(defaultHome);
}
function mcpServerName(sourceNameOrNames) {
  const sourceNames = Array.isArray(sourceNameOrNames) ? sourceNameOrNames : [sourceNameOrNames];
  const safeName = sourceNames.map((sourceName) => sourceName.replace(/[._]+/g, "-").replace(/^-+/, "")).filter(Boolean).join("-");
  return `${safeName || "source"}-okf`;
}
function codexMcpServerName(sourceNameOrNames) {
  const sourceNames = Array.isArray(sourceNameOrNames) ? sourceNameOrNames : [sourceNameOrNames];
  const safeName = sourceNames.map((sourceName) => sourceName.replace(/[^a-z0-9]+/g, "_").replace(/^_+/, "")).filter(Boolean).join("_");
  return `${safeName || "source"}_okf`;
}
function setupSourceNames(input) {
  const names = input.sourceNames ?? (input.sourceName ? [input.sourceName] : []);
  if (input.workspaceAll) return [...names];
  if (!names.length) throw new Error("Setup report requires at least one source name.");
  return [...names];
}
function shellEnvArgs(env, flag) {
  const entries = Object.entries(env);
  if (!entries.length) return "";
  return entries.map(([key, value]) => ` ${flag} ${shellQuote(`${key}=${value}`)}`).join("");
}
function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
function codexToml(serverName, command, env) {
  const lines = [
    `[mcp_servers.${serverName}]`,
    `command = ${JSON.stringify(command.command)}`,
    `args = [${command.args.map((arg) => JSON.stringify(arg)).join(", ")}]`
  ];
  if (env?.OKFY_HOME) lines.push(`env = { OKFY_HOME = ${JSON.stringify(env.OKFY_HOME)} }`);
  lines.push("startup_timeout_sec = 20", "tool_timeout_sec = 60", "enabled = true");
  return lines.join("\n");
}

// src/cli.ts
var program = new Command();
var cliPath = fileURLToPath(import.meta.url);
var packageRoot = runtimePackageRoot();
var isTty = Boolean(process.stderr.isTTY);
function collect(value, previous) {
  previous.push(value);
  return previous;
}
function duration(value) {
  return parseDurationSeconds(value);
}
function integerOption(value, label, minimum) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    const expectation = minimum === 0 ? "a non-negative integer" : `an integer >= ${minimum}`;
    throw new Error(`Expected ${label} to be ${expectation}, received "${value}".`);
  }
  return parsed;
}
var positiveIntegerOption = (label) => (value) => integerOption(value, label, 1);
var nonNegativeIntegerOption = (label) => (value) => integerOption(value, label, 0);
function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}
async function pathExists(target) {
  try {
    await fs2.promises.access(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
function pathLikeTarget(target) {
  return path2.isAbsolute(target) || target === "." || target === ".." || target.startsWith("./") || target.startsWith("../") || target.includes("/") || target.includes("\\");
}
async function registeredSourceDirExists(name) {
  try {
    return await pathExists(resolveSourceDir(name));
  } catch {
    return false;
  }
}
async function serveBundleTarget(target, options) {
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
function bundleSourceName(bundleDir) {
  const baseName = path2.basename(path2.resolve(bundleDir));
  const candidate = baseName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "");
  return validateSourceName(candidate || "bundle");
}
function localBundleRecord(bundleDir) {
  const resolved = path2.resolve(bundleDir);
  const name = bundleSourceName(resolved);
  const timestamp = "1970-01-01T00:00:00.000Z";
  return {
    name,
    dir: resolved,
    bundleDir: resolved,
    manifest: {
      schemaVersion: 1,
      okfyVersion: packageVersion(),
      name,
      kind: "local",
      createdAt: timestamp,
      updatedAt: timestamp,
      source: {
        seedUrl: pathToFileURL(resolved).href
      },
      crawl: {
        maxPages: 0,
        maxDepth: 0,
        include: [],
        exclude: [],
        sameOrigin: true,
        respectRobots: true,
        concurrency: 1,
        allowPrivateNetwork: false
      },
      refresh: {
        mode: "off",
        maxAgeSeconds: 0,
        minIntervalSeconds: 0
      },
      bundle: {
        dir: resolved
      }
    }
  };
}
async function assertBundleHasConceptFiles(bundleDir) {
  const validation = await validateBundle(bundleDir);
  if (validation.conceptCount === 0) {
    throw new Error(`Bundle path does not contain any OKF concept files: ${bundleDir}`);
  }
}
function assertUniqueWorkspaceRecordNames(records) {
  const seen = /* @__PURE__ */ new Set();
  for (const record of records) {
    if (seen.has(record.name))
      throw new Error(
        `Duplicate workspace source "${record.name}". Rename one bundle directory or source.`
      );
    seen.add(record.name);
  }
}
function isRegisteredWorkspaceRecord(record) {
  return record.manifest.kind === "website";
}
async function readStateIfExists(name) {
  try {
    return await readRefreshState(name);
  } catch (error) {
    if (error?.code === "ENOENT") return void 0;
    throw error;
  }
}
function emptyState(status, checkedAt) {
  return {
    schemaVersion: 1,
    status,
    lastCheckedAt: checkedAt,
    lastRefreshStartedAt: null,
    lastRefreshCompletedAt: null,
    lastSuccessfulRefreshAt: null,
    nextRefreshAllowedAt: null,
    refreshInProgress: false,
    lastError: null,
    bundle: null
  };
}
async function summarizeState(record, maxAgeSeconds) {
  const state = record.state;
  const now = /* @__PURE__ */ new Date();
  const decision = await evaluateFreshness({
    manifest: record.manifest,
    state,
    bundleDir: record.bundleDir,
    now,
    maxAgeSeconds
  });
  return {
    schemaVersion: 1,
    status: decision.status,
    lastCheckedAt: now.toISOString(),
    lastRefreshStartedAt: state?.lastRefreshStartedAt ?? null,
    lastRefreshCompletedAt: state?.lastRefreshCompletedAt ?? null,
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null,
    refreshInProgress: decision.status === "refreshing",
    lastError: state?.lastError ?? null,
    bundle: decision.validation ? {
      conceptCount: decision.validation.conceptCount,
      warningCount: decision.validation.warningCount,
      valid: decision.validation.valid,
      contentHash: await hashBundleContents(record.bundleDir)
    } : decision.status === "missing" ? null : state?.bundle ?? null
  };
}
function sourceRow(record, state) {
  const loadError = record.loadError ?? null;
  return {
    name: record.name,
    kind: record.manifest.kind,
    seedUrl: record.manifest.source.seedUrl,
    status: loadError ? "failed" : state?.status ?? "missing",
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    conceptCount: state?.bundle?.conceptCount ?? null,
    warningCount: state?.bundle?.warningCount ?? null,
    valid: loadError ? false : state?.bundle?.valid ?? false,
    lastError: loadError ?? state?.lastError ?? null,
    refreshInProgress: state?.refreshInProgress ?? false,
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null,
    bundlePath: record.bundleDir
  };
}
function printSourceRows(rows) {
  if (!rows.length) {
    console.log("No registered sources.");
    return;
  }
  for (const row of rows) {
    console.log(`${row.name} (${row.kind})`);
    console.log(`  URL: ${row.seedUrl}`);
    console.log(`  Status: ${row.status}`);
    console.log(`  Last success: ${row.lastSuccessfulRefreshAt ?? "never"}`);
    console.log(`  Concepts: ${row.conceptCount ?? "unknown"}`);
    console.log(`  Bundle: ${row.bundlePath}`);
    const lastError = row.lastError;
    if (lastError?.message) console.log(`  Error: ${lastError.message}`);
  }
}
function refreshMode(value) {
  if (value === "off" || value === "stale-while-refresh" || value === "blocking") return value;
  throw new Error(`Invalid refresh mode "${value}". Use off, stale-while-refresh, or blocking.`);
}
function setupClient(value) {
  return parseSetupClient(value);
}
function manifestFromOptions(name, seedUrl, options) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  return {
    schemaVersion: 1,
    okfyVersion: packageVersion(),
    name: validateSourceName(name),
    kind: "website",
    createdAt: now,
    updatedAt: now,
    source: {
      seedUrl: new URL(seedUrl).toString()
    },
    crawl: {
      maxPages: options.maxPages,
      maxDepth: options.maxDepth,
      include: options.include ?? [],
      exclude: options.exclude ?? [],
      sameOrigin: options.sameOrigin,
      respectRobots: options.respectRobots,
      concurrency: options.concurrency,
      allowPrivateNetwork: Boolean(options.allowPrivateNetwork)
    },
    refresh: {
      mode: options.refreshMode,
      maxAgeSeconds: options.maxAge,
      minIntervalSeconds: options.minRefreshInterval
    },
    bundle: {
      dir: options.out ? path2.resolve(options.out) : "bundle"
    }
  };
}
function addSourceRegistrationOptions(command) {
  return command.option("--max-pages <n>", "Maximum pages", positiveIntegerOption("max-pages"), 100).option("--max-depth <n>", "Maximum crawl depth", nonNegativeIntegerOption("max-depth"), 4).option("--include <pattern>", "Include glob or regex", collect, []).option("--exclude <pattern>", "Exclude glob or regex", collect, []).option("--same-origin", "Stay on same origin", true).option("--no-same-origin", "Allow cross-origin links").option("--respect-robots", "Respect robots.txt", true).option("--no-respect-robots", "Ignore robots.txt").option("--concurrency <n>", "Fetch concurrency", positiveIntegerOption("concurrency"), 4).option("--allow-private-network", "Allow localhost/private IP crawl targets", false).option(
    "--refresh-mode <mode>",
    "Refresh mode: off, stale-while-refresh, or blocking",
    refreshMode,
    "stale-while-refresh"
  ).option("--max-age <duration>", "Freshness max age", duration, 24 * 60 * 60).option(
    "--min-refresh-interval <duration>",
    "Minimum interval between refresh attempts",
    duration,
    15 * 60
  ).option("--out <dir>", "Explicit active bundle directory").option("--force", "Overwrite an existing source registration", false);
}
async function registerWebsiteSource(name, url, options) {
  const manifest = manifestFromOptions(name, url, options);
  const sourceDir = resolveSourceDir(manifest.name);
  if (await pathExists(sourceDir) && !options.force) {
    throw new Error(`Source "${manifest.name}" already exists. Use --force to overwrite it.`);
  }
  let backupDir;
  if (options.force && await pathExists(sourceDir)) {
    backupDir = `${sourceDir}.backup-${process.pid}-${Date.now()}`;
    await fs2.promises.rename(sourceDir, backupDir);
  }
  try {
    await writeSourceManifest(manifest);
    const result = await runSourceRefresh(manifest, { force: true });
    if (result.status === "fresh") {
      if (backupDir) await fs2.promises.rm(backupDir, { recursive: true, force: true });
      return { manifest, result };
    }
    if (backupDir) {
      await restoreSourceBackup(sourceDir, backupDir);
      throw new Error(result.error?.message ?? `Refresh failed for source "${manifest.name}".`);
    }
    return { manifest, result };
  } catch (error) {
    if (backupDir) await restoreSourceBackup(sourceDir, backupDir);
    throw error;
  }
}
async function restoreSourceBackup(sourceDir, backupDir) {
  await fs2.promises.rm(sourceDir, { recursive: true, force: true });
  if (await pathExists(backupDir)) await fs2.promises.rename(backupDir, sourceDir);
}
async function runSourceRefresh(manifest, options = {}) {
  const state = await readStateIfExists(manifest.name);
  const sourceDir = resolveSourceDir(manifest.name);
  const bundleDir = resolveBundleDir(manifest);
  return refreshSource({
    manifest,
    state,
    sourceDir,
    bundleDir,
    force: options.force,
    dryRun: options.dryRun,
    inspectBundle,
    hashBundleContent: hashBundleContents,
    crawlRunner: (crawlOptions) => crawlWebsite({ ...crawlOptions, onProgress: printCrawlProgress }),
    writeState: (next) => writeRefreshState(manifest.name, next)
  });
}
async function registeredRecord(name) {
  const manifest = await readSourceManifest(name);
  const state = await readStateIfExists(name);
  return {
    name,
    dir: resolveSourceDir(name),
    manifest,
    state,
    bundleDir: resolveBundleDir(manifest)
  };
}
function mcpRefreshHooksForRecord(record, mode, maxAgeSeconds) {
  return {
    mode,
    getFreshness: async () => {
      const latest = await registeredRecord(record.name);
      const nextState = await summarizeState(latest, maxAgeSeconds);
      await writeRefreshState(record.name, nextState);
      return nextState;
    },
    refreshIfNeeded: async () => {
      const latestManifest = await readSourceManifest(record.name);
      const result = await runSourceRefresh(latestManifest, { force: false });
      const bundleDir = resolveBundleDir(latestManifest);
      return {
        bundleDir,
        freshness: result.state ?? await readStateIfExists(record.name) ?? emptyState(result.status, (/* @__PURE__ */ new Date()).toISOString())
      };
    }
  };
}
function printValidation(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(report.valid ? pc.green("OKF bundle valid") : pc.red("OKF bundle invalid"));
  console.log(`Concepts: ${report.conceptCount}`);
  for (const item of report.issues) {
    const color = item.severity === "error" ? pc.red : pc.yellow;
    console.log(
      `${color(item.severity.toUpperCase())} ${item.code}${item.path ? ` ${item.path}` : ""}: ${item.message}`
    );
  }
}
function printStats(stats) {
  console.log(`Title: ${stats.title}`);
  console.log(`Concepts: ${stats.conceptCount}`);
  console.log(`Links: ${stats.linkCount}`);
  console.log(`Broken links: ${stats.brokenLinks}`);
  console.log(`Orphans: ${stats.orphanConcepts.length}`);
  console.log("Types:");
  for (const [type, count] of Object.entries(stats.typeDistribution))
    console.log(`  ${type}: ${count}`);
  console.log("Top linked concepts:");
  for (const item of stats.topLinkedConcepts.slice(0, 5))
    console.log(`  ${item.id}: ${item.count}`);
  if (Object.keys(stats.sourceDomains).length) {
    console.log("Source domains:");
    for (const [domain, count] of Object.entries(stats.sourceDomains))
      console.log(`  ${domain}: ${count}`);
  }
}
function printStatus(message) {
  process.stderr.write(`${message}
`);
}
async function writeFileAtomically(filePath, contents) {
  const resolved = path2.resolve(filePath);
  const tempPath = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  await fs2.promises.mkdir(path2.dirname(resolved), { recursive: true });
  try {
    await fs2.promises.writeFile(tempPath, contents, "utf8");
    await fs2.promises.rename(tempPath, resolved);
  } catch (error) {
    await fs2.promises.rm(tempPath, { force: true });
    throw error;
  }
}
function setupHomeCheck(okfyHome) {
  const defaultHome = defaultOkfyHome();
  if (path2.resolve(okfyHome) === path2.resolve(defaultHome)) {
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
function setupFreshnessCheck(record, state) {
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
async function setupBundleCheck(bundleDir) {
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
  } catch (error) {
    return setupCheck(
      "bundle",
      "Bundle validation",
      "fail",
      error?.message ?? "Bundle validation failed.",
      "Run npx -y okfy-ai update <source> to rebuild the bundle."
    );
  }
}
async function setupNpxCheck() {
  const fix = "Install Node.js >=20 with npm/npx, use an absolute npx path, or switch the config to an installed okfy command.";
  if (!await executableOnPath("npx")) {
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
function setupMcpProbeCheck(probe) {
  if (probe.ok) {
    return setupCheck(
      "mcp_probe",
      "MCP stdio probe",
      "pass",
      `MCP tools visible: ${probe.tools.join(", ")}.`
    );
  }
  const message = probe.error?.message ?? "MCP probe failed.";
  const fix = probe.error?.code === "stdout_contamination" ? "Move human logs to stderr so stdout contains only MCP JSON-RPC messages." : "Run the generated serve command in your MCP client, then rerun doctor with the same OKFY_HOME.";
  return setupCheck("mcp_probe", "MCP stdio probe", "fail", message, fix);
}
async function runSetupProbe(sourceNameOrNames, timeoutSeconds) {
  const command = serveCommand(sourceNameOrNames, resolveOkfyHome());
  return probeMcpStdio({
    command: process.execPath,
    args: [cliPath, ...serveCommandArgs(sourceNameOrNames)],
    env: { ...process.env, ...command.env },
    timeoutMs: timeoutSeconds * 1e3
  });
}
async function commandHealth(command, args, env) {
  return new Promise((resolve) => {
    execFile(command, args, { env, timeout: 3e3 }, (error, stdout, stderr) => {
      const message = (stderr || stdout || (error instanceof Error ? error.message : String(error ?? ""))).trim();
      if (error) resolve({ ok: false, message: message || "command failed" });
      else resolve({ ok: true, message: message || "ok" });
    });
  });
}
async function setupReportForRecord(options) {
  const state = await summarizeState(options.record, options.maxAge);
  await writeRefreshState(options.record.name, state);
  const bundleCheck = await setupBundleCheck(options.record.bundleDir);
  const npxCheck = await setupNpxCheck();
  const checks = [
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
      setupMcpProbeCheck(await runSetupProbe(options.record.name, options.probeTimeoutSeconds))
    );
  }
  return createSetupReport({
    sourceName: options.record.name,
    client: options.client,
    okfyHome: resolveOkfyHome(),
    checks
  });
}
async function setupReportForWorkspace(options) {
  const sourceNames = options.records.map((record) => record.name);
  const commandTarget = options.all ? { all: true } : sourceNames;
  const states = await Promise.all(
    options.records.map(async (record) => {
      const state = await summarizeState(record, options.maxAge);
      if (!record.loadError) await writeRefreshState(record.name, state);
      return { record, state };
    })
  );
  const bundleChecks = await Promise.all(
    options.records.map(
      async (record) => namespaceWorkspaceCheck(await setupBundleCheck(record.bundleDir), record.name)
    )
  );
  const freshnessChecks = states.map(
    ({ record, state }) => namespaceWorkspaceCheck(setupFreshnessCheck(record, state), record.name)
  );
  const npxCheck = await setupNpxCheck();
  const checks = [
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
      setupMcpProbeCheck(await runSetupProbe(commandTarget, options.probeTimeoutSeconds))
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
function namespaceWorkspaceCheck(check, sourceName) {
  return {
    ...check,
    id: `${check.id}:${sourceName}`,
    label: `${check.label} (${sourceName})`
  };
}
function setupReportForMissingSource(name, client, error) {
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
function setupReportForMissingWorkspace(names, client, error, all = false) {
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
function setupReportForInitFailure(name, client, error) {
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
function printSetupReport(report, json) {
  if (json) {
    printJson(report);
    return;
  }
  const color = report.status === "failed" ? pc.red : report.status === "warning" ? pc.yellow : pc.green;
  console.log(color(`Setup status: ${report.status}`));
  console.log(`${report.workspace ? "Sources" : "Source"}: ${report.sourceName}`);
  console.log(`OKFY_HOME: ${report.okfyHome}`);
  console.log("\nChecks:");
  for (const check of report.checks) {
    const label = check.severity === "fail" ? pc.red("FAIL") : check.severity === "warn" ? pc.yellow("WARN") : pc.green("PASS");
    console.log(`  ${label} ${check.label}: ${check.message}`);
    if (check.fix) console.log(`       Fix: ${check.fix}`);
  }
  console.log("\nMCP launch command:");
  console.log(`  ${report.command.display}`);
  if (Object.keys(report.command.env).length)
    console.log(`  env: ${JSON.stringify(report.command.env)}`);
  for (const artifact of report.artifacts) {
    console.log(`
${artifact.label}:`);
    console.log(artifact.body);
  }
  console.log("\nFirst prompt:");
  console.log(report.firstPrompt);
}
function printCrawlProgress(event) {
  const clear = isTty ? "\r\x1B[K" : "";
  switch (event.type) {
    case "start":
      process.stderr.write(
        `okfy crawl: starting ${event.seed} (max ${event.maxPages} pages, depth ${event.maxDepth})
`
      );
      break;
    case "fetch":
      process.stderr.write(
        `${clear}okfy crawl: fetching ${event.fetched}/${event.maxPages}, queued ${event.queued}: ${event.url}`
      );
      if (!isTty) process.stderr.write("\n");
      break;
    case "fetched":
      process.stderr.write(
        `${clear}okfy crawl: fetched ${event.fetched}/${event.maxPages}, queued ${event.queued}, discovered +${event.discovered}: ${event.url}
`
      );
      break;
    case "skipped":
      process.stderr.write(
        `${clear}okfy crawl: skipped ${event.fetched}/${event.maxPages}, queued ${event.queued}: ${event.url}
`
      );
      break;
    case "failed":
      process.stderr.write(
        `${clear}okfy crawl: failed ${event.fetched}/${event.maxPages}, queued ${event.queued}: ${event.url}
`
      );
      break;
    case "writing":
      process.stderr.write(
        `${clear}okfy crawl: writing ${event.concepts} concepts to ${event.outDir}
`
      );
      break;
  }
}
program.name("okfy").description("Turn docs into agent memory with Open Knowledge Format and MCP.").version(packageVersion());
var initCommand = program.command("init").argument("<name>", "Local source name").argument("<url>", "Docs URL to crawl").option(
  "--client <client>",
  "Target client: claude-code, claude-desktop, cursor, codex, or generic",
  setupClient,
  parseSetupClient("generic")
);
addSourceRegistrationOptions(initCommand).option("--probe-timeout <duration>", "MCP setup probe timeout", duration, 5).option("--json", "Print JSON output", false).action(async (name, url, options) => {
  try {
    const { manifest } = await registerWebsiteSource(name, url, options);
    const report = await setupReportForRecord({
      record: await registeredRecord(manifest.name),
      client: options.client,
      maxAge: options.maxAge,
      probeTimeoutSeconds: options.probeTimeout
    });
    printSetupReport(report, options.json);
    if (report.status === "failed") process.exitCode = 1;
  } catch (error) {
    if (options.json)
      printSetupReport(setupReportForInitFailure(name, options.client, error), true);
    else console.error(pc.red(error?.message ?? "Init failed."));
    process.exitCode = 1;
  }
});
program.command("doctor").argument("[names...]", "Registered source name(s)").option("--all", "Check all registered sources as one workspace", false).option(
  "--client <client>",
  "Target client: claude-code, claude-desktop, cursor, codex, or generic",
  setupClient,
  parseSetupClient("generic")
).option("--max-age <duration>", "Override freshness max age", duration).option("--probe-timeout <duration>", "MCP setup probe timeout", duration, 5).option("--json", "Print JSON output", false).action(async (names = [], options) => {
  try {
    if (options.all && names.length > 0) {
      throw new Error("Use either --all or explicit source names, not both.");
    }
    if (options.all || names.length > 1) {
      const sourceSet = await resolveWorkspaceSources({ all: options.all, names });
      const report2 = await setupReportForWorkspace({
        records: sourceSet.records,
        client: options.client,
        maxAge: options.maxAge,
        probeTimeoutSeconds: options.probeTimeout,
        all: options.all
      });
      printSetupReport(report2, options.json);
      if (report2.status === "failed") process.exitCode = 1;
      return;
    }
    const name = names[0];
    if (!name)
      throw new Error("Provide a registered source name, multiple source names, or --all.");
    const report = await setupReportForRecord({
      record: await registeredRecord(name),
      client: options.client,
      maxAge: options.maxAge,
      probeTimeoutSeconds: options.probeTimeout
    });
    printSetupReport(report, options.json);
    if (report.status === "failed") process.exitCode = 1;
  } catch (error) {
    const report = names.length <= 1 && !options.all ? setupReportForMissingSource(names[0] ?? "source", options.client, error) : setupReportForMissingWorkspace(names, options.client, error, options.all);
    printSetupReport(report, options.json);
    process.exitCode = 1;
  }
});
var addCommand = program.command("add").argument("<name>", "Local source name").argument("<url>", "Docs URL to crawl");
addSourceRegistrationOptions(addCommand).option("--json", "Print JSON output", false).action(async (name, url, options) => {
  try {
    const { manifest, result } = await registerWebsiteSource(name, url, options);
    const bundlePath = resolveBundleDir(manifest);
    const payload = {
      name: manifest.name,
      status: result.state?.status ?? result.status,
      bundlePath,
      conceptCount: result.state?.bundle?.conceptCount ?? 0,
      warningCount: result.state?.bundle?.warningCount ?? 0,
      valid: result.state?.bundle?.valid ?? false,
      nextCommand: `okfy serve ${manifest.name} --mcp --auto-refresh`,
      error: result.error ?? null
    };
    if (options.json) printJson(payload);
    else {
      console.log(`Registered source: ${manifest.name}`);
      console.log(`Status: ${payload.status}`);
      console.log(`Concepts: ${payload.conceptCount}`);
      console.log(`Bundle: ${bundlePath}`);
      console.log("\nNext:");
      console.log(`  okfy sources`);
      console.log(`  ${payload.nextCommand}`);
    }
    if (result.status !== "fresh") process.exitCode = 1;
  } catch (error) {
    if (options.json)
      printJson({ status: "failed", error: { message: error?.message ?? "Add failed." } });
    else console.error(pc.red(error?.message ?? "Add failed."));
    process.exitCode = 1;
  }
});
program.command("sources").option("--json", "Print JSON output", false).action(async (options) => {
  try {
    const records = await listSources();
    const rows = await Promise.all(
      records.map(async (record) => sourceRow(record, await summarizeState(record)))
    );
    if (options.json) printJson(rows);
    else printSourceRows(rows);
  } catch (error) {
    if (options.json) printJson({ error: { message: error?.message ?? "Sources failed." } });
    else console.error(pc.red(error?.message ?? "Sources failed."));
    process.exitCode = 1;
  }
});
program.command("check").argument("<name-or-bundle>", "Registered source name or OKF bundle directory").option("--max-age <duration>", "Override freshness max age", duration).option("--json", "Print JSON output", false).action(async (target, options) => {
  try {
    if (await pathExists(target)) {
      const [validation, stats] = await Promise.all([
        validateBundle(target),
        inspectBundle(target).catch(() => void 0)
      ]);
      const payload2 = {
        target,
        registeredSource: false,
        status: validation.valid ? "fresh" : "failed",
        valid: validation.valid,
        conceptCount: validation.conceptCount,
        warningCount: validation.warningCount,
        stats
      };
      if (options.json) printJson(payload2);
      else {
        console.log(`Bundle: ${target}`);
        console.log(`Status: ${payload2.status}`);
        console.log(`Valid: ${payload2.valid}`);
        console.log(`Concepts: ${payload2.conceptCount}`);
      }
      if (!validation.valid) process.exitCode = 1;
      return;
    }
    const record = await registeredRecord(target);
    const nextState = await summarizeState(record, options.maxAge);
    await writeRefreshState(record.name, nextState);
    const payload = sourceRow(record, nextState);
    if (options.json) printJson(payload);
    else printSourceRows([payload]);
    if (nextState.status !== "fresh" || nextState.bundle?.valid !== true) process.exitCode = 1;
  } catch (error) {
    if (options.json)
      printJson({ status: "failed", error: { message: error?.message ?? "Check failed." } });
    else console.error(pc.red(error?.message ?? "Check failed."));
    process.exitCode = 2;
  }
});
program.command("update").argument("<name>", "Registered source name").option("--json", "Print JSON output", false).option("--dry-run", "Report what would be refreshed without replacing the active bundle", false).action(async (name, options) => {
  try {
    const manifest = await readSourceManifest(name);
    const oldState = await readStateIfExists(name);
    const result = await runSourceRefresh(manifest, { force: true, dryRun: options.dryRun });
    const bundlePath = resolveBundleDir(manifest);
    const payload = {
      name: manifest.name,
      status: result.state?.status ?? result.status,
      skipped: result.skipped,
      reason: result.reason ?? null,
      dryRun: Boolean(result.dryRun),
      oldConceptCount: oldState?.bundle?.conceptCount ?? null,
      newConceptCount: result.state?.bundle?.conceptCount ?? oldState?.bundle?.conceptCount ?? null,
      warningCount: result.state?.bundle?.warningCount ?? oldState?.bundle?.warningCount ?? null,
      bundlePath,
      dryRunPages: result.crawlResult?.dryRunPages,
      error: result.error ?? null
    };
    if (options.json) printJson(payload);
    else {
      console.log(`Updated source: ${manifest.name}`);
      console.log(`Status: ${payload.status}`);
      console.log(`Old concepts: ${payload.oldConceptCount ?? "unknown"}`);
      console.log(`New concepts: ${payload.newConceptCount ?? "unknown"}`);
      console.log(`Bundle: ${bundlePath}`);
      if (payload.error) console.log(`Error: ${payload.error.message}`);
    }
    if (result.status === "failed") process.exitCode = 1;
  } catch (error) {
    if (options.json)
      printJson({ status: "failed", error: { message: error?.message ?? "Update failed." } });
    else console.error(pc.red(error?.message ?? "Update failed."));
    process.exitCode = 1;
  }
});
program.command("remove").argument("<name>", "Registered source name").option("-y, --yes", "Skip confirmation", false).option("--json", "Print JSON output", false).action(async (name, options) => {
  try {
    validateSourceName(name);
    if (!options.yes && !options.json) {
      throw new Error(`Refusing to remove "${name}" without --yes in non-interactive mode.`);
    }
    await removeSource(name);
    const payload = { removed: true, name };
    if (options.json) printJson(payload);
    else console.log(`Removed source: ${name}`);
  } catch (error) {
    if (options.json)
      printJson({ removed: false, name, error: { message: error?.message ?? "Remove failed." } });
    else console.error(pc.red(error?.message ?? "Remove failed."));
    process.exitCode = 1;
  }
});
program.command("crawl").argument("<url>", "Docs URL to crawl").requiredOption("--out <dir>", "Output OKF bundle directory").option("--max-pages <n>", "Maximum pages", positiveIntegerOption("max-pages"), 100).option("--max-depth <n>", "Maximum crawl depth", nonNegativeIntegerOption("max-depth"), 4).option("--include <pattern>", "Include glob or regex", collect, []).option("--exclude <pattern>", "Exclude glob or regex", collect, []).option("--same-origin", "Stay on same origin", true).option("--no-same-origin", "Allow cross-origin links").option("--respect-robots", "Respect robots.txt", true).option("--no-respect-robots", "Ignore robots.txt").option("--concurrency <n>", "Fetch concurrency", positiveIntegerOption("concurrency"), 4).option("--title <name>", "Bundle title").option("--force", "Overwrite output directory", false).option("--dry-run", "List pages that would be crawled", false).option("--allow-private-network", "Allow localhost/private IP crawl targets", false).option(
  "--dangerously-allow-unsafe-output",
  "Dangerously allow --force to delete otherwise unsafe output paths",
  false
).option("--stable-timestamps", "Use a deterministic timestamp in generated frontmatter", false).action(async (url, options) => {
  try {
    const result = await crawlWebsite({
      seedUrl: url,
      outDir: options.out,
      ...options,
      timestamp: options.stableTimestamps ? "2026-06-14T00:00:00.000Z" : void 0,
      onProgress: printCrawlProgress
    });
    if (options.dryRun) {
      console.log("okfy crawl dry run");
      for (const page of result.dryRunPages ?? []) console.log(page);
      return;
    }
    console.log("okfy crawl");
    console.log(`Seed: ${url}`);
    console.log(
      `Pages: ${result.pagesFetched} fetched, ${result.skipped} skipped, ${result.failed} failed`
    );
    console.log(`Concepts: ${result.documents.length} written`);
    console.log(`Output: ${options.out}`);
    console.log("\nNext:");
    console.log(`  okfy validate ${options.out}`);
    console.log(`  okfy serve ${options.out} --mcp`);
  } catch (error) {
    console.error(pc.red(error?.message ?? "Crawl failed."));
    process.exitCode = 1;
  }
});
program.command("import").argument("<path>", "Local docs folder or file").requiredOption("--out <dir>", "Output OKF bundle directory").option("--source-name <name>", "Source name").option("--include <glob>", "Include glob", collect, []).option("--exclude <glob>", "Exclude glob", collect, []).option("--force", "Overwrite output directory", false).option(
  "--dangerously-allow-unsafe-output",
  "Dangerously allow --force to delete otherwise unsafe output paths",
  false
).option("--stable-timestamps", "Use a deterministic timestamp in generated frontmatter", false).action(async (input, options) => {
  try {
    printStatus(`okfy import: reading ${input}`);
    printStatus(`okfy import: writing bundle to ${options.out}`);
    const result = await importLocal({
      inputPath: input,
      outDir: options.out,
      ...options,
      timestamp: options.stableTimestamps ? "2026-06-14T00:00:00.000Z" : void 0
    });
    console.log("okfy import");
    console.log(`Source: ${input}`);
    console.log(`Concepts: ${result.documents.length} written`);
    console.log(`Output: ${options.out}`);
    printStatus(`okfy import: done, wrote ${result.documents.length} concepts`);
  } catch (error) {
    console.error(pc.red(error?.message ?? "Import failed."));
    process.exitCode = 1;
  }
});
program.command("validate").argument("<bundle>", "OKF bundle directory").option("--json", "Print JSON report", false).action(async (bundle, options) => {
  printStatus(`okfy validate: checking ${bundle}`);
  const report = await validateBundle(bundle);
  printValidation(report, options.json);
  printStatus(
    `okfy validate: ${report.valid ? "valid" : "invalid"}, ${report.conceptCount} concepts`
  );
  if (!report.valid) process.exitCode = 1;
});
program.command("inspect").argument("<bundle>", "OKF bundle directory").action(async (bundle) => {
  try {
    printStatus(`okfy inspect: reading ${bundle}`);
    const stats = await inspectBundle(bundle);
    printStats(stats);
    printStatus(`okfy inspect: done, ${stats.conceptCount} concepts, ${stats.linkCount} links`);
  } catch (error) {
    console.error(pc.red(error?.message ?? "Inspect failed."));
    process.exitCode = 1;
  }
});
program.command("map").argument("[targets...]", "Registered source name(s), OKF bundle path(s), or one OKF bundle directory").option("--all", "Map all registered sources as one source-aware workspace", false).option("--out <file>", "Inspector HTML output file", "okfy-inspector.html").option("--json", "Print Inspector report JSON without writing HTML", false).action(async (targets = [], options) => {
  try {
    if (options.all && targets.length > 0) {
      throw new Error("Use either --all or explicit source names, not both.");
    }
    if (!options.all && targets.length === 0) {
      throw new Error("Provide a registered source name, an OKF bundle directory, or --all.");
    }
    let report;
    const target = targets[0];
    if (!options.all && targets.length === 1 && pathLikeTarget(target)) {
      if (!await pathExists(target)) throw new Error(`Bundle path does not exist: ${target}`);
      await assertBundleHasConceptFiles(target);
      report = await buildBundleInspectorReport(target);
    } else if (!options.all && targets.length === 1) {
      try {
        const record = await registeredRecord(target);
        report = await buildWorkspaceInspectorReport([record]);
      } catch (error) {
        if (!pathLikeTarget(target) && await pathExists(target) && !await registeredSourceDirExists(target)) {
          await assertBundleHasConceptFiles(target);
          report = await buildBundleInspectorReport(target);
        } else {
          throw error;
        }
      }
    } else {
      const bundleTargets = options.all ? [] : targets.filter(pathLikeTarget);
      const sourceTargets = options.all ? [] : targets.filter((sourceName) => !pathLikeTarget(sourceName));
      const sourceSet = options.all || sourceTargets.length ? await resolveWorkspaceSources({ all: options.all, names: sourceTargets }) : { records: [], sourceNames: [] };
      const bundleRecords = await Promise.all(
        bundleTargets.map(async (bundleTarget) => {
          if (!await pathExists(bundleTarget)) {
            throw new Error(`Workspace bundle path does not exist: ${bundleTarget}`);
          }
          await assertBundleHasConceptFiles(bundleTarget);
          return localBundleRecord(bundleTarget);
        })
      );
      const records = [...sourceSet.records, ...bundleRecords];
      assertUniqueWorkspaceRecordNames(records);
      report = await buildWorkspaceInspectorReport(records, { all: options.all });
    }
    if (options.json) {
      printJson(report);
      return;
    }
    const outputPath = path2.resolve(options.out);
    const html = renderInspectorHtml(report);
    await writeFileAtomically(outputPath, html);
    console.log(`Wrote OKFY Inspector: ${outputPath}`);
  } catch (error) {
    if (options.json) {
      printJson({ status: "failed", error: { message: error?.message ?? "Map failed." } });
    } else {
      console.error(pc.red(error?.message ?? "Map failed."));
    }
    process.exitCode = 1;
  }
});
program.command("serve").argument(
  "[targets...]",
  "Registered source name(s), OKF bundle path(s), or one OKF bundle directory"
).option("--all", "Serve all registered sources as one source-aware workspace", false).option("--mcp", "Start MCP server", false).option("--transport <transport>", "Transport: stdio", "stdio").option("--name <server-name>", "MCP server name", "okfy").option(
  "--max-result-chars <n>",
  "Maximum characters per tool result",
  (value) => Number(value),
  12e3
).option("--auto-refresh", "Enable registered source refresh behavior", false).option(
  "--refresh-mode <mode>",
  "Refresh mode override: off, stale-while-refresh, or blocking",
  refreshMode
).option("--max-age <duration>", "Override freshness max age", duration).action(async (targets = [], options) => {
  if (!options.mcp) {
    console.error(pc.red("Only --mcp mode is supported in v0.1."));
    process.exitCode = 1;
    return;
  }
  if (options.transport !== "stdio") {
    console.error(pc.red("Only stdio transport is supported in v0.1."));
    process.exitCode = 1;
    return;
  }
  if (options.all && targets.length > 0) {
    console.error(pc.red("Use either --all or explicit source names, not both."));
    process.exitCode = 1;
    return;
  }
  if (!options.all && targets.length === 0) {
    console.error(pc.red("Provide a registered source name, an OKF bundle directory, or --all."));
    process.exitCode = 1;
    return;
  }
  const target = targets[0];
  try {
    if (!options.all && targets.length === 1 && pathLikeTarget(target)) {
      if (!await pathExists(target)) throw new Error(`Bundle path does not exist: ${target}`);
      await serveBundleTarget(target, options);
      return;
    }
    if (options.all || targets.length > 1) {
      const bundleTargets = options.all ? [] : targets.filter(pathLikeTarget);
      const sourceTargets = options.all ? [] : targets.filter((sourceName) => !pathLikeTarget(sourceName));
      const sourceSet = options.all || sourceTargets.length ? await resolveWorkspaceSources({ all: options.all, names: sourceTargets }) : { records: [], sourceNames: [] };
      const bundleRecords = await Promise.all(
        bundleTargets.map(async (bundleTarget) => {
          if (!await pathExists(bundleTarget)) {
            throw new Error(`Workspace bundle path does not exist: ${bundleTarget}`);
          }
          return localBundleRecord(bundleTarget);
        })
      );
      const records = [...sourceSet.records, ...bundleRecords];
      assertUniqueWorkspaceRecordNames(records);
      const availableSourceNames = options.all ? sourceSet.sourceNames : (await listSources()).map((record2) => record2.name);
      const workspaceNames = records.map((record2) => record2.name);
      printStatus(`okfy serve: loading workspace sources ${workspaceNames.join(", ")}`);
      printStatus(`okfy serve: starting MCP stdio server "${options.name}"`);
      await serveWorkspaceMcpStdio({
        name: options.name,
        maxResultChars: options.maxResultChars,
        availableSourceNames,
        sources: records.map((record2) => {
          if (!isRegisteredWorkspaceRecord(record2)) return { record: record2 };
          const mode2 = options.autoRefresh ? options.refreshMode ?? record2.manifest.refresh.mode : "off";
          return { record: record2, refresh: mcpRefreshHooksForRecord(record2, mode2, options.maxAge) };
        })
      });
      printStatus("okfy serve: ready on stdio (stdout is reserved for MCP JSON-RPC)");
      printStatus(`okfy serve: tools ${MCP_TOOL_NAMES.join(", ")}`);
      return;
    }
    let manifest;
    try {
      manifest = await readSourceManifest(target);
    } catch (error) {
      if (!pathLikeTarget(target) && await pathExists(target) && !await registeredSourceDirExists(target)) {
        await serveBundleTarget(target, options);
        return;
      }
      throw error;
    }
    const bundleDir = resolveBundleDir(manifest);
    const mode = options.autoRefresh ? options.refreshMode ?? manifest.refresh.mode : "off";
    const maxAgeSeconds = options.maxAge;
    const record = await registeredRecord(manifest.name);
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
  } catch (error) {
    console.error(pc.red(error?.message ?? "Serve failed."));
    process.exitCode = 1;
  }
});
function resolveDemoBundle() {
  const relativeBundle = "examples/bundles/okfy-docs";
  if (fs2.existsSync(relativeBundle)) return relativeBundle;
  return path2.join(packageRoot, relativeBundle);
}
program.command("demo").description("Run offline demo against committed example bundle").action(async () => {
  const bundle = resolveDemoBundle();
  console.log("okfy demo");
  console.log(`Offline bundle: ${bundle}`);
  const report = await validateBundle(bundle);
  printValidation(report, false);
  if (!report.valid) {
    process.exitCode = 1;
    return;
  }
  console.log("");
  printStats(await inspectBundle(bundle));
  console.log("");
  console.log("MCP config:");
  console.log(
    JSON.stringify(
      {
        mcpServers: {
          "okfy-docs": { command: "npx", args: ["-y", "okfy-ai", "serve", bundle, "--mcp"] }
        }
      },
      null,
      2
    )
  );
  console.log("");
  console.log("Ask an agent:");
  console.log("1. Search okfy docs for crawler security defaults, then cite source concepts.");
  console.log("2. Read the MCP setup concept and explain the stdio config.");
  console.log("3. Find importer concepts and list supported input formats.");
});
program.parseAsync(process.argv);
