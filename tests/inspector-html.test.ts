import { describe, expect, it } from "vitest";
import { renderInspectorHtml, type InspectorReport } from "../src/inspector-html.js";

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
          description: "Use <b>bold</b> and \"quoted\" text.",
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
