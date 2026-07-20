import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildGraph, extractInternalLinks } from "../src/graph.js";
import { normalizeDocument } from "../src/normalize.js";
import { readBundle } from "../src/reader.js";
import { validateBundle } from "../src/validate.js";
import { resolveVaultDocuments } from "../src/vault-index.js";
import { assertSafeForceOutDir, writeOkfBundle } from "../src/writer.js";
import type { Concept, NormalizedDocument, RawDocument } from "../src/types.js";

const fixtureRoot = path.resolve("test-fixtures");
const tempDirs: string[] = [];

async function tempOut(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function raw(
  partial: Omit<RawDocument, "discoveredAt" | "contentType" | "raw"> & { raw: string }
): RawDocument {
  return { ...partial, contentType: "markdown", discoveredAt: "2026-06-14T00:00:00.000Z" };
}

describe("writer and validator", () => {
  it("writes valid OKF bundles with index and rewritten internal source links", async () => {
    const outDir = await tempOut();
    const docs: NormalizedDocument[] = [
      normalizeDocument(
        raw({
          sourceId: "https://docs.example.com/guides/quickstart",
          url: "https://docs.example.com/guides/quickstart",
          raw: "# Quickstart\n\nSee [API](https://docs.example.com/reference/api?utm_source=noise#tools)."
        })
      ),
      normalizeDocument(
        raw({
          sourceId: "https://docs.example.com/reference/api",
          url: "https://docs.example.com/reference/api",
          raw: "# API Reference\n\nSearch concepts with MCP."
        })
      )
    ];

    const written = await writeOkfBundle(docs, {
      outDir,
      title: "Docs",
      timestamp: "2026-06-14T00:00:00.000Z"
    });

    expect(written).toEqual([
      "guides/index.md",
      "guides/quickstart.md",
      "index.md",
      "reference/api.md",
      "reference/index.md"
    ]);
    const quickstart = await fs.readFile(path.join(outDir, "guides/quickstart.md"), "utf8");
    expect(quickstart).toContain('title: "Quickstart"');
    expect(quickstart).toContain("[API](../reference/api.md).");
    const rootIndex = await fs.readFile(path.join(outDir, "index.md"), "utf8");
    const folderIndex = await fs.readFile(path.join(outDir, "guides/index.md"), "utf8");
    expect(rootIndex).not.toMatch(/^---/);
    expect(folderIndex).not.toMatch(/^---/);
    expect(rootIndex).toContain("* [Quickstart](guides/quickstart.md) - ");
    expect(folderIndex).toContain("* [Quickstart](quickstart.md) - ");

    const report = await validateBundle(outDir);
    expect(report.valid).toBe(true);
    expect(report.conceptCount).toBe(2);
    expect(report.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("does not write root or folder index source pages as concept documents", async () => {
    const outDir = await tempOut();
    const docs = [
      normalizeDocument(
        raw({
          sourceId: "https://docs.example.com/",
          url: "https://docs.example.com/",
          raw: "# Home\n\nWelcome to the docs."
        })
      ),
      normalizeDocument(
        raw({
          sourceId: "https://docs.example.com/guides/",
          url: "https://docs.example.com/guides/",
          raw: "# Guides\n\nUse the guide."
        })
      )
    ];

    const written = await writeOkfBundle(docs, {
      outDir,
      title: "Docs",
      timestamp: "2026-06-14T00:00:00.000Z"
    });

    expect(written).toEqual(["guides/index.md", "guides/overview.md", "home.md", "index.md"]);
    const concepts = await readBundle(outDir);
    expect(
      [...new Set([...concepts.values()].map((concept) => concept.id)).values()].sort()
    ).toEqual(["guides/overview", "home"]);
    const report = await validateBundle(outDir);
    expect(report).toMatchObject({ valid: true, conceptCount: 2 });
  });

  it("assigns colliding output paths deterministically by source key", async () => {
    const firstOutDir = await tempOut();
    const secondOutDir = await tempOut();
    const alpha = normalizeDocument(
      raw({
        sourceId: "https://docs.example.com/page?a=1",
        url: "https://docs.example.com/page?a=1",
        raw: "# Alpha\n\nAlpha query variant."
      })
    );
    const beta = normalizeDocument(
      raw({
        sourceId: "https://docs.example.com/page?b=2",
        url: "https://docs.example.com/page?b=2",
        raw: "# Beta\n\nBeta query variant."
      })
    );

    await writeOkfBundle([beta, alpha], {
      outDir: firstOutDir,
      title: "Docs",
      timestamp: "2026-06-14T00:00:00.000Z"
    });
    await writeOkfBundle([alpha, beta], {
      outDir: secondOutDir,
      title: "Docs",
      timestamp: "2026-06-14T00:00:00.000Z"
    });

    await expect(fs.readFile(path.join(firstOutDir, "page.md"), "utf8")).resolves.toContain(
      'title: "Alpha"'
    );
    await expect(fs.readFile(path.join(firstOutDir, "page-2.md"), "utf8")).resolves.toContain(
      'title: "Beta"'
    );
    await expect(fs.readFile(path.join(firstOutDir, "page.md"), "utf8")).resolves.toBe(
      await fs.readFile(path.join(secondOutDir, "page.md"), "utf8")
    );
    await expect(fs.readFile(path.join(firstOutDir, "page-2.md"), "utf8")).resolves.toBe(
      await fs.readFile(path.join(secondOutDir, "page-2.md"), "utf8")
    );
  });

  it("merges source properties into one canonical deterministic frontmatter block", async () => {
    const outDir = await tempOut();
    const doc = normalizeDocument(
      raw({
        sourceId: "notes/canonical.md",
        filePath: "notes/canonical.md",
        raw: [
          "---",
          "timestamp: 1999-01-01",
          "zeta: last",
          "resource: https://malicious.example/override",
          "description: Source-authored description",
          "aliases: [Canonical, Stable Note]",
          "tags: [Explicit, shared]",
          "title: Canonical Title",
          "type: Runbook",
          "alpha:",
          "  owner: docs",
          "  flags: [stable, reviewed]",
          "---",
          "",
          "# Inferred Title",
          "",
          "Untouched body with #Shared and #InlineTag."
        ].join("\n")
      })
    );

    await writeOkfBundle([doc], {
      outDir,
      timestamp: "2026-06-14T00:00:00.000Z"
    });

    const rendered = await fs.readFile(path.join(outDir, "notes/canonical.md"), "utf8");
    const concept = (await readBundle(outDir)).get("notes/canonical");
    const orderedKeys = [...rendered.matchAll(/^([a-z][a-z0-9_-]*):/gm)].map((match) => match[1]);

    expect(orderedKeys).toEqual([
      "type",
      "title",
      "description",
      "resource",
      "tags",
      "aliases",
      "timestamp",
      "alpha",
      "zeta"
    ]);
    expect(rendered.match(/^---$/gm)).toHaveLength(2);
    expect(rendered).not.toContain("https://malicious.example/override");
    expect(rendered).not.toContain("timestamp: 1999-01-01");
    expect(concept).toMatchObject({
      type: "Runbook",
      title: "Canonical Title",
      description: "Source-authored description",
      resource: "notes/canonical.md",
      aliases: ["Canonical", "Stable Note"],
      frontmatter: {
        alpha: { owner: "docs", flags: ["stable", "reviewed"] },
        zeta: "last"
      },
      body: "# Inferred Title\n\nUntouched body with #Shared and #InlineTag."
    });
    expect(concept?.tags.slice(0, 3)).toEqual(["explicit", "shared", "inlinetag"]);
  });

  it("renders resolved semantic links after reserved-name and collision-safe path assignment", async () => {
    const outDir = await tempOut();
    const documents = [
      normalizeDocument(
        raw({
          sourceId: "source.md",
          filePath: "source.md",
          raw: [
            "# Source",
            "",
            "Keep  two spaces, *emphasis*, and punctuation exactly.",
            "",
            "Use [[index#Install Guide|installation steps]], [[index#Missing Heading]], and [[log#^step]].",
            "Read [ordinary][shared] twice via [the same target][shared].",
            "Keep an inline label that matches its destination: [./index.md](./index.md).",
            "Embed ![[Context]] but keep ![[diagram.png|600]] readable.",
            "",
            '[shared]: ./index.md "Shared title"',
            "",
            "`[[index]]` and `[not an edge](./ghost.md)` stay literal."
          ].join("\n")
        })
      ),
      normalizeDocument(
        raw({
          sourceId: "home.md",
          filePath: "home.md",
          raw: "# Existing Home\n\nOccupies home.md."
        })
      ),
      normalizeDocument(
        raw({
          sourceId: "index.md",
          filePath: "index.md",
          raw: "# Index Target\n\n## Install Guide\n\nInstall here."
        })
      ),
      normalizeDocument(
        raw({
          sourceId: "change-log.md",
          filePath: "change-log.md",
          raw: "# Existing Change Log\n\nOccupies change-log.md."
        })
      ),
      normalizeDocument(
        raw({
          sourceId: "log.md",
          filePath: "log.md",
          raw: "# Log Target\n\nStable block. ^step"
        })
      ),
      normalizeDocument(
        raw({
          sourceId: "Context.md",
          filePath: "Context.md",
          raw: "# Context\n\nShared context only."
        })
      )
    ];
    resolveVaultDocuments(documents);

    await writeOkfBundle(documents, {
      outDir,
      timestamp: "2026-06-14T00:00:00.000Z"
    });

    const source = await fs.readFile(path.join(outDir, "source.md"), "utf8");
    expect(source).toContain("Keep  two spaces, *emphasis*, and punctuation exactly.");
    expect(source).toContain(
      "Use [installation steps](./home-2.md#install-guide), [Missing Heading](./home-2.md#missing-heading), and [step](./change-log-2.md#step)."
    );
    expect(source).toContain("Read [ordinary][shared] twice via [the same target][shared].");
    expect(source).toContain('[shared]: ./home-2.md "Shared title"');
    expect(source).toContain(
      "Keep an inline label that matches its destination: [./index.md](./home-2.md)."
    );
    expect(source).toContain(
      "Embed [Context](./context.md) but keep ![[diagram.png|600]] readable."
    );
    expect(source).toContain("`[[index]]` and `[not an edge](./ghost.md)` stay literal.");
    await expect(fs.readFile(path.join(outDir, "change-log-2.md"), "utf8")).resolves.toContain(
      'Stable block. <a id="step"></a>'
    );

    const concepts = await readBundle(outDir);
    const graph = buildGraph(concepts);
    expect(graph.outbound.get("source")).toEqual(["change-log-2", "context", "home-2"]);
    expect(graph.backlinks.get("context")).toEqual(["source"]);
    expect(graph.backlinks.get("home-2")).toEqual(["source"]);
    expect(graph.outbound.get("source")).not.toContain("ghost");
  });

  it("keeps links inside MDX expressions out of graph edges", () => {
    const concept: Concept = {
      id: "source",
      path: "source.md",
      frontmatter: {},
      type: "Concept",
      resource: "notes/source.mdx",
      tags: [],
      body: '{"[expression](./ghost.md)"}\n\n[real](./target.md)'
    };

    expect(extractInternalLinks(concept)).toEqual(["target"]);
  });

  it.skipIf(process.platform === "win32")(
    "rejects force output paths with symlink ancestors under cwd",
    async () => {
      const root = await tempOut();
      const outside = await tempOut();
      await fs.mkdir(path.join(root, "docs"));
      await fs.symlink(outside, path.join(root, "linked-output"), "dir");
      const previousCwd = process.cwd();

      try {
        process.chdir(root);
        await expect(
          assertSafeForceOutDir("linked-output/missing/bundle", {
            outDir: "linked-output/missing/bundle",
            force: true,
            inputPath: "docs"
          })
        ).rejects.toThrow(/symlink ancestor/);
      } finally {
        process.chdir(previousCwd);
      }

      await expect(fs.access(path.join(outside, "missing"))).rejects.toMatchObject({
        code: "ENOENT"
      });
    }
  );

  it("rejects force output paths that contain the current working directory", async () => {
    const root = await tempOut();
    const project = path.join(root, "project");
    await fs.mkdir(path.join(project, "docs"), { recursive: true });
    const previousCwd = process.cwd();

    try {
      process.chdir(project);
      await expect(
        assertSafeForceOutDir("..", {
          outDir: "..",
          force: true,
          inputPath: "docs"
        })
      ).rejects.toThrow(/ancestor of current working directory/);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it("rejects force output paths that contain an input path through higher ancestors", async () => {
    const root = await tempOut();
    const inputPath = path.join(root, "project", "docs");
    await fs.mkdir(inputPath, { recursive: true });

    await expect(
      assertSafeForceOutDir(root, {
        outDir: root,
        force: true,
        inputPath
      })
    ).rejects.toThrow(/ancestor of input path/);
  });

  it("rejects force output paths that contain OKFY_HOME", async () => {
    const root = await tempOut();
    const okfyHome = path.join(root, "okfy-home");
    await fs.mkdir(okfyHome, { recursive: true });
    const previousOkfyHome = process.env.OKFY_HOME;
    process.env.OKFY_HOME = okfyHome;

    try {
      await expect(
        assertSafeForceOutDir(root, {
          outDir: root,
          force: true
        })
      ).rejects.toThrow(/ancestor of OKFY_HOME/);
    } finally {
      if (previousOkfyHome === undefined) {
        delete process.env.OKFY_HOME;
      } else {
        process.env.OKFY_HOME = previousOkfyHome;
      }
    }
  });

  it("reports only Google OKF conformance errors for malformed concept docs", async () => {
    const report = await validateBundle(path.join(fixtureRoot, "okf-invalid"));

    expect(report.valid).toBe(false);
    expect(
      report.issues
        .filter((issue) => issue.severity === "error")
        .map((issue) => issue.code)
        .sort()
    ).toEqual(["malformed_frontmatter", "missing_frontmatter", "missing_type"]);
  });

  it("validates committed Google-style fixture bundle without counting reserved files as concepts", async () => {
    const report = await validateBundle(path.join(fixtureRoot, "okf-valid"));

    expect(report.valid).toBe(true);
    expect(report.conceptCount).toBe(2);
    expect(report.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("keeps broken internal links as warnings and preserves bundle validity", async () => {
    const report = await validateBundle(path.join(fixtureRoot, "okf-broken-link-valid"));

    expect(report.valid).toBe(true);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: "warning",
          code: "broken_internal_link",
          path: "tables/orders.md"
        })
      ])
    );
  });

  it("reproduces deterministic Obsidian semantic warnings from a generated bundle", async () => {
    const outDir = await tempOut();
    const documents = [
      normalizeDocument({
        ...raw({
          sourceId: "notes/source.mdx",
          filePath: "notes/source.mdx",
          raw: [
            "# Source",
            "",
            "[[Missing <script>]] [[Setup]] [[index#Home]] [[index#^step]] [[index#Absent Heading]]",
            "",
            "`[[Code Only]]`",
            "",
            "<span>[[HTML Only]]</span>",
            "",
            "![[diagram.png|600]]"
          ].join("\n")
        }),
        contentType: "mdx"
      }),
      normalizeDocument(
        raw({ sourceId: "one/Setup.md", filePath: "one/Setup.md", raw: "# Setup One" })
      ),
      normalizeDocument(
        raw({ sourceId: "two/Setup.md", filePath: "two/Setup.md", raw: "# Setup Two" })
      ),
      normalizeDocument(
        raw({
          sourceId: "index.md",
          filePath: "index.md",
          raw: "# Home\n\nStable block. ^step"
        })
      )
    ];
    resolveVaultDocuments(documents);
    await writeOkfBundle(documents, {
      outDir,
      timestamp: "2026-06-14T00:00:00.000Z"
    });

    const report = await validateBundle(outDir);
    const semanticIssues = report.issues.filter((item) => item.code.includes("wikilink"));

    expect(report.valid).toBe(true);
    expect(semanticIssues).toEqual([
      {
        severity: "warning",
        code: "missing_wikilink_fragment",
        message:
          'Missing fragment in Obsidian reference "../home.md#absent-heading" from notes/source.mdx to index.md.',
        path: "notes/source.mdx",
        rawTarget: "../home.md#absent-heading",
        candidates: ["index.md"]
      },
      {
        severity: "warning",
        code: "unresolved_wikilink",
        message: 'Unresolved Obsidian reference "Missing <script>" in notes/source.mdx.',
        path: "notes/source.mdx",
        rawTarget: "Missing <script>"
      },
      {
        severity: "warning",
        code: "ambiguous_wikilink",
        message:
          'Ambiguous Obsidian reference "Setup" in notes/source.mdx: one/Setup.md, two/Setup.md.',
        path: "notes/source.mdx",
        rawTarget: "Setup",
        candidates: ["one/Setup.md", "two/Setup.md"]
      }
    ]);
    expect(report.warningCount).toBe(3);
    expect(report.issues.filter((item) => item.code === "broken_internal_link")).toEqual([]);
  });

  it("does not accept block anchors written inside code literals", async () => {
    const outDir = await tempOut();
    const documents = [
      normalizeDocument(
        raw({
          sourceId: "source.md",
          filePath: "source.md",
          raw: "# Source\n\n[[target#^code-only]]"
        })
      ),
      normalizeDocument(
        raw({
          sourceId: "target.md",
          filePath: "target.md",
          raw: '# Target\n\n`<a id="code-only"></a>`'
        })
      )
    ];
    resolveVaultDocuments(documents);
    await writeOkfBundle(documents, {
      outDir,
      timestamp: "2026-06-14T00:00:00.000Z"
    });

    const report = await validateBundle(outDir);
    expect(report.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "missing_wikilink_fragment",
          rawTarget: "./target.md#code-only"
        })
      ])
    );
  });

  it("resolves absolute bundle-relative links from bundle root", async () => {
    const bundle = await readBundle(path.join(fixtureRoot, "okf-absolute-link-valid"));
    const graph = buildGraph(bundle);

    expect(graph.outbound.get("tables/orders")).toEqual(["tables/customers"]);
    expect(graph.backlinks.get("tables/customers")).toEqual(["tables/orders"]);
    const report = await validateBundle(path.join(fixtureRoot, "okf-absolute-link-valid"));
    expect(report).toMatchObject({ valid: true, conceptCount: 2 });
  });

  it("allows root index.md to declare only okf_version frontmatter", async () => {
    const report = await validateBundle(path.join(fixtureRoot, "okf-root-version-valid"));

    expect(report).toMatchObject({ valid: true, conceptCount: 1 });
    expect(report.issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("accepts UTF-8 BOM before YAML frontmatter", async () => {
    const outDir = await tempOut();
    await fs.mkdir(path.join(outDir, "guides"), { recursive: true });
    await fs.writeFile(
      path.join(outDir, "index.md"),
      '\uFEFF---\nokf_version: "0.1"\n---\n# Docs\n\n* [Start](guides/start.md)\n',
      "utf8"
    );
    await fs.writeFile(path.join(outDir, "guides/index.md"), "# Guides\n", "utf8");
    await fs.writeFile(
      path.join(outDir, "guides/start.md"),
      '\uFEFF---\ntype: "guide"\ntitle: "Start"\ndescription: "Start here."\nresource: "https://docs.example.com/start"\ntags:\n  - "setup"\ntimestamp: "2026-06-14T00:00:00.000Z"\n---\n\n# Start\n\nFollow the setup guide.\n',
      "utf8"
    );

    const report = await validateBundle(outDir);
    const bundle = await readBundle(outDir);
    const concept = bundle.get("guides/start");

    expect(report).toMatchObject({ valid: true, conceptCount: 1 });
    expect(report.issues.filter((issue) => issue.severity === "error")).toEqual([]);
    expect(concept).toMatchObject({
      type: "guide",
      title: "Start",
      tags: ["setup"],
      body: "# Start\n\nFollow the setup guide."
    });
  });

  it("treats empty YAML frontmatter as parseable metadata", async () => {
    const outDir = await tempOut();
    await fs.mkdir(path.join(outDir, "guides"), { recursive: true });
    await fs.writeFile(path.join(outDir, "index.md"), "# Docs\n", "utf8");
    await fs.writeFile(path.join(outDir, "guides/index.md"), "# Guides\n", "utf8");
    await fs.writeFile(
      path.join(outDir, "guides/empty.md"),
      "---\n---\n# Empty\n\nBody without typed metadata.\n",
      "utf8"
    );

    const report = await validateBundle(outDir);
    const concept = (await readBundle(outDir)).get("guides/empty");

    expect(report.valid).toBe(false);
    expect(report.issues.map((issue) => issue.code)).toContain("missing_type");
    expect(report.issues.map((issue) => issue.code)).not.toContain("malformed_frontmatter");
    expect(concept).toMatchObject({
      frontmatter: {},
      type: "",
      body: "# Empty\n\nBody without typed metadata."
    });
  });
});
