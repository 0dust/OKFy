import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { crawlWebsite } from "../src/crawler.js";
import { runImportCommand } from "../src/cli-content-actions.js";
import { importLocal } from "../src/importer.js";
import { matchesPattern } from "../src/util/match.js";
import { validateBundle } from "../src/validate.js";
import { resolveVaultDocuments } from "../src/vault-index.js";
import type { NormalizedDocument, SemanticLink } from "../src/types.js";

const tempDirs: string[] = [];

async function tempOut(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-import-crawl-"));
  tempDirs.push(dir);
  return dir;
}

async function writeVault(root: string, files: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(files)) {
    const absolute = path.join(root, relativePath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, content, "utf8");
  }
}

async function readTree(root: string): Promise<Array<[string, string]>> {
  const result: Array<[string, string]> = [];
  async function walk(directory: string): Promise<void> {
    for (const entry of (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) =>
      a.name.localeCompare(b.name)
    )) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else
        result.push([
          path.relative(root, absolute).split(path.sep).join("/"),
          await fs.readFile(absolute, "utf8")
        ]);
    }
  }
  await walk(root);
  return result;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("pattern matching", () => {
  it("treats normal input as glob and only parses explicit regex safely", () => {
    expect(matchesPattern("guides/start.md", "**/*.md")).toBe(true);
    expect(matchesPattern("guides/start.md", "/guides\\/.*\\.md/")).toBe(true);
    expect(matchesPattern("guides/start.md", "/[/")).toBe(false);
    expect(matchesPattern("guides/start.md", "[")).toBe(false);
  });
});

describe("importLocal filters", () => {
  it("accepts common glob includes and invalid excludes without regex crashes", async () => {
    const outDir = await tempOut();
    const result = await importLocal({
      inputPath: "examples/local-markdown",
      outDir,
      include: ["**/*.md"],
      exclude: ["["],
      force: true,
      timestamp: "2026-06-14T00:00:00.000Z"
    });

    expect(result.written).toContain("index.md");
    expect(result.written.length).toBeGreaterThan(1);
  });

  it("refuses unsafe force output directories before deleting anything", async () => {
    const root = await tempOut();
    const input = path.join(root, "docs");
    await fs.mkdir(input);
    await fs.writeFile(path.join(input, "guide.md"), "# Guide\n\nHello.", "utf8");

    await expect(
      importLocal({
        inputPath: input,
        outDir: root,
        force: true,
        timestamp: "2026-06-14T00:00:00.000Z"
      })
    ).rejects.toThrow(/unsafe output directory/i);
    await expect(fs.readFile(path.join(input, "guide.md"), "utf8")).resolves.toContain("Hello.");
  });

  it("fails the import when one document has malformed YAML frontmatter", async () => {
    const root = await tempOut();
    const input = path.join(root, "vault");
    await writeVault(input, {
      "good.md": "# Good",
      "malformed.md": "---\ntitle: [unterminated\n---\n# Recovered"
    });

    await expect(
      importLocal({
        inputPath: input,
        outDir: path.join(root, "bundle"),
        force: true,
        timestamp: "2026-06-14T00:00:00.000Z"
      })
    ).rejects.toThrow();
  });

  it("fails the import before writing when a frontmatter opener is unterminated", async () => {
    const root = await tempOut();
    const input = path.join(root, "vault");
    const outDir = path.join(root, "bundle");
    await writeVault(input, {
      "good.md": "# Good",
      "unterminated.md": "---\ntitle: Unterminated\n# Body"
    });

    await expect(
      importLocal({
        inputPath: input,
        outDir,
        force: true,
        timestamp: "2026-06-14T00:00:00.000Z"
      })
    ).rejects.toThrow("Malformed YAML frontmatter.");
    await expect(fs.stat(outDir)).rejects.toMatchObject({ code: "ENOENT" });
  });
});

