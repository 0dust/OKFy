import wikiLinkPlugin from "@flowershow/remark-wiki-link";
import GithubSlugger from "github-slugger";
import { load } from "js-yaml";
import { toString } from "mdast-util-to-string";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { hasFrontmatter } from "./frontmatter.js";
import { isRecord } from "./util/object.js";
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
  name?: string;
  attributes?: Array<{
    type: string;
    name?: string;
    value?: unknown;
  }>;
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
  htmlAnchors: DocumentBlockId[];
  inlineTags: InlineTag[];
  properties?: DocumentProperties;
  invalidFrontmatterProperties: RecognizedFrontmatterProperty[];
};

type RecognizedFrontmatterProperty = "title" | "description" | "type" | "aliases" | "tags";

const BINARY_ATTACHMENT_EXTENSIONS = new Set([
  "3gp",
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

const VOID_HTML_ELEMENTS = new Set([
  "area",
  "base",
  "basefont",
  "bgsound",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "keygen",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr"
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
  const stack: Array<{ node: AstNode; nextChildIndex: number }> = [{ node, nextChildIndex: 0 }];
  const path = [...ancestors];
  callback(node, [...path]);

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    const child = frame.node.children?.[frame.nextChildIndex];
    if (child) {
      frame.nextChildIndex += 1;
      path.push(frame.node);
      callback(child, [...path]);
      stack.push({ node: child, nextChildIndex: 0 });
      continue;
    }

    stack.pop();
    if (stack.length > 0) path.pop();
  }
}

function normalizedStrings(value: unknown): string[] | undefined {
  const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : undefined;
  if (!values) return undefined;
  const normalized: string[] = [];
  for (const item of values) {
    if (typeof item !== "string" || !item.trim()) return undefined;
    normalized.push(item.trim());
  }
  return normalized;
}

function normalizedTags(value: unknown): string[] | undefined {
  const normalized = normalizedStrings(value);
  if (!normalized) return undefined;
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of normalized) {
    const tag = item.replace(/^#/, "").toLowerCase();
    if (!tag) return undefined;
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hasOwn(data: Record<string, unknown>, property: RecognizedFrontmatterProperty): boolean {
  return Object.prototype.hasOwnProperty.call(data, property);
}

function sourceProperties(node: AstNode):
  | {
      properties: DocumentProperties;
      invalidProperties: RecognizedFrontmatterProperty[];
    }
  | undefined {
  const range = nodeRange(node);
  if (!range) return undefined;
  const loaded = load(node.value ?? "");
  const data = isRecord(loaded) ? loaded : {};
  const invalidProperties: RecognizedFrontmatterProperty[] = [];
  const title = optionalString(data.title);
  const description = optionalString(data.description);
  const type = optionalString(data.type);
  const aliases = normalizedStrings(data.aliases);
  const tags = normalizedTags(data.tags);

  for (const [property, value] of [
    ["title", title],
    ["description", description],
    ["type", type],
    ["aliases", aliases],
    ["tags", tags]
  ] as const) {
    if (hasOwn(data, property) && value === undefined) invalidProperties.push(property);
  }

  return {
    properties: {
      data,
      range,
      title,
      description,
      type,
      aliases: aliases ?? [],
      tags: tags ?? []
    },
    invalidProperties
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

function normalizedWikiData(
  raw: string,
  openingLength: number,
  target: string,
  alias: string | undefined
): { target: string; alias?: string } {
  const inner = raw.slice(openingLength, -2);
  const divider = inner.indexOf("|");
  const escapedDivider = divider > 0 && inner[divider - 1] === "\\";
  const parsedAlias = alias ?? (divider >= 0 ? inner.slice(divider + 1) : undefined);
  return {
    target: escapedDivider && target.endsWith("\\") ? target.slice(0, -1) : target,
    ...(parsedAlias === undefined ? {} : { alias: parsedAlias.replace(/\\\|/g, "|") })
  };
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

function bodyBoundary(source: string, bodyStart: number): { content: string; contentBase: number } {
  let contentBase = bodyStart;
  while (contentBase < source.length) {
    const lineEnd = source.indexOf("\n", contentBase);
    const end = lineEnd < 0 ? source.length : lineEnd;
    if (source.slice(contentBase, end).trim()) break;
    contentBase = lineEnd < 0 ? source.length : lineEnd + 1;
  }
  return { content: source.slice(contentBase).trimEnd(), contentBase };
}

type HtmlTag = { kind: "open" | "close"; name: string };

function htmlTag(node: AstNode): HtmlTag | undefined {
  if (node.type !== "html" || !node.value) return undefined;
  const value = node.value.trim();
  const closing = value.match(/^<\s*\/\s*([A-Za-z][A-Za-z0-9-]*)\s*>$/);
  if (closing) return { kind: "close", name: closing[1]!.toLowerCase() };
  const opening = value.match(/^<\s*([A-Za-z][A-Za-z0-9-]*)(?:\s[\s\S]*?)?\s*>$/);
  if (!opening || /\/\s*>$/.test(value)) return undefined;
  const name = opening[1]!.toLowerCase();
  return VOID_HTML_ELEMENTS.has(name) ? undefined : { kind: "open", name };
}

function htmlContentRanges(tree: AstNode, sourceEnd: number): SourceRange[] {
  const tags: Array<{ tag: HtmlTag; range: SourceRange }> = [];
  visit(tree, [], (node) => {
    const tag = htmlTag(node);
    const range = nodeRange(node);
    if (tag && range) tags.push({ tag, range });
  });

  const open: Array<{ name: string; start: number }> = [];
  const ranges: SourceRange[] = [];
  for (const { tag, range } of tags) {
    if (tag.kind === "open") {
      open.push({ name: tag.name, start: range.end });
      continue;
    }
    let matchingIndex = open.length - 1;
    while (matchingIndex >= 0 && open[matchingIndex]?.name !== tag.name) matchingIndex -= 1;
    if (matchingIndex < 0) continue;
    const [matching] = open.splice(matchingIndex);
    if (matching && matching.start < range.start) {
      ranges.push({ start: matching.start, end: range.start });
    }
  }
  for (const unclosed of open) {
    if (unclosed.start < sourceEnd) ranges.push({ start: unclosed.start, end: sourceEnd });
  }
  ranges.sort((first, second) => first.start - second.start || first.end - second.end);
  const merged: SourceRange[] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}

function isInsideRange(node: SourceRange, ranges: SourceRange[]): boolean {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = ranges[middle]!;
    if (node.start < range.start) high = middle - 1;
    else if (node.start > range.end) low = middle + 1;
    else return node.end <= range.end;
  }
  return false;
}

export function parseMarkdown(markdown: string, options: { mdx?: boolean } = {}): ParsedMarkdown {
  const source = markdown.startsWith("\uFEFF") ? markdown.slice(1) : markdown;
  const tree = (options.mdx ? mdxParser : markdownParser).parse(source) as AstNode;
  const htmlRanges = htmlContentRanges(tree, source.length);
  const definitions = new Map<string, Definition>();
  let properties: DocumentProperties | undefined;
  let invalidFrontmatterProperties: RecognizedFrontmatterProperty[] = [];

  visit(tree, [], (node) => {
    const range = nodeRange(node);
    if (node.type === "yaml" && !properties) {
      const source = sourceProperties(node);
      properties = source?.properties;
      invalidFrontmatterProperties = source?.invalidProperties ?? [];
    }
    if (node.type !== "definition" || !node.identifier || !node.url || !range) return;
    if (definitions.has(node.identifier)) return;
    definitions.set(node.identifier, {
      url: node.url,
      destinationRange: definitionDestinationRange(source, range, node.url)
    });
  });

  if (hasFrontmatter(source) && !properties) {
    throw new Error("Malformed YAML frontmatter.");
  }

  const frontmatterEnd = properties?.range.end ?? 0;
  const { content, contentBase } = bodyBoundary(source, frontmatterEnd);
  const slugger = new GithubSlugger();
  const headings: DocumentHeading[] = [];
  const markdownLinks: Array<{ href: string; text: string }> = [];
  const semanticLinks: SemanticLink[] = [];
  const blockIds: DocumentBlockId[] = [];
  const htmlAnchors: DocumentBlockId[] = [];
  const inlineTags: InlineTag[] = [];

  visit(tree, [], (node, ancestors) => {
    const originalRange = nodeRange(node);
    if (!originalRange || originalRange.start < contentBase) return;
    const range = adjustedRange(originalRange, contentBase);

    if (node.type === "html") {
      const raw = source.slice(originalRange.start, originalRange.end);
      for (const match of raw.matchAll(/^<a\s+id=(["'])([A-Za-z0-9-]+)\1\s*>$/gi)) {
        const index = match.index ?? 0;
        htmlAnchors.push({
          id: match[2]!,
          raw: match[0],
          range: {
            start: range.start + index,
            end: range.start + index + match[0].length
          }
        });
      }
      return;
    }

    if (node.type.startsWith("mdxJsx")) {
      const id = node.attributes?.find(
        (attribute) =>
          attribute.type === "mdxJsxAttribute" &&
          attribute.name === "id" &&
          typeof attribute.value === "string" &&
          /^[A-Za-z0-9-]+$/.test(attribute.value)
      )?.value;
      if (typeof id === "string" && node.name === "a") {
        htmlAnchors.push({
          id,
          raw: source.slice(originalRange.start, originalRange.end),
          range
        });
      }
      return;
    }

    if (isInsideRange(originalRange, htmlRanges)) return;

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

    if (node.type === "wikiLink" && node.value && isEligibleText(ancestors)) {
      const fullRange = { start: originalRange.start - 2, end: originalRange.end };
      const raw = source.slice(fullRange.start, fullRange.end);
      const wikiData = normalizedWikiData(raw, 2, node.value, node.data?.alias);
      const parts = splitTarget(wikiData.target);
      semanticLinks.push({
        kind: "wikilink",
        raw,
        ...parts,
        text: wikiData.alias ?? defaultLinkText(parts),
        range: adjustedRange(fullRange, contentBase)
      });
      return;
    }

    if (node.type === "embed" && node.value && isEligibleText(ancestors)) {
      const raw = source.slice(originalRange.start, originalRange.end);
      const wikiData = normalizedWikiData(raw, 3, node.value, node.data?.alias);
      const parts = splitTarget(wikiData.target);
      semanticLinks.push({
        kind: BINARY_ATTACHMENT_EXTENSIONS.has(attachmentExtension(parts.target))
          ? "attachment_embed"
          : "note_embed",
        raw,
        ...parts,
        text: wikiData.alias ?? defaultLinkText(parts),
        range
      });
      return;
    }

    if (node.type !== "text" || !isEligibleText(ancestors)) return;
    const textStart = originalRange.start;
    const rawText = source.slice(originalRange.start, originalRange.end);
    if (!rawText) return;

    for (const match of rawText.matchAll(/!\[\[([^\]\n]+)\]\]/g)) {
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

    for (const match of rawText.matchAll(/(^|[\s(>.,;:!?[{"'])#([\p{L}\p{N}\p{S}_/-]+)/gu)) {
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

    for (const match of rawText.matchAll(/(^|[ \t])\^([A-Za-z0-9-]+)(?=[ \t]*(?:\n|$))/g)) {
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
  htmlAnchors.sort((a, b) => a.range.start - b.range.start);
  inlineTags.sort((a, b) => a.range.start - b.range.start);

  return {
    content,
    headings,
    markdownLinks,
    semanticLinks,
    blockIds,
    htmlAnchors,
    inlineTags,
    properties,
    invalidFrontmatterProperties
  };
}
