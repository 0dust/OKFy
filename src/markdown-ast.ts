import wikiLinkPlugin from "@flowershow/remark-wiki-link";
import GithubSlugger from "github-slugger";
import { load } from "js-yaml";
import { toString } from "mdast-util-to-string";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type {
  DocumentBlockId,
  DocumentHeading,
  DocumentProperties,
  InlineTag,
  SemanticLink,
  SourceRange
} from "./types.js";

type AstNode = {
  type: string;
  value?: string;
  url?: string;
  identifier?: string;
  depth?: number;
  data?: { alias?: string };
  children?: AstNode[];
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
};

type Definition = {
  url: string;
  destinationRange?: SourceRange;
};

export type ParsedMarkdown = {
  content: string;
  headings: DocumentHeading[];
  markdownLinks: Array<{ href: string; text: string }>;
  semanticLinks: SemanticLink[];
  blockIds: DocumentBlockId[];
  inlineTags: InlineTag[];
  properties?: DocumentProperties;
};

const BINARY_ATTACHMENT_EXTENSIONS = new Set([
  "aac",
  "avif",
  "avi",
  "bmp",
  "flac",
  "gif",
  "ico",
  "jpeg",
  "jpg",
  "m4a",
  "mkv",
  "mov",
  "mp3",
  "mp4",
  "oga",
  "ogg",
  "ogv",
  "pdf",
  "png",
  "svg",
  "tif",
  "tiff",
  "wav",
  "webm",
  "webp"
]);

function createParser(mdx: boolean) {
  const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]);
  if (mdx) parser.use(remarkMdx);
  return parser.use(wikiLinkPlugin, { format: "regular" });
}

const markdownParser = createParser(false);
const mdxParser = createParser(true);

function nodeRange(node: AstNode): SourceRange | undefined {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return typeof start === "number" && typeof end === "number" ? { start, end } : undefined;
}

