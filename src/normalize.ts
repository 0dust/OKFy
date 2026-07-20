import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { parseMarkdown } from "./markdown-ast.js";
import type { NormalizedDocument, RawDocument } from "./types.js";

const turndown = new TurndownService({
  codeBlockStyle: "fenced",
  headingStyle: "atx",
  bulletListMarker: "-"
});

turndown.keep(["table"]);

export function extractHeadings(
  markdown: string
): Array<{ depth: number; text: string; slug: string }> {
  return parseMarkdown(markdown).headings.map(({ depth, text, slug }) => ({ depth, text, slug }));
}

export function extractMarkdownLinks(markdown: string): Array<{ href: string; text: string }> {
  return parseMarkdown(markdown).markdownLinks;
}

export function inferType(title: string, sourceId: string, markdown: string): string {
  const haystack = `${title} ${sourceId} ${markdown.slice(0, 2000)}`.toLowerCase();
  if (/\breadme\b/.test(haystack)) return "README";
  if (/\b(api|reference|sdk|endpoint|parameter|request|response)\b/.test(haystack))
    return "API Reference";
  if (/\b(quickstart|guide|tutorial|walkthrough|get started)\b/.test(haystack)) return "Guide";
  if (/\bdocs?\b/.test(haystack)) return "Documentation Page";
  return "Concept";
}

export function inferTags(
  title: string,
  sourceId: string,
  headings: Array<{ text: string }>
): string[] {
  const raw = `${sourceId} ${title} ${headings
    .slice(0, 3)
    .map((h) => h.text)
    .join(" ")}`;
  const words = raw
    .toLowerCase()
    .replace(/https?:\/\/[^/]+/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && word.length <= 24)
    .filter((word) => !["html", "markdown", "index", "docs", "page", "guide"].includes(word));
  return [...new Set(words)].slice(0, 6);
}

function titleFromMarkdown(
  headings: Array<{ depth: number; text: string }>,
  fallback: string
): string {
  const heading = headings.find((candidate) => candidate.depth === 1)?.text;
  if (heading) return plainTitle(heading);
  return fallback;
}

function plainTitle(title: string): string {
  return title
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[`*_#]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function fallbackTitle(sourceId: string): string {
  const leaf = sourceId.split(/[/?#]/).filter(Boolean).pop() ?? "Index";
  return leaf
    .replace(/\.[a-z0-9]+$/i, "")
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ");
}

export function normalizeDocument(raw: RawDocument): NormalizedDocument {
  let markdown = raw.raw;
  let title = fallbackTitle(raw.url ?? raw.filePath ?? raw.sourceId);

  if (raw.contentType === "html") {
    const $ = cheerio.load(raw.raw);
    $("script,style,noscript,svg,header,footer,nav,aside").remove();
    title = $("h1").first().text().trim() || $("title").first().text().trim() || title;
    const main = $("main, article, [role='main'], .markdown-body, .docs-content").first();
    const html = (main.length ? main : $("body")).html() ?? raw.raw;
    markdown = turndown.turndown(html).trim();
  } else if (raw.contentType === "text") {
    markdown = `# ${title}\n\n\`\`\`text\n${raw.raw.trim()}\n\`\`\``;
  }

  markdown = markdown.replace(/\r\n/g, "\n").trim();
  const parsed = parseMarkdown(markdown, { mdx: raw.contentType === "mdx" });
  markdown = parsed.content;
  title = (parsed.properties?.title ?? titleFromMarkdown(parsed.headings, plainTitle(title)))
    .replace(/\s+/g, " ")
    .trim();
  const headings = parsed.headings.map(({ depth, text, slug }) => ({ depth, text, slug }));
  const links = parsed.markdownLinks;
  const sourceId = raw.url ?? raw.filePath ?? raw.sourceId;
  const inferredTags = inferTags(title, sourceId, headings);
  const tags = [
    ...(parsed.properties?.tags ?? []),
    ...parsed.inlineTags.map((inlineTag) => inlineTag.tag),
    ...inferredTags
  ].filter(
    (tag, index, all) =>
      all.findIndex((candidate) => candidate.toLowerCase() === tag.toLowerCase()) === index
  );

  return {
    sourceId,
    title,
    markdown,
    resource: raw.url,
    sourcePath: raw.filePath,
    headings,
    links,
    tags,
    type: parsed.properties?.type ?? inferType(title, sourceId, markdown),
    ...(parsed.properties ? { properties: parsed.properties } : {}),
    ...(parsed.properties?.aliases.length ? { aliases: parsed.properties.aliases } : {}),
    ...(parsed.semanticLinks.length ? { semanticLinks: parsed.semanticLinks } : {}),
    ...(parsed.blockIds.length ? { blockIds: parsed.blockIds } : {}),
    ...(parsed.inlineTags.length ? { inlineTags: parsed.inlineTags } : {})
  };
}

export function descriptionFromMarkdown(markdown: string): string {
  const text = markdown
    .replace(/^---[\s\S]*?---\s*/m, "")
    .replace(/^#{1,6}\s+.+$/gm, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.slice(0, 180) || "Generated OKF concept.";
}
