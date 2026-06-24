import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { renderInspectorHtml, type InspectorReport } from "../src/inspector-html.js";

const tempDirs: string[] = [];
const chromeExecutable = findChromeExecutable();

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function reportFixture(): InspectorReport {
  return {
    schemaVersion: 1,
    title: "Stripe Docs",
    generatedBy: "okfy",
    target: {
      kind: "workspace",
      workspaceName: "payments",
      sourceNames: ["stripe"]
    },
    readiness: {
      availabilityStatus: "available",
      validationStatus: "valid",
      sourceCount: 1,
      usableSourceCount: 1,
      conceptCount: 2,
      warningCount: 1,
      brokenLinkCount: 0,
      brokenLinks: 0,
      orphanConcepts: ["reference/api"],
      freshnessStatus: "fresh",
      freshnessStatuses: { fresh: 1 },
      refreshInProgress: false,
      lastSuccessfulRefreshAt: "2026-06-23T00:00:00.000Z",
      nextRefreshAllowedAt: null,
      lastRefreshError: { message: "Previous crawl recovered cleanly" },
      sources: []
    },
    sources: [
      {
        sourceName: "stripe",
        name: "stripe",
        label: "Stripe Docs",
        kind: "website",
        seedUrl: "https://docs.stripe.com",
        bundleDir: "/tmp/okfy/stripe",
        availabilityStatus: "available",
        validationStatus: "valid",
        freshnessStatus: "fresh",
        conceptCount: 2,
        warningCount: 1,
        brokenLinkCount: 0,
        orphanConcepts: [],
        refreshInProgress: false,
        lastSuccessfulRefreshAt: "2026-06-23T00:00:00.000Z",
        nextRefreshAllowedAt: null,
        lastRefreshError: null
      }
    ],
    concepts: [
      {
        id: "guides/quickstart",
        ref: "stripe:guides/quickstart",
        path: "guides/quickstart.md",
        title: "Quickstart",
        type: "guide",
        tags: ["payments", "setup"],
        description: "Install the SDK and create your first checkout session.",
        resourceUrl: "https://docs.stripe.com/quickstart",
        sourceName: "stripe",
        outbound: ["reference/api"],
        outboundLinks: ["reference/api"],
        backlinks: [],
        citation: {
          ref: "stripe:guides/quickstart",
          conceptPath: "guides/quickstart.md",
          sourceResource: "https://docs.stripe.com/quickstart",
          sourceName: "stripe"
        }
      },
      {
        id: "reference/api",
        ref: "stripe:reference/api",
        path: "reference/api.md",
        title: "API Reference",
        type: "reference",
        tags: ["api"],
        description: "Use the API to create sessions.",
        resourceUrl: "https://docs.stripe.com/api",
        sourceName: "stripe",
        outbound: [],
        outboundLinks: [],
        backlinks: ["guides/quickstart"],
        citation: {
          ref: "stripe:reference/api",
          conceptPath: "reference/api.md",
          sourceResource: "https://docs.stripe.com/api",
          sourceName: "stripe"
        }
      }
    ],
    edges: [
      {
        from: "stripe:guides/quickstart",
        to: "stripe:reference/api",
        kind: "internal_link",
        label: "Markdown link",
        sourceName: "stripe"
      }
    ],
    agentPreview: {
      sequence: [
        {
          tool: "bundle_summary",
          name: "bundle_summary",
          purpose: "Start with readiness and source freshness.",
          example: "bundle_summary({})"
        },
        {
          tool: "search_concepts",
          name: "search_concepts",
          purpose: "Find the relevant docs concept.",
          example: 'search_concepts({ "query": "checkout", "limit": 5 })'
        },
        {
          tool: "read_concept",
          name: "read_concept",
          purpose: "Read only the selected concept.",
          example: 'read_concept({ "id": "guides/quickstart" })'
        },
        {
          tool: "get_neighbors",
          name: "get_neighbors",
          purpose: "Traverse related docs when relationships matter.",
          example: 'get_neighbors({ "id": "guides/quickstart", "depth": 1 })'
        }
      ],
      tools: [
        { name: "bundle_summary", purpose: "Start with readiness and source freshness." },
        { name: "search_concepts", purpose: "Find the relevant docs concept." },
        { name: "read_concept", purpose: "Read only the selected concept." },
        { name: "get_neighbors", purpose: "Traverse related docs when relationships matter." }
      ],
      citationGuidance: "Cite source_resource URLs from selected concepts.",
      suggestedQuestions: [
        "Which Stripe docs explain checkout setup?",
        "What should I read next after Quickstart?"
      ]
    }
  };
}

