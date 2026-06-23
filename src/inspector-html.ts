type RenderReadiness = {
  validationStatus?: string;
  availabilityStatus?: string;
  sourceCount?: number;
  usableSourceCount?: number;
  conceptCount?: number;
  warningCount?: number;
  brokenLinkCount?: number;
  brokenLinks?: number;
  orphanConcepts?: string[];
  freshnessStatus?: string;
  freshnessStatuses?: Record<string, number>;
  refreshInProgress?: boolean;
  lastSuccessfulRefreshAt?: string | null;
  nextRefreshAllowedAt?: string | null;
  lastRefreshError?: unknown;
  sources?: RenderSource[];
};

type RenderSource = {
  name?: string;
  sourceName?: string;
  label?: string;
  kind?: string;
  sourceKind?: string;
  seedUrl?: string;
  bundleDir?: string;
  freshnessStatus?: string;
  conceptCount?: number;
  warningCount?: number;
  brokenLinkCount?: number;
  orphanConcepts?: string[];
  refreshInProgress?: boolean;
  nextRefreshAllowedAt?: string | null;
  lastSuccessfulRefreshAt?: string | null;
  validationStatus?: string;
  availabilityStatus?: string;
  lastRefreshError?: unknown;
};

type RenderConcept = {
  id: string;
  ref: string;
  path?: string;
  title?: string;
  type?: string;
  tags?: string[];
  description?: string;
  resource?: string;
  resourceUrl?: string;
  sourceName?: string;
  outbound?: string[];
  outboundLinks?: string[];
  backlinks?: string[];
  citation?: unknown;
};

type RenderEdge = {
  from: string;
  to: string;
  kind?: string;
  label?: string;
  sourceName?: string;
};

type RenderAgentPreview = {
  sequence?: Array<{ tool: string; name?: string; purpose: string; example?: string }>;
  tools: Array<{ name: string; purpose: string }>;
  citationGuidance?: string;
  suggestedQuestions?: string[];
};

export type InspectorReport = {
  schemaVersion?: number;
  title: string;
  generatedBy?: string;
  target?: unknown;
  readiness: RenderReadiness;
  sources: RenderSource[];
  concepts: RenderConcept[];
  edges: RenderEdge[];
  agentPreview: RenderAgentPreview;
};

export function renderInspectorHtml(report: InspectorReport): string {
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

function renderToolbar(concepts: NormalizedReport["concepts"]): string {
  const sources = uniqueSorted(concepts.map((concept) => concept.sourceName).filter(isNonEmptyString));
  const types = uniqueSorted(concepts.map((concept) => concept.type).filter(isNonEmptyString));
  return `<div class="toolbar">
<input id="concept-filter" type="search" placeholder="Filter concepts" aria-label="Filter concepts">
<select id="source-filter" aria-label="Filter by source">
<option value="">All sources</option>
${sources
  .map((source) => `<option value="${escapeAttribute(source)}">${escapeHtml(source)}</option>`)
  .join("")}
</select>
<select id="type-filter" aria-label="Filter by type">
<option value="">All types</option>
${types.map((type) => `<option value="${escapeAttribute(type)}">${escapeHtml(type)}</option>`).join("")}
</select>
</div>`;
}

function renderMetrics(readiness: NormalizedReport["readiness"]): string {
  const metrics = [
    ["Validation status", readiness.validationStatus],
    ["Concepts", readiness.conceptCount],
    ["Warnings", readiness.warningCount],
    ["Broken links", readiness.brokenLinkCount],
    ["Orphan concepts", readiness.orphanConcepts.length],
    ["Source freshness", readiness.freshnessStatus ?? "snapshot"]
  ];
  const error = readiness.lastRefreshError
    ? `<p class="error">${escapeHtml(errorMessage(readiness.lastRefreshError))}</p>`
    : "";
  return `<div class="metrics">${metrics
    .map(
      ([label, value]) =>
        `<div class="metric"><strong>${escapeHtml(String(value))}</strong><span>${escapeHtml(String(label))}</span></div>`
    )
    .join("")}</div>${error}`;
}

function renderSources(sources: NormalizedReport["sources"]): string {
  if (!sources.length) return "";
  return `<div class="source-grid">${sources
    .map(
      (source) =>
        `<div class="source"><b>${escapeHtml(source.label ?? source.name ?? source.sourceName ?? "source")}</b><small>${escapeHtml(source.kind ?? sourceKind(source) ?? "local")} / ${escapeHtml(source.validationStatus ?? "unknown")} / ${escapeHtml(source.freshnessStatus ?? "snapshot")}</small><small>Concepts: ${escapeHtml(String(source.conceptCount ?? 0))}</small>${source.lastRefreshError ? `<small class="error">${escapeHtml(errorMessage(source.lastRefreshError))}</small>` : ""}</div>`
    )
    .join("")}</div>`;
}

function renderMap(concepts: NormalizedReport["concepts"], edges: NormalizedReport["edges"]): string {
  const positions = layout(concepts);
  const edgeHtml = edges
    .map((edge) => {
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      if (!from || !to) return "";
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx) * (180 / Math.PI);
      return `<span class="edge" data-from="${escapeAttribute(edge.from)}" data-to="${escapeAttribute(edge.to)}" style="left:${from.x + 74}px;top:${from.y + 28}px;width:${Math.max(12, length)}px;transform:rotate(${angle.toFixed(3)}deg)" title="${escapeAttribute(edge.label ?? "Markdown link")}"></span>`;
    })
    .join("");
  const nodeHtml = concepts
    .map((concept, index) => {
      const position = positions.get(concept.ref) ?? { x: 20, y: 20 };
      return `<button class="node${index === 0 ? " active" : ""}" data-ref="${escapeAttribute(concept.ref)}" data-source="${escapeAttribute(concept.sourceName ?? "")}" data-type="${escapeAttribute(concept.type ?? "")}" style="left:${position.x}px;top:${position.y}px" type="button"><b>${escapeHtml(concept.title ?? concept.id)}</b><small>${escapeHtml([concept.sourceName, concept.type].filter(Boolean).join(" / "))}</small></button>`;
    })
    .join("");
  return `<div class="map">${edgeHtml}${nodeHtml}</div>`;
}