function visit(
  node: AstNode,
  ancestors: AstNode[],
  callback: (node: AstNode, ancestors: AstNode[]) => void
): void {
  callback(node, ancestors);
  for (const child of node.children ?? []) visit(child, [...ancestors, node], callback);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedStrings(value: unknown): string[] {
  const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : [];
  return values
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizedTags(value: unknown): string[] {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of normalizedStrings(value)) {
    const tag = item.replace(/^#/, "").toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function sourceProperties(node: AstNode): DocumentProperties | undefined {
  const range = nodeRange(node);
  if (!range) return undefined;
  const loaded = load(node.value ?? "");
  const data = isRecord(loaded) ? loaded : {};
  return {
    data,
    range,
    title: optionalString(data.title),
    description: optionalString(data.description),
    type: optionalString(data.type),
    aliases: normalizedStrings(data.aliases),
    tags: normalizedTags(data.tags)
  };
}

function targetRangeAfterDelimiter(
  source: string,
  range: SourceRange,
  target: string,
  delimiter: string
): SourceRange | undefined {
  const raw = source.slice(range.start, range.end);
  let targetOffset = raw.indexOf(target);
  while (targetOffset >= 0) {
    const delimiterOffset = raw.lastIndexOf(delimiter, targetOffset);
    const between =
      delimiterOffset < 0 ? undefined : raw.slice(delimiterOffset + delimiter.length, targetOffset);
    if (between !== undefined && /^[\s<]*$/.test(between)) {
      return {
        start: range.start + targetOffset,
        end: range.start + targetOffset + target.length
      };
    }
    targetOffset = raw.indexOf(target, targetOffset + target.length);
  }
  return undefined;
}

function inlineDestinationRange(
  source: string,
  range: SourceRange,
  target: string
): SourceRange | undefined {
  return targetRangeAfterDelimiter(source, range, target, "](");
}

function definitionDestinationRange(
  source: string,
  range: SourceRange,
  target: string
): SourceRange | undefined {
  return targetRangeAfterDelimiter(source, range, target, "]:");
}

function splitTarget(value: string): {
  target: string;
  heading?: string;
  blockId?: string;
} {
  const hash = value.indexOf("#");
  if (hash < 0) return { target: value.trim() };
  const target = value.slice(0, hash).trim();
  const fragment = value.slice(hash + 1).trim();
  if (fragment.startsWith("^")) return { target, blockId: fragment.slice(1) };
  return { target, heading: fragment };
}

function defaultLinkText(parts: ReturnType<typeof splitTarget>): string {
  if (parts.heading) return parts.heading;
  if (parts.blockId) return parts.blockId;
  return parts.target.split("/").pop() ?? parts.target;
}

function attachmentExtension(target: string): string {
  const clean = target.split(/[?#]/, 1)[0] ?? target;
  return clean.includes(".") ? (clean.split(".").pop() ?? "").toLowerCase() : "";
}

function isEligibleText(ancestors: AstNode[]): boolean {
  return !ancestors.some(
    (ancestor) =>
      ancestor.type === "link" ||
      ancestor.type === "linkReference" ||
      ancestor.type === "wikiLink" ||
      ancestor.type === "embed" ||
      ancestor.type === "html" ||
      ancestor.type.startsWith("mdx")
  );
}

function adjustedRange(range: SourceRange, contentBase: number): SourceRange {
  return { start: range.start - contentBase, end: range.end - contentBase };
}

export function parseMarkdown(markdown: string, options: { mdx?: boolean } = {}): ParsedMarkdown {
  const source = markdown.startsWith("\uFEFF") ? markdown.slice(1) : markdown;
  const tree = (options.mdx ? mdxParser : markdownParser).parse(source) as AstNode;
  const definitions = new Map<string, Definition>();
  let properties: DocumentProperties | undefined;

  visit(tree, [], (node) => {
    const range = nodeRange(node);
    if (node.type === "yaml" && !properties) properties = sourceProperties(node);
    if (node.type !== "definition" || !node.identifier || !node.url || !range) return;
    definitions.set(node.identifier, {
      url: node.url,
      destinationRange: definitionDestinationRange(source, range, node.url)
    });
  });

  const frontmatterEnd = properties?.range.end ?? 0;
  const afterFrontmatter = source.slice(frontmatterEnd);
  const leadingBodyWhitespace = afterFrontmatter.length - afterFrontmatter.trimStart().length;
  const contentBase = frontmatterEnd + leadingBodyWhitespace;
  const content = afterFrontmatter.trim();
  const slugger = new GithubSlugger();
  const headings: DocumentHeading[] = [];
  const markdownLinks: Array<{ href: string; text: string }> = [];
  const semanticLinks: SemanticLink[] = [];
  const blockIds: DocumentBlockId[] = [];
  const inlineTags: InlineTag[] = [];

  visit(tree, [], (node, ancestors) => {
    const originalRange = nodeRange(node);
    if (!originalRange || originalRange.start < contentBase) return;
    const range = adjustedRange(originalRange, contentBase);
    if (ancestors.some((ancestor) => ancestor.type === "html" || ancestor.type.startsWith("mdx"))) {
      return;
    }

    if (node.type === "heading" && typeof node.depth === "number") {
      const text = toString(node as never).trim();
      headings.push({ depth: node.depth, text, slug: slugger.slug(text), range });
      return;
    }

    if (node.type === "link" && node.url) {
      const text = toString(node as never);
      const linkDestinationRange = inlineDestinationRange(source, originalRange, node.url);
      markdownLinks.push({ href: node.url, text });
      semanticLinks.push({
        kind: "markdown",
        raw: source.slice(originalRange.start, originalRange.end),
        target: node.url,
        text,
        range,
        destinationRange: linkDestinationRange
          ? adjustedRange(linkDestinationRange, contentBase)
          : undefined
      });
      return;
    }

    if (node.type === "linkReference" && node.identifier) {
      const definition = definitions.get(node.identifier);
      if (!definition) return;
      const text = toString(node as never);
      markdownLinks.push({ href: definition.url, text });
      semanticLinks.push({
        kind: "markdown",
        raw: source.slice(originalRange.start, originalRange.end),
        target: definition.url,
        text,
        range,
        destinationRange: definition.destinationRange
          ? adjustedRange(definition.destinationRange, contentBase)
          : undefined
      });
      return;
    }

    if (node.type === "wikiLink" && node.value) {
      const fullRange = { start: originalRange.start - 2, end: originalRange.end };
      const parts = splitTarget(node.value);
      semanticLinks.push({
        kind: "wikilink",
        raw: source.slice(fullRange.start, fullRange.end),
        ...parts,
        text: node.data?.alias ?? defaultLinkText(parts),
        range: adjustedRange(fullRange, contentBase)
      });
      return;
    }

    if (node.type === "embed" && node.value) {
      const parts = splitTarget(node.value);
      const raw = source.slice(originalRange.start, originalRange.end);
      const divider = raw.slice(3, -2).indexOf("|");
      const alias = divider >= 0 ? raw.slice(3 + divider + 1, -2) : undefined;
      semanticLinks.push({
        kind: BINARY_ATTACHMENT_EXTENSIONS.has(attachmentExtension(parts.target))
          ? "attachment_embed"
          : "note_embed",
        raw,
        ...parts,
        text: alias ?? defaultLinkText(parts),
        range
      });
      return;
    }

    if (node.type !== "text" || !node.value || !isEligibleText(ancestors)) return;
    const textStart = originalRange.start;

    for (const match of node.value.matchAll(/!\[\[([^\]\n]+)\]\]/g)) {
      const index = match.index ?? 0;
      const raw = match[0];
      const [targetAndFragment = "", alias] = (match[1] ?? "").split("|", 2);
      const parts = splitTarget(targetAndFragment);
      const localRange = {
        start: textStart + index,
        end: textStart + index + raw.length
      };
      semanticLinks.push({
        kind: BINARY_ATTACHMENT_EXTENSIONS.has(attachmentExtension(parts.target))
          ? "attachment_embed"
          : "note_embed",
        raw,
        ...parts,
        text: alias?.trim() || defaultLinkText(parts),
        range: adjustedRange(localRange, contentBase)
      });
    }

    for (const match of node.value.matchAll(/(^|[\s(>.,;:!?[{"'])#([\p{L}\p{N}\p{S}_/-]+)/gu)) {
      const tag = match[2] ?? "";
      if (!tag || /^\p{N}+$/u.test(tag)) continue;
      const prefixLength = (match[1] ?? "").length;
      const index = (match.index ?? 0) + prefixLength;
      const raw = `#${tag}`;
      const localRange = { start: textStart + index, end: textStart + index + raw.length };
      inlineTags.push({
        tag: tag.toLowerCase(),
        raw,
        range: adjustedRange(localRange, contentBase)
      });
    }

    for (const match of node.value.matchAll(/(^|[ \t])\^([A-Za-z0-9-]+)(?=[ \t]*(?:\n|$))/g)) {
      const prefixLength = (match[1] ?? "").length;
      const index = (match.index ?? 0) + prefixLength;
      const raw = `^${match[2] ?? ""}`;
      const localRange = { start: textStart + index, end: textStart + index + raw.length };
      blockIds.push({
        id: match[2] ?? "",
        raw,
        range: adjustedRange(localRange, contentBase)
      });
    }
  });

  semanticLinks.sort((a, b) => a.range.start - b.range.start || a.range.end - b.range.end);
  blockIds.sort((a, b) => a.range.start - b.range.start);
  inlineTags.sort((a, b) => a.range.start - b.range.start);

  return { content, headings, markdownLinks, semanticLinks, blockIds, inlineTags, properties };
}
