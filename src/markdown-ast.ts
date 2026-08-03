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

type MarkdownCollectionContext = {
  source: string;
  tree: AstNode;
  htmlTagsByRange: Array<{ tag: HtmlTag; range: SourceRange }>;
  htmlRanges: SourceRange[];
  definitions: Map<string, Definition>;
  content: string;
  contentBase: number;
  slugger: GithubSlugger;
  headings: DocumentHeading[];
  rootHeadingTitle?: string;
  markdownLinks: Array<{ href: string; text: string }>;
  semanticLinks: SemanticLink[];
  blockIds: DocumentBlockId[];
  htmlAnchors: DocumentBlockId[];
  inlineTags: InlineTag[];
  properties?: DocumentProperties;
  invalidFrontmatterProperties: RecognizedFrontmatterProperty[];
};

type LocatedNode = {
  originalRange: SourceRange;
  range: SourceRange;
};

export type ParsedMarkdown = {
  content: string;
  headings: DocumentHeading[];
  rootHeadingTitle?: string;
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
  ancestors: readonly AstNode[],
  callback: (node: AstNode, ancestors: readonly AstNode[]) => void
): void {
  const stack: Array<{ node: AstNode; nextChildIndex: number }> = [{ node, nextChildIndex: 0 }];
  const path = [...ancestors];
  callback(node, path);

  while (stack.length > 0) {
    const frame = stack[stack.length - 1]!;
    const child = frame.node.children?.[frame.nextChildIndex];
    if (child) {
      frame.nextChildIndex += 1;
      path.push(frame.node);
      callback(child, path);
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
    if (Object.hasOwn(data, property) && value === undefined) invalidProperties.push(property);
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

function isEligibleText(ancestors: readonly AstNode[]): boolean {
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

function htmlTagEnd(raw: string, start: number, declaration: boolean): number {
  let quote: '"' | "'" | undefined;
  let subsetDepth = 0;
  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index];
    if (quote) {
      if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (declaration && character === "[") subsetDepth += 1;
    else if (declaration && character === "]" && subsetDepth > 0) subsetDepth -= 1;
    else if (character === ">" && subsetDepth === 0) return index;
  }
  return -1;
}

function htmlTags(node: AstNode, source: string): Array<{ tag: HtmlTag; range: SourceRange }> {
  const nodePosition = nodeRange(node);
  if (node.type !== "html" || !nodePosition) return [];
  const raw = source.slice(nodePosition.start, nodePosition.end);
  const tags: Array<{ tag: HtmlTag; range: SourceRange }> = [];
  let cursor = 0;

  while (cursor < raw.length) {
    const start = raw.indexOf("<", cursor);
    if (start < 0) break;

    if (raw.startsWith("<!--", start)) {
      const end = raw.indexOf("-->", start + 4);
      cursor = end < 0 ? raw.length : end + 3;
      continue;
    }
    if (raw.startsWith("<![CDATA[", start)) {
      const end = raw.indexOf("]]>", start + 9);
      cursor = end < 0 ? raw.length : end + 3;
      continue;
    }
    if (raw[start + 1] === "!" || raw[start + 1] === "?") {
      const end = htmlTagEnd(raw, start + 2, raw[start + 1] === "!");
      cursor = end < 0 ? raw.length : end + 1;
      continue;
    }

    const kind = raw[start + 1] === "/" ? "close" : "open";
    const nameStart = start + (kind === "close" ? 2 : 1);
    if (!/[A-Za-z]/.test(raw[nameStart] ?? "")) {
      cursor = start + 1;
      continue;
    }
    let nameEnd = nameStart + 1;
    while (/[A-Za-z0-9-]/.test(raw[nameEnd] ?? "")) nameEnd += 1;
    const name = raw.slice(nameStart, nameEnd).toLowerCase();

    if (kind === "close") {
      let end = nameEnd;
      while (/\s/.test(raw[end] ?? "")) end += 1;
      if (raw[end] !== ">") {
        cursor = start + 1;
        continue;
      }
      tags.push({
        tag: { kind, name },
        range: { start: nodePosition.start + start, end: nodePosition.start + end + 1 }
      });
      cursor = end + 1;
      continue;
    }

    const afterName = raw[nameEnd];
    if (afterName !== ">" && afterName !== "/" && !/\s/.test(afterName ?? "")) {
      cursor = start + 1;
      continue;
    }
    const end = htmlTagEnd(raw, nameEnd, false);
    if (end < 0) break;
    let beforeEnd = end - 1;
    while (/\s/.test(raw[beforeEnd] ?? "")) beforeEnd -= 1;
    if (raw[beforeEnd] !== "/" && !VOID_HTML_ELEMENTS.has(name)) {
      tags.push({
        tag: { kind, name },
        range: { start: nodePosition.start + start, end: nodePosition.start + end + 1 }
      });
    }
    cursor = end + 1;
  }
  return tags;
}

function htmlContentRanges(
  tags: Array<{ tag: HtmlTag; range: SourceRange }>,
  sourceLength: number
): SourceRange[] {
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
    if (unclosed.start < sourceLength) ranges.push({ start: unclosed.start, end: sourceLength });
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

function createCollectionContext(source: string, tree: AstNode): MarkdownCollectionContext {
  return {
    source,
    tree,
    htmlTagsByRange: [],
    htmlRanges: [],
    definitions: new Map(),
    content: source.trimEnd(),
    contentBase: 0,
    slugger: new GithubSlugger(),
    headings: [],
    markdownLinks: [],
    semanticLinks: [],
    blockIds: [],
    htmlAnchors: [],
    inlineTags: [],
    invalidFrontmatterProperties: []
  };
}

function collectStructuralMetadata(context: MarkdownCollectionContext): void {
  visit(context.tree, [], (node) => {
    context.htmlTagsByRange.push(...htmlTags(node, context.source));
    const range = nodeRange(node);
    if (node.type === "yaml" && !context.properties) {
      const parsedProperties = sourceProperties(node);
      context.properties = parsedProperties?.properties;
      context.invalidFrontmatterProperties = parsedProperties?.invalidProperties ?? [];
    }
    if (node.type !== "definition" || !node.identifier || !node.url || !range) return;
    if (context.definitions.has(node.identifier)) return;
    context.definitions.set(node.identifier, {
      url: node.url,
      destinationRange: definitionDestinationRange(context.source, range, node.url)
    });
  });
  context.htmlRanges = htmlContentRanges(context.htmlTagsByRange, context.source.length);

  if (hasFrontmatter(context.source) && !context.properties) {
    throw new Error("Malformed YAML frontmatter.");
  }

  const frontmatterEnd = context.properties?.range.end ?? 0;
  const body = bodyBoundary(context.source, frontmatterEnd);
  context.content = body.content;
  context.contentBase = body.contentBase;
}

function locateContentNode(
  context: MarkdownCollectionContext,
  node: AstNode
): LocatedNode | undefined {
  const originalRange = nodeRange(node);
  if (!originalRange || originalRange.start < context.contentBase) return undefined;
  return {
    originalRange,
    range: adjustedRange(originalRange, context.contentBase)
  };
}

function collectAnchorNode(
  context: MarkdownCollectionContext,
  node: AstNode,
  location: LocatedNode
): boolean {
  const { originalRange, range } = location;
  if (node.type === "html") {
    const raw = context.source.slice(originalRange.start, originalRange.end);
    for (const match of raw.matchAll(/^<a\s+id=(["'])([A-Za-z0-9-]+)\1\s*>$/gi)) {
      const index = match.index ?? 0;
      context.htmlAnchors.push({
        id: match[2]!,
        raw: match[0],
        range: {
          start: range.start + index,
          end: range.start + index + match[0].length
        }
      });
    }
    return true;
  }

  if (!node.type.startsWith("mdxJsx")) return false;
  const id = node.attributes?.find(
    (attribute) =>
      attribute.type === "mdxJsxAttribute" &&
      attribute.name === "id" &&
      typeof attribute.value === "string" &&
      /^[A-Za-z0-9-]+$/.test(attribute.value)
  )?.value;
  if (typeof id === "string" && node.name === "a") {
    context.htmlAnchors.push({
      id,
      raw: context.source.slice(originalRange.start, originalRange.end),
      range
    });
  }
  return true;
}

function collectHeadingNode(
  context: MarkdownCollectionContext,
  node: AstNode,
  ancestors: readonly AstNode[],
  range: SourceRange
): boolean {
  if (node.type !== "heading" || typeof node.depth !== "number") return false;
  const text = toString(node as never).trim();
  context.headings.push({
    depth: node.depth,
    text,
    slug: context.slugger.slug(text),
    range
  });
  if (
    node.depth === 1 &&
    context.rootHeadingTitle === undefined &&
    ancestors.length === 1 &&
    ancestors[0]?.type === "root"
  ) {
    context.rootHeadingTitle = text;
  }
  return true;
}

function collectMarkdownLink(
  context: MarkdownCollectionContext,
  node: AstNode,
  location: LocatedNode
): boolean {
  const { originalRange, range } = location;
  if (node.type === "link" && node.url) {
    const text = toString(node as never);
    const linkDestinationRange = inlineDestinationRange(context.source, originalRange, node.url);
    context.markdownLinks.push({ href: node.url, text });
    context.semanticLinks.push({
      kind: "markdown",
      raw: context.source.slice(originalRange.start, originalRange.end),
      target: node.url,
      text,
      range,
      destinationRange: linkDestinationRange
        ? adjustedRange(linkDestinationRange, context.contentBase)
        : undefined
    });
    return true;
  }

  if (node.type !== "linkReference" || !node.identifier) return false;
  const definition = context.definitions.get(node.identifier);
  if (!definition) return true;
  const text = toString(node as never);
  context.markdownLinks.push({ href: definition.url, text });
  context.semanticLinks.push({
    kind: "markdown",
    raw: context.source.slice(originalRange.start, originalRange.end),
    target: definition.url,
    text,
    range,
    destinationRange: definition.destinationRange
      ? adjustedRange(definition.destinationRange, context.contentBase)
      : undefined
  });
  return true;
}

function collectWikiLink(
  context: MarkdownCollectionContext,
  node: AstNode,
  ancestors: readonly AstNode[],
  location: LocatedNode
): boolean {
  const { originalRange } = location;
  if (node.type === "wikiLink" && node.value && isEligibleText(ancestors)) {
    const fullRange = { start: originalRange.start - 2, end: originalRange.end };
    const raw = context.source.slice(fullRange.start, fullRange.end);
    const wikiData = normalizedWikiData(raw, 2, node.value, node.data?.alias);
    const parts = splitTarget(wikiData.target);
    context.semanticLinks.push({
      kind: "wikilink",
      raw,
      ...parts,
      text: wikiData.alias ?? defaultLinkText(parts),
      range: adjustedRange(fullRange, context.contentBase)
    });
    return true;
  }

  if (node.type !== "embed" || !node.value || !isEligibleText(ancestors)) return false;
  const raw = context.source.slice(originalRange.start, originalRange.end);
  const wikiData = normalizedWikiData(raw, 3, node.value, node.data?.alias);
  const parts = splitTarget(wikiData.target);
  context.semanticLinks.push({
    kind: BINARY_ATTACHMENT_EXTENSIONS.has(attachmentExtension(parts.target))
      ? "attachment_embed"
      : "note_embed",
    raw,
    ...parts,
    text: wikiData.alias ?? defaultLinkText(parts),
    range: location.range
  });
  return true;
}

function collectLinkLikeNode(
  context: MarkdownCollectionContext,
  node: AstNode,
  ancestors: readonly AstNode[],
  location: LocatedNode
): boolean {
  return (
    collectMarkdownLink(context, node, location) ||
    collectWikiLink(context, node, ancestors, location)
  );
}

function collectTextEmbeds(
  context: MarkdownCollectionContext,
  rawText: string,
  textStart: number
): void {
  for (const match of rawText.matchAll(/!\[\[([^\]\n]+)\]\]/g)) {
    const index = match.index ?? 0;
    const raw = match[0];
    const [targetAndFragment = "", alias] = (match[1] ?? "").split("|", 2);
    const parts = splitTarget(targetAndFragment);
    const localRange = { start: textStart + index, end: textStart + index + raw.length };
    context.semanticLinks.push({
      kind: BINARY_ATTACHMENT_EXTENSIONS.has(attachmentExtension(parts.target))
        ? "attachment_embed"
        : "note_embed",
      raw,
      ...parts,
      text: alias?.trim() || defaultLinkText(parts),
      range: adjustedRange(localRange, context.contentBase)
    });
  }
}

function collectInlineTags(
  context: MarkdownCollectionContext,
  rawText: string,
  textStart: number
): void {
  for (const match of rawText.matchAll(/(^|[\s(>.,;:!?[{"'])#([\p{L}\p{N}\p{S}_/-]+)/gu)) {
    const tag = match[2] ?? "";
    if (!tag || /^\p{N}+$/u.test(tag)) continue;
    const prefixLength = (match[1] ?? "").length;
    const index = (match.index ?? 0) + prefixLength;
    const raw = `#${tag}`;
    const localRange = { start: textStart + index, end: textStart + index + raw.length };
    context.inlineTags.push({
      tag: tag.toLowerCase(),
      raw,
      range: adjustedRange(localRange, context.contentBase)
    });
  }
}

function collectBlockIds(
  context: MarkdownCollectionContext,
  rawText: string,
  textStart: number
): void {
  for (const match of rawText.matchAll(/(^|[ \t])\^([A-Za-z0-9-]+)(?=[ \t]*(?:\n|$))/g)) {
    const prefixLength = (match[1] ?? "").length;
    const index = (match.index ?? 0) + prefixLength;
    const raw = `^${match[2] ?? ""}`;
    const localRange = { start: textStart + index, end: textStart + index + raw.length };
    context.blockIds.push({
      id: match[2] ?? "",
      raw,
      range: adjustedRange(localRange, context.contentBase)
    });
  }
}

function collectProseTokens(
  context: MarkdownCollectionContext,
  node: AstNode,
  ancestors: readonly AstNode[],
  originalRange: SourceRange
): void {
  if (node.type !== "text" || !isEligibleText(ancestors)) return;
  const rawText = context.source.slice(originalRange.start, originalRange.end);
  if (!rawText) return;
  collectTextEmbeds(context, rawText, originalRange.start);
  collectInlineTags(context, rawText, originalRange.start);
  collectBlockIds(context, rawText, originalRange.start);
}

function collectContentMetadata(context: MarkdownCollectionContext): void {
  visit(context.tree, [], (node, ancestors) => {
    const location = locateContentNode(context, node);
    if (!location || collectAnchorNode(context, node, location)) return;
    if (isInsideRange(location.originalRange, context.htmlRanges)) return;
    if (ancestors.some((ancestor) => ancestor.type === "html" || ancestor.type.startsWith("mdx"))) {
      return;
    }
    if (collectHeadingNode(context, node, ancestors, location.range)) return;
    if (collectLinkLikeNode(context, node, ancestors, location)) return;
    collectProseTokens(context, node, ancestors, location.originalRange);
  });
}

function sortCollectedTokens(context: MarkdownCollectionContext): void {
  context.semanticLinks.sort(
    (first, second) => first.range.start - second.range.start || first.range.end - second.range.end
  );
  context.blockIds.sort((first, second) => first.range.start - second.range.start);
  context.htmlAnchors.sort((first, second) => first.range.start - second.range.start);
  context.inlineTags.sort((first, second) => first.range.start - second.range.start);
}

function collectionResult(context: MarkdownCollectionContext): ParsedMarkdown {
  return {
    content: context.content,
    headings: context.headings,
    rootHeadingTitle: context.rootHeadingTitle,
    markdownLinks: context.markdownLinks,
    semanticLinks: context.semanticLinks,
    blockIds: context.blockIds,
    htmlAnchors: context.htmlAnchors,
    inlineTags: context.inlineTags,
    properties: context.properties,
    invalidFrontmatterProperties: context.invalidFrontmatterProperties
  };
}

export function parseMarkdown(markdown: string, options: { mdx?: boolean } = {}): ParsedMarkdown {
  const source = markdown.startsWith("\uFEFF") ? markdown.slice(1) : markdown;
  const tree = (options.mdx ? mdxParser : markdownParser).parse(source) as AstNode;
  const context = createCollectionContext(source, tree);
  collectStructuralMetadata(context);
  collectContentMetadata(context);
  sortCollectedTokens(context);
  return collectionResult(context);
}
