import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseMarkdown } from "../src/markdown-ast.js";
import {
  descriptionFromMarkdown,
  extractHeadings,
  extractMarkdownLinks,
  inferType,
  normalizeDocument
} from "../src/normalize.js";

const discoveredAt = "2026-06-14T00:00:00.000Z";
const fixtureDirectory = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "fixtures/obsidian-vault"
);

function fixture(name: string): string {
  return fs.readFileSync(path.join(fixtureDirectory, name), "utf8");
}

describe("normalization", () => {
  it("extracts main HTML content and removes chrome/noise", () => {
    const doc = normalizeDocument({
      sourceId: "https://docs.example.com/start",
      url: "https://docs.example.com/start",
      contentType: "html",
      discoveredAt,
      raw: `
        <html>
          <head><title>Fallback Title</title></head>
          <body>
            <nav>Global nav should disappear</nav>
            <main>
              <h1>Quickstart Guide</h1>
              <p>Install okfy with <a href="/install">installer docs</a>.</p>
              <script>alert("drop me")</script>
            </main>
          </body>
        </html>
      `
    });

    expect(doc.title).toBe("Quickstart Guide");
    expect(doc.type).toBe("Guide");
    expect(doc.markdown).toContain("# Quickstart Guide");
    expect(doc.markdown).toContain("[installer docs](/install)");
    expect(doc.markdown).not.toContain("Global nav");
    expect(doc.markdown).not.toContain("alert");
    expect(doc.links).toEqual([{ text: "installer docs", href: "/install" }]);
    expect(doc.tags).toContain("quickstart");
  });

  it("normalizes Markdown and text documents deterministically", () => {
    const markdown =
      "# API Reference\r\n\r\nUse `search_concepts`.\r\n\r\n## Tools\r\n[Quickstart](./quickstart.md)";
    const doc = normalizeDocument({
      sourceId: "reference/api.md",
      filePath: "reference/api.md",
      contentType: "markdown",
      discoveredAt,
      raw: markdown
    });

    expect(doc.markdown).not.toContain("\r\n");
    expect(doc.title).toBe("API Reference");
    expect(doc.type).toBe("API Reference");
    expect(doc.headings.map((heading) => heading.slug)).toEqual(["api-reference", "tools"]);
    expect(doc.links).toEqual([{ text: "Quickstart", href: "./quickstart.md" }]);

    const textDoc = normalizeDocument({
      sourceId: "notes.txt",
      filePath: "notes.txt",
      contentType: "text",
      discoveredAt,
      raw: "plain notes"
    });
    expect(textDoc.markdown).toBe("# Notes\n\n```text\nplain notes\n```");
  });

  it("supports standalone extraction helpers", () => {
    expect(extractHeadings("# One\n\n### Two").map((heading) => heading.depth)).toEqual([1, 3]);
    expect(extractMarkdownLinks('[A](./a.md "title") [B](https://example.com)')).toEqual([
      { text: "A", href: "./a.md" },
      { text: "B", href: "https://example.com" }
    ]);
    expect(inferType("Readme", "README.md", "")).toBe("README");
    expect(descriptionFromMarkdown("# Title\n\nUse [okfy](./okfy.md) for docs.")).toBe(
      "Use okfy for docs."
    );
  });

  it("uses Markdown structure for headings and ordinary links", () => {
    const markdown = [
      "# Repeat",
      "",
      "Repeat",
      "------",
      "",
      "[inline](./inline.md) and [reference][guide]",
      "",
      '[guide]: ./guide.md "Guide title"',
      "",
      "```md",
      "# Not a heading",
      "[not a link](./nope.md)",
      "```",
      "",
      "`[also not](./nope.md)`"
    ].join("\n");

    expect(extractHeadings(markdown)).toEqual([
      { depth: 1, text: "Repeat", slug: "repeat" },
      { depth: 2, text: "Repeat", slug: "repeat-1" }
    ]);
    expect(extractMarkdownLinks(markdown)).toEqual([
      { text: "inline", href: "./inline.md" },
      { text: "reference", href: "./guide.md" }
    ]);
  });

  it("models repeated reference links as uses of one shared destination range", () => {
    const markdown = [
      "# References",
      "",
      "Use [the first guide][shared] and [the second guide][shared].",
      "",
      '[shared]: ./guides/start.md "Start here"'
    ].join("\n");
    const parsed = parseMarkdown(markdown);
    const links = parsed.semanticLinks.filter((link) => link.kind === "markdown");

    expect(links.map((link) => [link.text, link.target])).toEqual([
      ["the first guide", "./guides/start.md"],
      ["the second guide", "./guides/start.md"]
    ]);
    expect(links[0]?.destinationRange).toEqual(links[1]?.destinationRange);
    expect(
      parsed.content.slice(links[0]!.destinationRange!.start, links[0]!.destinationRange!.end)
    ).toBe("./guides/start.md");

    const repeatedLabel = parseMarkdown("[./guides/start.md](./guides/start.md)").semanticLinks[0]!;
    expect(
      repeatedLabel.destinationRange &&
        "[./guides/start.md](./guides/start.md)".slice(
          repeatedLabel.destinationRange.start,
          repeatedLabel.destinationRange.end
        )
    ).toBe("./guides/start.md");
    expect(repeatedLabel.destinationRange?.start).toBeGreaterThan(
      "[./guides/start.md](./guides/start.md)".indexOf("](")
    );
  });

  it("extracts Obsidian properties and semantic tokens with byte-exact body ranges", () => {
    const raw = fixture("semantic-note.md");
    const parsed = parseMarkdown(raw);
    const doc = normalizeDocument({
      sourceId: "semantic-note.md",
      filePath: "semantic-note.md",
      contentType: "markdown",
      discoveredAt,
      raw
    });

    expect(doc.markdown.startsWith("# Repeat")).toBe(true);
    expect(doc.markdown).not.toContain("title: Canonical Setup");
    expect(doc.title).toBe("Canonical Setup");
    expect(doc.type).toBe("Runbook");
    expect(doc.aliases).toEqual(["Setup", "Install Guide"]);
    expect(doc.tags.slice(0, 3)).toEqual(["product", "agents", "deep/work"]);
    expect(doc.tags).not.toContain("123");
    expect(doc.properties?.description).toBe("Source description");
    expect(doc.properties?.data).toMatchObject({
      resource: "https://malicious.example/override",
      timestamp: new Date("1999-01-01T00:00:00.000Z"),
      nested: { owner: "docs", flags: ["stable", "reviewed"] }
    });
    expect(doc.resource).toBeUndefined();
    expect(doc.headings.map(({ depth, text, slug }) => ({ depth, text, slug }))).toEqual([
      { depth: 1, text: "Repeat", slug: "repeat" },
      { depth: 2, text: "Repeat", slug: "repeat-1" }
    ]);
    expect(doc.links).toEqual([
      { text: "inline", href: "./inline.md" },
      { text: "reference", href: "./guide.md" }
    ]);
    expect(doc.semanticLinks?.map((link) => [link.kind, link.target, link.text])).toEqual([
      ["markdown", "./inline.md", "inline"],
      ["markdown", "./guide.md", "reference"],
      ["wikilink", "Guides/Setup", "installation steps"],
      ["wikilink", "Blocks", "install-step"],
      ["note_embed", "Shared Context", "Overview"],
      ["attachment_embed", "diagram.png", "600"]
    ]);
    expect(doc.semanticLinks?.[2]).toMatchObject({ heading: "Install" });
    expect(doc.semanticLinks?.[3]).toMatchObject({ blockId: "install-step" });
    expect(doc.semanticLinks?.[4]).toMatchObject({ heading: "Overview" });
    expect(doc.blockIds).toEqual([
      {
        id: "install-step",
        raw: "^install-step",
        range: expect.objectContaining({ start: expect.any(Number), end: expect.any(Number) })
      }
    ]);

    expect(raw.slice(parsed.properties!.range.start, parsed.properties!.range.end)).toContain(
      "title: Canonical Setup"
    );
    for (const heading of parsed.headings) {
      expect(parsed.content.slice(heading.range.start, heading.range.end)).toContain(heading.text);
    }

    for (const semantic of [
      ...(doc.semanticLinks ?? []),
      ...(doc.blockIds ?? []),
      ...(doc.inlineTags ?? [])
    ]) {
      expect(doc.markdown.slice(semantic.range.start, semantic.range.end)).toBe(semantic.raw);
    }
  });

  it("keeps Markdown-like syntax inert in literal HTML and MDX expression nodes", () => {
    const doc = normalizeDocument({
      sourceId: "literal-regions.mdx",
      filePath: "literal-regions.mdx",
      contentType: "mdx",
      discoveredAt,
      raw: fixture("literal-regions.mdx")
    });

    expect(doc.headings.map((heading) => heading.text)).toEqual(["Visible"]);
    expect(doc.links).toEqual([{ text: "real", href: "./real.md" }]);
    expect(doc.semanticLinks?.map((link) => [link.kind, link.target])).toEqual([
      ["wikilink", "Real Note"],
      ["note_embed", "Real Embed"],
      ["markdown", "./real.md"]
    ]);
    expect(doc.inlineTags?.map((tag) => tag.tag)).toEqual(["real-tag"]);
  });

  it("normalizes BOM and CRLF before assigning stable semantic ranges", () => {
    const doc = normalizeDocument({
      sourceId: "windows.md",
      filePath: "windows.md",
      contentType: "markdown",
      discoveredAt,
      raw: "\uFEFF---\r\ntitle: Windows Note\r\naliases: Win\r\n---\r\nWindows\r\n=======\r\n\r\n[[Target]] #Win\r\n"
    });

    expect(doc.markdown).toBe("Windows\n=======\n\n[[Target]] #Win");
    expect(doc.title).toBe("Windows Note");
    expect(doc.aliases).toEqual(["Win"]);
    expect(doc.headings.map((heading) => heading.slug)).toEqual(["windows"]);
    expect(doc.semanticLinks?.[0]?.raw).toBe("[[Target]]");
    expect(doc.inlineTags?.[0]?.raw).toBe("#Win");
    expect(
      doc.markdown.slice(doc.semanticLinks![0].range.start, doc.semanticLinks![0].range.end)
    ).toBe("[[Target]]");
  });
});
