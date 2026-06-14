import { describe, expect, it } from "vitest";
import {
  descriptionFromMarkdown,
  extractHeadings,
  extractMarkdownLinks,
  inferType,
  normalizeDocument
} from "../src/normalize.js";

const discoveredAt = "2026-06-14T00:00:00.000Z";

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
    const markdown = "# API Reference\r\n\r\nUse `search_concepts`.\r\n\r\n## Tools\r\n[Quickstart](./quickstart.md)";
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
    expect(extractMarkdownLinks("[A](./a.md \"title\") [B](https://example.com)")).toEqual([
      { text: "A", href: "./a.md" },
      { text: "B", href: "https://example.com" }
    ]);
    expect(inferType("Readme", "README.md", "")).toBe("README");
    expect(descriptionFromMarkdown("# Title\n\nUse [okfy](./okfy.md) for docs.")).toBe("Use okfy for docs.");
  });
});
