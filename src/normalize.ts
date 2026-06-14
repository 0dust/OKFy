import * as cheerio from "cheerio";
import TurndownService from "turndown";
import { safeSegment } from "./util/path.js";
import type { NormalizedDocument, RawDocument } from "./types.js";

const turndown = new TurndownService({
  codeBlockStyle: "fenced",
  headingStyle: "atx",
  bulletListMarker: "-"
});

turndown.keep(["table"]);

export function extractHeadings(markdown: string): Array<{ depth: number; text: string; slug: string }> {
  return [...markdown.matchAll(/^(#{1,6})\s+(.+)$/gm)].map((match) => ({
    depth: match[1]?.length ?? 1,
    text: (match[2] ?? "").trim(),
    slug: safeSegment(match[2] ?? "")
  }));
}

export function extractMarkdownLinks(markdown: string): Array<{ href: string; text: string }> {
  return [...markdown.matchAll(/\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((match) => ({
    text: match[1] ?? "",
    href: match[2] ?? ""
  }));
}

export function inferType(title: string, sourceId: string, markdown: string): string {
  const haystack = `${title} ${sourceId} ${markdown.slice(0, 2000)}`.toLowerCase();
  if (/\breadme\b/.test(haystack)) return "README";
  if (/\b(api|reference|sdk|endpoint|parameter|request|response)\b/.test(haystack)) return "API Reference";
  if (/\b(quickstart|guide|tutorial|walkthrough|get started)\b/.test(haystack)) return "Guide";
  if (/\bdocs?\b/.test(haystack)) return "Documentation Page";
  return "Concept";
}

export function inferTags(title: string, sourceId: string, headings: Array<{ text: string }>): string[] {
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

function titleFromMarkdown(markdown: string, fallback: string): string {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
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
  title = titleFromMarkdown(markdown, plainTitle(title)).replace(/\s+/g, " ").trim();
  const headings = extractHeadings(markdown);
  const links = extractMarkdownLinks(markdown);
  const sourceId = raw.url ?? raw.filePath ?? raw.sourceId;

  return {
    sourceId,
    title,
    markdown,
    resource: raw.url,
    sourcePath: raw.filePath,
    headings,
    links,
    tags: inferTags(title, sourceId, headings),
    type: inferType(title, sourceId, markdown)
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
