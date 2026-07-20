import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildGraph, extractInternalLinks } from "../src/graph.js";
import { parseMarkdown } from "../src/markdown-ast.js";
import { normalizeDocument } from "../src/normalize.js";
import { readBundle } from "../src/reader.js";
import { resolveVaultDocuments } from "../src/vault-index.js";
import { writeOkfBundle } from "../src/writer.js";
import type { RawDocument } from "../src/types.js";

const discoveredAt = "2026-06-14T00:00:00.000Z";

function normalize(raw: string): ReturnType<typeof normalizeDocument> {
  const document: RawDocument = {
    sourceId: "Source.md",
    filePath: "Source.md",
    contentType: "markdown",
    discoveredAt,
    raw
  };
  return normalizeDocument(document);
}

describe("Markdown semantic boundaries", () => {
  it("preserves a leading indented code block and keeps its syntax semantically inert", () => {
    const document = normalize(
      [
        "",
        "    <span>[[Hidden]] #hidden ^hidden-block</span>",
        "",
        "    [also hidden](./hidden.md)",
        ""
      ].join("\n")
    );

    expect(document.markdown).toBe(
      "    <span>[[Hidden]] #hidden ^hidden-block</span>\n\n    [also hidden](./hidden.md)"
    );
    expect(document.links).toEqual([]);
    expect(document.semanticLinks).toBeUndefined();
    expect(document.inlineTags).toBeUndefined();
    expect(document.blockIds).toBeUndefined();
    expect(resolveVaultDocuments([document])).toEqual([]);
    expect(
      extractInternalLinks({
        id: "source",
        path: "source.md",
        frontmatter: {},
        type: "Concept",
        tags: [],
        body: document.markdown
      })
    ).toEqual([]);
  });

  it("keeps semantic syntax inside nested inline HTML content inert", () => {
    const markdown = [
      "<span>",
      "[[Hidden]] ![[hidden.png]] #hidden [ordinary](./hidden.md)",
      "<em>[[Nested]] #nested</em><br/> after ^hidden-block",
      "</span>",
      "<!-- [[Comment]] #comment --><img src='image.png' />",
      "[[Visible]] ![[visible.png]] #visible [ordinary](./visible.md) ^visible-block"
    ].join(" ");
    const parsed = parseMarkdown(markdown);

    expect(parsed.markdownLinks).toEqual([{ href: "./visible.md", text: "ordinary" }]);
    expect(parsed.semanticLinks.map((link) => [link.kind, link.target])).toEqual([
      ["wikilink", "Visible"],
      ["attachment_embed", "visible.png"],
      ["markdown", "./visible.md"]
    ]);
    expect(parsed.inlineTags.map((tag) => tag.tag)).toEqual(["visible"]);
    expect(parsed.blockIds.map((block) => block.id)).toEqual(["visible-block"]);
  });

  it("treats a wikilink-shaped Markdown link label as part of one ordinary link", async () => {
    const source = normalize("# Source\n\n[Outer [[Nested]]](./Target.md)");
    const target = normalizeDocument({
      sourceId: "Target.md",
      filePath: "Target.md",
      contentType: "markdown",
      discoveredAt,
      raw: "# Target"
    });

    expect(source.links).toEqual([{ href: "./Target.md", text: "Outer Nested" }]);
    expect(source.semanticLinks?.map((link) => [link.kind, link.target])).toEqual([
      ["markdown", "./Target.md"]
    ]);
    expect(resolveVaultDocuments([source, target])).toEqual([]);

    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-semantic-boundary-"));
    try {
      await writeOkfBundle([source, target], {
        outDir,
        timestamp: discoveredAt
      });
      const rendered = await fs.readFile(path.join(outDir, "source.md"), "utf8");
      expect(rendered).toContain("[Outer [[Nested]]](./target.md)");

      const graph = buildGraph(await readBundle(outDir));
      expect(graph.outbound.get("source")).toEqual(["target"]);
    } finally {
      await fs.rm(outDir, { recursive: true, force: true });
    }
  });

  it("normalizes escaped table separators without changing semantic source ranges", async () => {
    const source = normalize(
      [
        "# Source",
        "",
        "| Link |",
        "| --- |",
        String.raw`| [[Target\|Alias]] |`,
        "",
        String.raw`![[image.png\|600]]`
      ].join("\n")
    );
    const target = normalizeDocument({
      sourceId: "Target.md",
      filePath: "Target.md",
      contentType: "markdown",
      discoveredAt,
      raw: "# Target"
    });
    const [link, attachment] = source.semanticLinks ?? [];

    expect(link).toMatchObject({ kind: "wikilink", target: "Target", text: "Alias" });
    expect(attachment).toMatchObject({
      kind: "attachment_embed",
      target: "image.png",
      text: "600"
    });
    for (const semantic of [link, attachment]) {
      expect(semantic).toBeDefined();
      expect(source.markdown.slice(semantic!.range.start, semantic!.range.end)).toBe(semantic!.raw);
    }

    expect(resolveVaultDocuments([source, target])).toEqual([]);
    expect(link).toMatchObject({ resolution: "resolved", resolvedSourceKey: "Target.md" });
    expect(attachment?.resolution).toBeUndefined();

    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), "okfy-escaped-table-link-"));
    try {
      await writeOkfBundle([source, target], { outDir, timestamp: discoveredAt });
      const rendered = await fs.readFile(path.join(outDir, "source.md"), "utf8");
      expect(rendered).toContain("| [Alias](./target.md) |");
      expect(rendered).toContain(String.raw`![[image.png\|600]]`);
    } finally {
      await fs.rm(outDir, { recursive: true, force: true });
    }
  });
});