describe("importLocal Obsidian resolution", () => {
  it("preserves frontmatter diagnostics when vault resolution adds semantic diagnostics", async () => {
    const root = await tempOut();
    const input = path.join(root, "vault");
    const outDir = path.join(root, "bundle");
    await writeVault(input, {
      "source.md": [
        "---",
        "title: 17",
        "tags: [valid, false]",
        "---",
        "# Source Guide",
        "",
        "[[z-missing]] #fallback"
      ].join("\n")
    });

    const result = await importLocal({
      inputPath: input,
      outDir,
      force: true,
      timestamp: "2026-06-14T00:00:00.000Z"
    });
    const source = result.documents[0]!;

    expect(source.title).toBe("Source Guide");
    expect(source.tags).toEqual(expect.arrayContaining(["fallback", "source"]));
    expect(
      result.diagnostics.map(({ code, rawTarget, sourcePath }) => ({
        code,
        rawTarget,
        sourcePath
      }))
    ).toEqual([
      {
        code: "invalid_frontmatter_property",
        rawTarget: "tags",
        sourcePath: "source.md"
      },
      {
        code: "invalid_frontmatter_property",
        rawTarget: "title",
        sourcePath: "source.md"
      },
      { code: "unresolved_wikilink", rawTarget: "z-missing", sourcePath: "source.md" }
    ]);
    expect(source.diagnostics).toEqual(result.diagnostics);
  });

  it("resolves a unique wikilink basename after reading the full vault", async () => {
    const root = await tempOut();
    const input = path.join(root, "vault");
    const outDir = path.join(root, "bundle");
    await fs.mkdir(path.join(input, "guides"), { recursive: true });
    await fs.writeFile(path.join(input, "home.md"), "# Home\n\nSee [[Setup]].", "utf8");
    await fs.writeFile(path.join(input, "guides", "Setup.md"), "# Setup", "utf8");

    const result = await importLocal({
      inputPath: input,
      outDir,
      force: true,
      timestamp: "2026-06-14T00:00:00.000Z"
    });

    const home = result.documents.find((document) => document.sourcePath === "home.md");
    expect(home?.semanticLinks?.[0]).toMatchObject({
      resolution: "resolved",
      resolvedSourceKey: "guides/Setup.md"
    });
    expect(result.diagnostics).toEqual([]);
  });

  it("does not resolve a qualified wikilink through an unrelated basename", async () => {
    const root = await tempOut();
    const input = path.join(root, "vault");
    const outDir = path.join(root, "bundle");
    await writeVault(input, {
      "home.md": "# Home\n\nSee [[missing/folder/Setup]] and [[missing/folder/setup]].",
      "guides/Setup.md": "# Setup"
    });

    const result = await importLocal({
      inputPath: input,
      outDir,
      force: true,
      timestamp: "2026-06-14T00:00:00.000Z"
    });
    const home = result.documents.find((document) => document.sourcePath === "home.md");

    expect(
      home?.semanticLinks?.map((link) => [link.target, link.resolution, link.resolvedSourceKey])
    ).toEqual([
      ["missing/folder/Setup", "unresolved", undefined],
      ["missing/folder/setup", "unresolved", undefined]
    ]);
    expect(result.diagnostics.map(({ code, rawTarget }) => ({ code, rawTarget }))).toEqual([
      { code: "unresolved_wikilink", rawTarget: "missing/folder/Setup" },
      { code: "unresolved_wikilink", rawTarget: "missing/folder/setup" }
    ]);
  });

  it("prefers explicit Markdown extensions before extensionless path matches", async () => {
    const root = await tempOut();
    const input = path.join(root, "vault");
    const outDir = path.join(root, "bundle");
    await writeVault(input, {
      "notes/source.md": [
        "# Source",
        "",
        "[[Local.md]] [[Local.mdx]] [[Local]]",
        "[[root/Root.md]] [[root/Root.mdx]] [[root/Root]]"
      ].join("\n"),
      "notes/Local.md": "# Local Markdown",
      "notes/Local.mdx": "# Local MDX",
      "root/Root.md": "# Root Markdown",
      "root/Root.mdx": "# Root MDX"
    });

    const result = await importLocal({
      inputPath: input,
      outDir,
      force: true,
      timestamp: "2026-06-14T00:00:00.000Z"
    });
    const source = result.documents.find((document) => document.sourcePath === "notes/source.md");

    expect(
      source?.semanticLinks?.map((link) => [link.target, link.resolution, link.resolvedSourceKey])
    ).toEqual([
      ["Local.md", "resolved", "notes/Local.md"],
      ["Local.mdx", "resolved", "notes/Local.mdx"],
      ["Local", "ambiguous", undefined],
      ["root/Root.md", "resolved", "root/Root.md"],
      ["root/Root.mdx", "resolved", "root/Root.mdx"],
      ["root/Root", "ambiguous", undefined]
    ]);
    expect(
      result.diagnostics.map(({ code, rawTarget, candidates }) => ({ code, rawTarget, candidates }))
    ).toEqual([
      {
        code: "ambiguous_wikilink",
        rawTarget: "Local",
        candidates: ["notes/Local.md", "notes/Local.mdx"]
      },
      {
        code: "ambiguous_wikilink",
        rawTarget: "root/Root",
        candidates: ["root/Root.md", "root/Root.mdx"]
      }
    ]);
  });

  it("uses path, title, alias, Unicode, and case-folded identity in conservative precedence order", async () => {
    const root = await tempOut();
    const input = path.join(root, "vault");
    const outDir = path.join(root, "bundle");
    await writeVault(input, {
      "topics/source.md": [
        "# Source",
        "",
        "[[Local]] [[../root/./Root.md]] [[root\\Root]] [[deep/nested/Guide]]",
        "[[Product Manual]] [[Shortcut]] [[mixed case]] [[Café]]",
        "![[Extensionless]]"
      ].join("\n"),
      "topics/Local.md": "# Nearby Local",
      "other/Local.md": "# Other Local",
      "root/Root.md": "# Root",
      "archive/deep/nested/Guide.mdx": "# Nested Guide",
      "named.md": "---\ntitle: Product Manual\naliases: [Shortcut]\n---\n# Named",
      "Mixed Case.md": "# Case Target",
      "Cafe\u0301.md": "# Unicode Target",
      "Extensionless.md": "# Extensionless"
    });

    const result = await importLocal({
      inputPath: input,
      outDir,
      force: true,
      timestamp: "2026-06-14T00:00:00.000Z"
    });
    const source = result.documents.find((document) => document.sourcePath === "topics/source.md");

    expect(
      source?.semanticLinks?.map((link) => [link.target, link.resolution, link.resolvedSourceKey])
    ).toEqual([
      ["Local", "resolved", "topics/Local.md"],
      ["../root/./Root.md", "resolved", "root/Root.md"],
      ["root\\Root", "resolved", "root/Root.md"],
      ["deep/nested/Guide", "resolved", "archive/deep/nested/Guide.mdx"],
      ["Product Manual", "resolved", "named.md"],
      ["Shortcut", "resolved", "named.md"],
      ["mixed case", "resolved", "Mixed Case.md"],
      ["Café", "resolved", "Café.md"],
      ["Extensionless", "resolved", "Extensionless.md"]
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it("reports stable ambiguity and missing-fragment diagnostics while ignoring attachments", async () => {
    const root = await tempOut();
    const input = path.join(root, "vault");
    const outDir = path.join(root, "bundle");
    await writeVault(input, {
      "source.md": [
        "# Source",
        "",
        "[[Duplicate]] [[Shared Alias]] [[Missing Note]]",
        "[[Fragments#Present]] [[Fragments#Missing]]",
        "[[Fragments#^block-ok]] [[Fragments#^block-missing]]",
        "![[diagram.png|600]]"
      ].join("\n"),
      "one/Duplicate.md": "# First",
      "two/Duplicate.mdx": "# Second",
      "one/alias.md": "---\naliases: [Shared Alias]\n---\n# Alias One",
      "two/alias.md": "---\naliases: [Shared Alias]\n---\n# Alias Two",
      "Fragments.md": "# Present\n\nA block. ^block-ok"
    });

    const result = await importLocal({
      inputPath: input,
      outDir,
      force: true,
      timestamp: "2026-06-14T00:00:00.000Z"
    });
    const source = result.documents.find((document) => document.sourcePath === "source.md");
    const attachment = source?.semanticLinks?.find((link) => link.kind === "attachment_embed");

    expect(attachment).toMatchObject({ target: "diagram.png" });
    expect(attachment?.resolution).toBeUndefined();
    expect(
      result.diagnostics.map(({ code, rawTarget, candidates }) => ({ code, rawTarget, candidates }))
    ).toEqual([
      {
        code: "ambiguous_wikilink",
        rawTarget: "Duplicate",
        candidates: ["one/Duplicate.md", "two/Duplicate.mdx"]
      },
      {
        code: "missing_wikilink_fragment",
        rawTarget: "Fragments#Missing",
        candidates: ["Fragments.md"]
      },
      {
        code: "missing_wikilink_fragment",
        rawTarget: "Fragments#^block-missing",
        candidates: ["Fragments.md"]
      },
      { code: "unresolved_wikilink", rawTarget: "Missing Note", candidates: undefined },
      {
        code: "ambiguous_wikilink",
        rawTarget: "Shared Alias",
        candidates: ["one/alias.md", "two/alias.md"]
      }
    ]);
    expect(source?.semanticLinks?.filter((link) => link.target === "Fragments")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          heading: "Present",
          resolution: "resolved",
          resolvedSourceKey: "Fragments.md"
        }),
        expect.objectContaining({
          blockId: "block-ok",
          resolution: "resolved",
          resolvedSourceKey: "Fragments.md"
        })
      ])
    );
  });

  it("builds the index only from filtered files and preserves single-file imports", async () => {
    const root = await tempOut();
    const input = path.join(root, "vault");
    await writeVault(input, {
      "source.md": "# Source\n\n[[Included]] [[Excluded]]",
      "included/Included.md": "# Included",
      "excluded/Excluded.md": "# Excluded"
    });

    const filtered = await importLocal({
      inputPath: input,
      outDir: path.join(root, "filtered-bundle"),
      include: ["source.md", "included/**"],
      exclude: ["excluded/**"],
      force: true,
      timestamp: "2026-06-14T00:00:00.000Z"
    });
    expect(filtered.documents.map((document) => document.sourcePath)).toEqual([
      "included/Included.md",
      "source.md"
    ]);
    expect(filtered.diagnostics.map((diagnostic) => diagnostic.rawTarget)).toEqual(["Excluded"]);

    const soloPath = path.join(root, "Solo.md");
    await fs.writeFile(soloPath, "# Solo\n\n[[Solo]]", "utf8");
    const solo = await importLocal({
      inputPath: soloPath,
      outDir: path.join(root, "solo-bundle"),
      force: true,
      timestamp: "2026-06-14T00:00:00.000Z"
    });
    expect(solo.documents).toHaveLength(1);
    expect(solo.documents[0]).toMatchObject({ sourceId: "Solo.md", sourcePath: "Solo.md" });
    expect(solo.documents[0]?.semanticLinks?.[0]).toMatchObject({
      resolution: "resolved",
      resolvedSourceKey: "Solo.md"
    });
  });

  it("produces identical documents, diagnostics, and output trees for reversed source creation order", async () => {
    const root = await tempOut();
    const files = {
      "z/source.md": "# Source\n\n[[Target]] [[Missing]]",
      "a/Target.md": "# Target",
      "m/other.md": "# Other"
    };
    const firstInput = path.join(root, "first");
    const secondInput = path.join(root, "second");
    await writeVault(firstInput, files);
    await writeVault(secondInput, Object.fromEntries(Object.entries(files).reverse()));

    const first = await importLocal({
      inputPath: firstInput,
      outDir: path.join(root, "first-bundle"),
      sourceName: "Stable Vault",
      force: true,
      timestamp: "2026-06-14T00:00:00.000Z"
    });
    const second = await importLocal({
      inputPath: secondInput,
      outDir: path.join(root, "second-bundle"),
      sourceName: "Stable Vault",
      force: true,
      timestamp: "2026-06-14T00:00:00.000Z"
    });

    expect(second.documents).toEqual(first.documents);
    expect(second.diagnostics).toEqual(first.diagnostics);
    expect(await readTree(path.join(root, "second-bundle"))).toEqual(
      await readTree(path.join(root, "first-bundle"))
    );
  });

  it("resolves links in a large vault without per-link full-vault scans", () => {
    const targetCount = 6_000;
    const document = (sourcePath: string, semanticLinks?: SemanticLink[]): NormalizedDocument => ({
      sourceId: sourcePath,
      sourcePath,
      title: path.posix.basename(sourcePath, path.posix.extname(sourcePath)),
      markdown: "",
      headings: [],
      links: [],
      tags: [],
      type: "Concept",
      ...(semanticLinks ? { semanticLinks } : {})
    });
    const links = Array.from({ length: targetCount }, (_, index): SemanticLink => {
      const target = `notes/Target-${index}`;
      return {
        kind: "wikilink",
        raw: `[[${target}]]`,
        target,
        text: target,
        range: { start: index, end: index + 1 }
      };
    });
    const documents = [
      document("source.md", links),
      ...Array.from({ length: targetCount }, (_, index) => document(`notes/Target-${index}.md`))
    ];

    expect(resolveVaultDocuments(documents)).toEqual([]);
    expect(links.every((link) => link.resolution === "resolved")).toBe(true);
  }, 2_000);

  it("prints one deterministic warning summary without failing the import command", async () => {
    const root = await tempOut();
    const input = path.join(root, "vault");
    await writeVault(input, {
      "source.md": "# Source\n\n[[Z Missing]] [[A Missing]] [[Duplicate]]",
      "one/Duplicate.md": "# One",
      "two/Duplicate.md": "# Two"
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await runImportCommand(input, {
      out: path.join(root, "bundle"),
      force: true,
      stableTimestamps: true
    });

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "Warnings: 3 (ambiguous_wikilink: 1, unresolved_wikilink: 2)"
    );
    expect(log).toHaveBeenCalledWith("okfy import");
    expect(process.exitCode).not.toBe(1);
  });
});

describe("crawl dry run", () => {
  it("sends the package version in the crawler user-agent", async () => {
    const packageJson = JSON.parse(await fs.readFile("package.json", "utf8")) as {
      version: string;
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("<main><h1>Home</h1></main>", {
        status: 200,
        headers: { "content-type": "text/html" }
      })
    );
    const outDir = await tempOut();

    await crawlWebsite({
      seedUrl: "http://127.0.0.1:3000/",
      outDir,
      maxPages: 1,
      dryRun: true,
      allowPrivateNetwork: true,
      respectRobots: false
    });

    expect(fetchSpy).toHaveBeenCalledWith(
      "http://127.0.0.1:3000/",
      expect.objectContaining({
        headers: expect.objectContaining({
          "user-agent": `okfy/${packageJson.version} (+https://github.com/0dust/OKFy)`
        })
      })
    );
  });

  it("discovers linked pages without writing output", async () => {
    const server = http.createServer((request, response) => {
      response.setHeader("content-type", "text/html");
      if (request.url === "/") {
        response.end("<main><h1>Home</h1><a href='/a'>A</a><a href='/b'>B</a></main>");
      } else if (request.url === "/a") {
        response.end("<main><h1>A</h1><a href='/b'>B</a></main>");
      } else {
        response.end("<main><h1>B</h1></main>");
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP test server.");
    const outDir = await tempOut();

    try {
      const progress: string[] = [];
      const result = await crawlWebsite({
        seedUrl: `http://127.0.0.1:${address.port}/`,
        outDir,
        maxPages: 3,
        maxDepth: 2,
        dryRun: true,
        allowPrivateNetwork: true,
        respectRobots: false,
        onProgress: (event) => progress.push(event.type)
      });

      expect(result.dryRunPages).toEqual([
        `http://127.0.0.1:${address.port}/`,
        `http://127.0.0.1:${address.port}/a`,
        `http://127.0.0.1:${address.port}/b`
      ]);
      expect(progress).toContain("start");
      expect(progress).toContain("fetch");
      expect(progress).toContain("fetched");
      await expect(fs.readdir(outDir)).resolves.toEqual([]);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("writes crawled docs into a nested output directory when parents do not exist", async () => {
    const server = http.createServer((_, response) => {
      response.setHeader("content-type", "text/html");
      response.end("<main><h1>Home</h1><p>Welcome to the local docs.</p></main>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Expected TCP test server.");
    const root = await tempOut();
    const outDir = path.join(root, "missing-parent", "crawl-okf");

    try {
      const result = await crawlWebsite({
        seedUrl: `http://127.0.0.1:${address.port}/`,
        outDir,
        maxPages: 1,
        maxDepth: 0,
        allowPrivateNetwork: true,
        respectRobots: false,
        force: true,
        timestamp: "2026-06-14T00:00:00.000Z"
      });

      expect(result.documents).toHaveLength(1);
      await expect(fs.access(path.join(outDir, "index.md"))).resolves.toBeUndefined();
      const validation = await validateBundle(outDir);
      expect(validation.valid).toBe(true);
      expect(validation.conceptCount).toBe(1);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("rejects redirects to private network targets before following them", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", {
        status: 302,
        headers: { location: "http://127.0.0.1/private" }
      })
    );
    const outDir = await tempOut();

    await expect(
      crawlWebsite({
        seedUrl: "http://93.184.216.34/",
        outDir,
        maxPages: 1,
        respectRobots: false,
        force: true
      })
    ).rejects.toThrow(/private network crawl target rejected/i);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rejects redirects to IPv4-mapped loopback targets before following them", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", {
        status: 302,
        headers: { location: "http://[::ffff:127.0.0.1]/private" }
      })
    );
    const outDir = await tempOut();

    await expect(
      crawlWebsite({
        seedUrl: "http://93.184.216.34/",
        outDir,
        maxPages: 1,
        respectRobots: false,
        force: true
      })
    ).rejects.toThrow(/private network crawl target rejected/i);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