function findChromeExecutable(): string | undefined {
  const envPath = process.env.OKFY_CHROME_PATH ?? process.env.CHROME_BIN;
  if (envPath && existsSync(envPath)) return envPath;
  for (const candidate of [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  for (const command of ["google-chrome", "chromium", "chromium-browser"]) {
    const result = spawnSync("which", [command], { encoding: "utf8" });
    if (result.status === 0) return result.stdout.trim().split(/\r?\n/)[0];
  }
  return undefined;
}

type LayoutResult = {
  bodyClientWidth: number;
  bodyScrollWidth: number;
  documentClientWidth: number;
  documentScrollWidth: number;
  errors: string[];
  overlapsDetail: boolean;
  shellClientWidth: number;
  shellScrollWidth: number;
};

type ChromeTarget = {
  type?: string;
  url?: string;
  webSocketDebuggerUrl?: string;
};

type CdpResponse = {
  error?: { message?: string };
  id?: number;
  result?: any;
};

async function getFreePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  if (!address || typeof address === "string") throw new Error("Expected TCP port.");
  return address.port;
}

async function waitForPageWebSocket(port: number, process: ChildProcess): Promise<string> {
  const deadline = Date.now() + 10_000;
  let stderr = "";
  process.stderr?.on("data", (chunk) => {
    stderr += String(chunk);
  });

  while (Date.now() < deadline) {
    if (process.exitCode !== null)
      throw new Error(stderr || `Chrome exited with ${process.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      const targets = (await response.json()) as ChromeTarget[];
      const page =
        targets.find(
          (target) =>
            target.type === "page" && target.url?.startsWith("file:") && target.webSocketDebuggerUrl
        ) ?? targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      await delay(100);
    }
  }

  throw new Error(`Timed out waiting for Chrome DevTools. stderr=${stderr}`);
}

async function closeChrome(process: ChildProcess): Promise<void> {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await delay(250);
  if (process.exitCode === null) process.kill("SIGKILL");
}

async function evaluateLayout(webSocketUrl: string): Promise<LayoutResult> {
  const ws = new WebSocket(webSocketUrl);
  let requestId = 0;
  const pending = new Map<
    number,
    { reject(error: Error): void; resolve(value: CdpResponse): void }
  >();

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as CdpResponse;
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message ?? "CDP command failed."));
    else request.resolve(message);
  });

  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("Chrome DevTools WebSocket failed.")), {
      once: true
    });
  });

  async function send(method: string, params?: Record<string, unknown>): Promise<CdpResponse> {
    const id = ++requestId;
    const response = new Promise<CdpResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    ws.send(JSON.stringify({ id, method, params }));
    return response;
  }

  try {
    await send("Runtime.enable");
    let latest: LayoutResult | undefined;
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await send("Runtime.evaluate", {
        awaitPromise: true,
        returnByValue: true,
        expression: `(() => {
  const shell=document.querySelector(".map-shell");
  const detail=document.querySelector(".detail");
  if (!shell || !detail) return { errors:["missing Inspector layout nodes"], documentScrollWidth:0, documentClientWidth:0, bodyScrollWidth:0, bodyClientWidth:0, overlapsDetail:true, shellClientWidth:0, shellScrollWidth:0 };
  const shellRect=shell.getBoundingClientRect();
  const detailRect=detail.getBoundingClientRect();
  const overlaps=!(shellRect.right<=detailRect.left||detailRect.right<=shellRect.left||shellRect.bottom<=detailRect.top||detailRect.bottom<=shellRect.top);
  return {
    bodyClientWidth:document.body.clientWidth,
    bodyScrollWidth:document.body.scrollWidth,
    documentClientWidth:document.documentElement.clientWidth,
    documentScrollWidth:document.documentElement.scrollWidth,
    errors:window.__okfyLayoutErrors ?? [],
    overlapsDetail:overlaps,
    shellClientWidth:shell.clientWidth,
    shellScrollWidth:shell.scrollWidth
  };
})()`
      });
      latest = response.result?.result?.value as LayoutResult;
      if (!latest.errors.includes("missing Inspector layout nodes")) return latest;
      await delay(100);
    }
    if (!latest) throw new Error("Chrome layout evaluation did not return a result.");
    return latest;
  } finally {
    ws.close();
  }
}

async function measureInspectorLayout(width: number, height: number): Promise<LayoutResult> {
  if (!chromeExecutable) throw new Error("Chrome executable unavailable.");
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-inspector-browser-"));
  tempDirs.push(dir);
  const htmlPath = path.join(dir, "inspector.html");
  const html = renderInspectorHtml(reportFixture()).replace(
    "<head>",
    `<head><script>
window.__okfyLayoutErrors=[];
window.addEventListener("error",event=>window.__okfyLayoutErrors.push(String(event.message||event.error||"error")));
window.addEventListener("unhandledrejection",event=>window.__okfyLayoutErrors.push(String(event.reason||"unhandled rejection")));
const __okfyConsoleError=console.error.bind(console);
console.error=(...args)=>{window.__okfyLayoutErrors.push(args.map(String).join(" "));__okfyConsoleError(...args);};
</script>`
  );
  await fs.writeFile(htmlPath, html, "utf8");

  const port = await getFreePort();
  const process = spawn(
    chromeExecutable,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-background-networking",
      "--disable-dev-shm-usage",
      "--allow-file-access-from-files",
      "--force-device-scale-factor=1",
      "--no-first-run",
      "--no-default-browser-check",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${path.join(dir, "chrome-profile")}`,
      `--window-size=${width},${height}`,
      pathToFileURL(htmlPath).href
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );

  try {
    const webSocketUrl = await waitForPageWebSocket(port, process);
    return await evaluateLayout(webSocketUrl);
  } finally {
    await closeChrome(process);
  }
}

describe("renderInspectorHtml", () => {
  it("renders the inspector shell, readiness labels, graph labels, and agent-preview tools", () => {
    const html = renderInspectorHtml(reportFixture());

    expect(html).toContain("OKFY Inspector");
    expect(html).toContain("Preview what your agent will know");
    expect(html).toContain("Validation status");
    expect(html).toContain("Concepts");
    expect(html).toContain("Warnings");
    expect(html).toContain("Broken links");
    expect(html).toContain("Orphan concepts");
    expect(html).toContain("Source freshness");
    expect(html).toContain("Quickstart");
    expect(html).toContain("API Reference");
    expect(html).toContain("bundle_summary");
    expect(html).toContain("search_concepts");
    expect(html).toContain("read_concept");
    expect(html).toContain("get_neighbors");
  });

  it("escapes markup-like concept titles, URLs, tags, descriptions, and errors", () => {
    const report: InspectorReport = {
      ...reportFixture(),
      readiness: {
        ...reportFixture().readiness,
        lastRefreshError: { message: "<script>alert('refresh')</script>" }
      },
      concepts: [
        {
          id: "evil",
          ref: "docs:evil",
          path: "evil.md",
          title: "<img src=x onerror=alert(1)>",
          type: "guide",
          tags: ["<svg/onload=alert(2)>"],
          description: 'Use <b>bold</b> and "quoted" text.',
          resourceUrl: "https://example.com/?q=<script>alert(3)</script>",
          sourceName: "docs",
          outbound: [],
          outboundLinks: [],
          backlinks: [],
          citation: {
            ref: "docs:evil",
            conceptPath: "evil.md",
            sourceResource: "https://example.com/?q=<script>alert(3)</script>",
            sourceName: "docs"
          }
        }
      ],
      edges: []
    };

    const html = renderInspectorHtml(report);

    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&lt;svg/onload=alert(2)&gt;");
    expect(html).toContain("Use &lt;b&gt;bold&lt;/b&gt; and &quot;quoted&quot; text.");
    expect(html).toContain("https://example.com/?q=&lt;script&gt;alert(3)&lt;/script&gt;");
    expect(html).toContain("&lt;script&gt;alert(&#39;refresh&#39;)&lt;/script&gt;");
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).not.toContain("<svg/onload=alert(2)>");
  });

  it("renders byte-identical HTML for the same report", () => {
    const report = reportFixture();

    expect(renderInspectorHtml(report)).toBe(renderInspectorHtml(report));
  });

  it("emits responsive containment styles for the generated knowledge map", () => {
    const html = renderInspectorHtml(reportFixture());

    expect(html).toContain('class="map-shell"');
    expect(html).toMatch(
      /\.workspace\{[^}]*grid-template-columns:minmax\(0,0\.95fr\) minmax\(0,1\.05fr\)/
    );
    expect(html).toMatch(/\.map-shell\{[^}]*max-width:100%;[^}]*overflow:auto/);
    expect(html).toContain(".node{position:absolute;min-width:0;width:clamp(132px,28vw,190px)");
    expect(html).toMatch(/\.map\{[^}]*position:relative;[^}]*min-width:100%/);
    expect(html).toContain("@media (max-width:820px)");
  });

  it.skipIf(!chromeExecutable)(
    "keeps generated Inspector layout contained in a real browser",
    async () => {
      for (const viewport of [
        { width: 1280, height: 900 },
        { width: 390, height: 900 }
      ]) {
        const layout = await measureInspectorLayout(viewport.width, viewport.height);

        expect(layout.errors).toEqual([]);
        expect(layout.documentScrollWidth).toBeLessThanOrEqual(layout.documentClientWidth + 1);
        expect(layout.bodyScrollWidth).toBeLessThanOrEqual(layout.bodyClientWidth + 1);
        expect(layout.overlapsDetail).toBe(false);
        expect(layout.shellScrollWidth).toBeGreaterThanOrEqual(layout.shellClientWidth);
      }
    },
    60_000
  );

  it("embeds parseable report JSON", () => {
    const html = renderInspectorHtml(reportFixture());
    const match = html.match(
      /<script id="okfy-inspector-report" type="application\/json">([\s\S]*?)<\/script>/
    );

    expect(match?.[1]).toBeDefined();
    const parsed = JSON.parse(match?.[1] ?? "{}") as InspectorReport;
    expect(parsed.concepts.map((concept) => concept.ref)).toEqual([
      "stripe:guides/quickstart",
      "stripe:reference/api"
    ]);
    expect(parsed.agentPreview.tools.map((tool) => tool.name)).toContain("bundle_summary");
  });
});