function renderConceptDetail(concept: NormalizedReport["concepts"][number] | undefined): string {
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

function renderAgentPreview(agentPreview: NormalizedReport["agentPreview"]): string {
  const tools = agentPreview.tools.length
    ? agentPreview.tools
    : agentPreview.sequence.map((step) => ({ name: step.tool, purpose: step.purpose }));
  return `<div class="steps">${tools
    .map(
      (tool, index) =>
        `<div class="step"><code>${index + 1}. ${escapeHtml(tool.name)}</code><p>${escapeHtml(tool.purpose)}</p></div>`
    )
    .join("")}</div>
<p>${escapeHtml(agentPreview.citationGuidance ?? "")}</p>
<ol class="questions">${(agentPreview.suggestedQuestions ?? [])
    .map((question) => `<li>${escapeHtml(question)}</li>`)
    .join("")}</ol>`;
}

type NormalizedReport = {
  title: string;
  readiness: Required<RenderReadiness>;
  sources: RenderSource[];
  concepts: RenderConcept[];
  edges: RenderEdge[];
  agentPreview: Required<RenderAgentPreview>;
};

function normalizeReport(report: InspectorReport): NormalizedReport {
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
    sources: [...(report.sources ?? [])]
      .map((source) => ({
        ...source,
        name: source.name ?? source.sourceName,
        label: source.label ?? source.name ?? source.sourceName ?? "source",
        kind: source.kind ?? sourceKind(source) ?? "local"
      }))
      .sort(compareSources),
    concepts: [...(report.concepts ?? [])].sort(compareConcepts),
    edges: [...(report.edges ?? [])].sort(compareEdges),
    agentPreview: {
      sequence: agentPreview.sequence ?? [],
      tools: agentPreview.tools ?? [],
      citationGuidance: agentPreview.citationGuidance ?? "",
      suggestedQuestions: agentPreview.suggestedQuestions ?? []
    }
  };
}

function compareSources(first: RenderSource, second: RenderSource): number {
  return (
    compareText(first.label ?? first.name ?? "", second.label ?? second.name ?? "") ||
    compareText(first.name ?? "", second.name ?? "")
  );
}

function compareConcepts(first: RenderConcept, second: RenderConcept): number {
  return (
    compareText(first.sourceName ?? "", second.sourceName ?? "") ||
    compareText(first.type ?? "", second.type ?? "") ||
    compareText(first.title ?? first.id, second.title ?? second.id) ||
    compareText(first.ref, second.ref)
  );
}

function compareEdges(first: RenderEdge, second: RenderEdge): number {
  return (
    compareText(first.sourceName ?? "", second.sourceName ?? "") ||
    compareText(first.from, second.from) ||
    compareText(first.to, second.to) ||
    compareText(first.label ?? "", second.label ?? "")
  );
}

function layout(concepts: RenderConcept[]): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  const groups = new Map<string, RenderConcept[]>();
  for (const concept of concepts) {
    const group = concept.sourceName || concept.type || "bundle";
    groups.set(group, [...(groups.get(group) ?? []), concept]);
  }
  const columns = [...groups.entries()].sort(([first], [second]) => compareText(first, second));
  columns.forEach(([, groupConcepts], columnIndex) => {
    groupConcepts
      .sort(compareConcepts)
      .forEach((concept, rowIndex) => {
        positions.set(concept.ref, {
          x: 20 + columnIndex * 230,
          y: 20 + rowIndex * 92
        });
      });
  });
  return positions;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort(compareText);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function compareText(first: string, second: string): number {
  if (first < second) return -1;
  if (first > second) return 1;
  return 0;
}

function errorMessage(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return String(error);
}

function escapeHtml(value: string): string {
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

function escapeAttribute(value: string): string {
  return escapeHtml(value);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value)
    .sort(compareText)
    .reduce<Record<string, unknown>>((result, key) => {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) result[key] = sortJson(item);
      return result;
    }, {});
}

function escapeJsonForHtml(value: string): string {
  return value
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function sourceKind(source: RenderSource): string | undefined {
  return source.sourceKind;
}
