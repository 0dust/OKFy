// src/metadata.ts
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
var FALLBACK_NAME = "okfy-ai";
var FALLBACK_VERSION = "0.0.0";
var cachedMetadata;
function runtimePackageRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}
function packageMetadata() {
  cachedMetadata ??= readPackageMetadata();
  return cachedMetadata;
}
function packageVersion() {
  return packageMetadata().version;
}
function okfyUserAgent() {
  return `okfy/${packageVersion()} (+https://github.com/0dust/OKFy)`;
}
function readPackageMetadata() {
  const root = runtimePackageRoot();
  try {
    const raw = fs.readFileSync(path.join(root, "package.json"), "utf8");
    const parsed = JSON.parse(raw);
    return {
      name: parsed.name ?? FALLBACK_NAME,
      version: parsed.version ?? FALLBACK_VERSION,
      root
    };
  } catch {
    return {
      name: FALLBACK_NAME,
      version: FALLBACK_VERSION,
      root
    };
  }
}

// src/internal-links.ts
import path3 from "path";

// src/util/path.ts
import path2 from "path";
function toPosixPath(input) {
  return input.split(path2.sep).join("/");
}
function stripMdExtension(input) {
  return input.replace(/\.md$/i, "");
}
function safeSegment(input) {
  let decoded = input;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    decoded = input;
  }
  const cleaned = decoded.normalize("NFKD").replace(/[^\w.\-~]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-").toLowerCase();
  return cleaned || "index";
}
function ensureMarkdownPath(input) {
  if (!input || input === "/") return "index.md";
  const trimmed = input.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return "index.md";
  const parts = trimmed.split("/").map(safeSegment);
  const last = parts[parts.length - 1] ?? "index";
  if (/\.(md|mdx|html?|txt)$/i.test(last)) {
    parts[parts.length - 1] = last.replace(/\.(mdx|html?|txt)$/i, ".md");
  } else {
    parts[parts.length - 1] = `${last}.md`;
  }
  return parts.join("/");
}
function urlToOutputPath(url) {
  const parsed = new URL(url);
  if (parsed.pathname === "/" || parsed.pathname === "") return "index.md";
  const trailingSlash = parsed.pathname.endsWith("/");
  if (trailingSlash) {
    const trimmed = parsed.pathname.replace(/^\/+|\/+$/g, "");
    return `${trimmed.split("/").map(safeSegment).join("/")}/index.md`;
  }
  return ensureMarkdownPath(parsed.pathname);
}
function relativeMarkdownLink(fromPath, toPath) {
  const fromDir = path2.posix.dirname(toPosixPath(fromPath));
  let rel = path2.posix.relative(fromDir, toPosixPath(toPath));
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

// src/internal-links.ts
function internalLinksFromSemantics(conceptPath, semanticLinks) {
  const links = /* @__PURE__ */ new Set();
  for (const link of semanticLinks) {
    if (link.kind !== "markdown") continue;
    const noHash = link.target.split("#")[0] ?? link.target;
    if (!noHash) continue;
    if (/^(https?:)?\/\//i.test(noHash) || /^mailto:/i.test(noHash)) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(noHash)) continue;
    const resolved = noHash.startsWith("/") ? path3.posix.normalize(noHash.slice(1)) : path3.posix.normalize(path3.posix.join(path3.posix.dirname(conceptPath), noHash));
    if (!resolved || resolved === ".") continue;
    links.add(stripMdExtension(resolved));
  }
  return [...links].sort();
}

// src/markdown-ast.ts
import wikiLinkPlugin from "@flowershow/remark-wiki-link";
import GithubSlugger from "github-slugger";
import { load as load2 } from "js-yaml";
import { toString } from "mdast-util-to-string";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";

// src/frontmatter.ts
import { load } from "js-yaml";

// src/util/object.ts
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// src/frontmatter.ts
var UTF8_BOM = "\uFEFF";
function stripLeadingBom(raw) {
  return raw.startsWith(UTF8_BOM) ? raw.slice(1) : raw;
}
function hasFrontmatter(raw) {
  return /^---[ \t]*(?:\r?\n|$)/.test(stripLeadingBom(raw));
}
function parseFrontmatter(raw) {
  const normalized = stripLeadingBom(raw);
  if (!hasFrontmatter(normalized)) return { data: {}, content: normalized };
  const openingEnd = normalized.indexOf("\n");
  if (openingEnd < 0) throw new Error("Malformed YAML frontmatter.");
  let lineStart = openingEnd + 1;
  let closingEnd = -1;
  let yamlEnd = -1;
  while (lineStart <= normalized.length) {
    const nextNewline = normalized.indexOf("\n", lineStart);
    const lineEnd = nextNewline < 0 ? normalized.length : nextNewline;
    const line = normalized.slice(lineStart, lineEnd).replace(/\r$/, "");
    if (/^---[ \t]*$/.test(line)) {
      yamlEnd = lineStart;
      closingEnd = nextNewline < 0 ? lineEnd : nextNewline + 1;
      break;
    }
    if (nextNewline < 0) break;
    lineStart = nextNewline + 1;
  }
  if (closingEnd < 0 || yamlEnd < 0) throw new Error("Malformed YAML frontmatter.");
  const yaml = normalized.slice(openingEnd + 1, yamlEnd).replace(/\r?\n$/, "");
  const loaded = load(yaml);
  return {
    data: isRecord(loaded) ? loaded : {},
    content: normalized.slice(closingEnd)
  };
}

// src/markdown-ast.ts
var BINARY_ATTACHMENT_EXTENSIONS = /* @__PURE__ */ new Set([
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
var VOID_HTML_ELEMENTS = /* @__PURE__ */ new Set([
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
function createParser(mdx) {
  const parser = unified().use(remarkParse).use(remarkGfm).use(remarkFrontmatter, ["yaml"]);
  if (mdx) parser.use(remarkMdx);
  return parser.use(wikiLinkPlugin, { format: "regular" });
}
var markdownParser = createParser(false);
var mdxParser = createParser(true);
function nodeRange(node) {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return typeof start === "number" && typeof end === "number" ? { start, end } : void 0;
}
function visit(node, ancestors, callback) {
  const stack = [{ node, nextChildIndex: 0 }];
  const path13 = [...ancestors];
  callback(node, [...path13]);
  while (stack.length > 0) {
    const frame = stack[stack.length - 1];
    const child = frame.node.children?.[frame.nextChildIndex];
    if (child) {
      frame.nextChildIndex += 1;
      path13.push(frame.node);
      callback(child, [...path13]);
      stack.push({ node: child, nextChildIndex: 0 });
      continue;
    }
    stack.pop();
    if (stack.length > 0) path13.pop();
  }
}
function normalizedStrings(value) {
  const values = typeof value === "string" ? [value] : Array.isArray(value) ? value : void 0;
  if (!values) return void 0;
  const normalized = [];
  for (const item of values) {
    if (typeof item !== "string" || !item.trim()) return void 0;
    normalized.push(item.trim());
  }
  return normalized;
}
function normalizedTags(value) {
  const normalized = normalizedStrings(value);
  if (!normalized) return void 0;
  const seen = /* @__PURE__ */ new Set();
  const tags = [];
  for (const item of normalized) {
    const tag = item.replace(/^#/, "").toLowerCase();
    if (!tag) return void 0;
    if (seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}
function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : void 0;
}
function hasOwn(data, property) {
  return Object.prototype.hasOwnProperty.call(data, property);
}
function sourceProperties(node) {
  const range = nodeRange(node);
  if (!range) return void 0;
  const loaded = load2(node.value ?? "");
  const data = isRecord(loaded) ? loaded : {};
  const invalidProperties = [];
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
  ]) {
    if (hasOwn(data, property) && value === void 0) invalidProperties.push(property);
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
function targetRangeAfterDelimiter(source, range, target, delimiter) {
  const raw = source.slice(range.start, range.end);
  let targetOffset = raw.indexOf(target);
  while (targetOffset >= 0) {
    const delimiterOffset = raw.lastIndexOf(delimiter, targetOffset);
    const between = delimiterOffset < 0 ? void 0 : raw.slice(delimiterOffset + delimiter.length, targetOffset);
    if (between !== void 0 && /^[\s<]*$/.test(between)) {
      return {
        start: range.start + targetOffset,
        end: range.start + targetOffset + target.length
      };
    }
    targetOffset = raw.indexOf(target, targetOffset + target.length);
  }
  return void 0;
}
function inlineDestinationRange(source, range, target) {
  return targetRangeAfterDelimiter(source, range, target, "](");
}
function definitionDestinationRange(source, range, target) {
  return targetRangeAfterDelimiter(source, range, target, "]:");
}
function splitTarget(value) {
  const hash = value.indexOf("#");
  if (hash < 0) return { target: value.trim() };
  const target = value.slice(0, hash).trim();
  const fragment = value.slice(hash + 1).trim();
  if (fragment.startsWith("^")) return { target, blockId: fragment.slice(1) };
  return { target, heading: fragment };
}
function defaultLinkText(parts) {
  if (parts.heading) return parts.heading;
  if (parts.blockId) return parts.blockId;
  return parts.target.split("/").pop() ?? parts.target;
}
function normalizedWikiData(raw, openingLength, target, alias) {
  const inner = raw.slice(openingLength, -2);
  const divider = inner.indexOf("|");
  const escapedDivider = divider > 0 && inner[divider - 1] === "\\";
  const parsedAlias = alias ?? (divider >= 0 ? inner.slice(divider + 1) : void 0);
  return {
    target: escapedDivider && target.endsWith("\\") ? target.slice(0, -1) : target,
    ...parsedAlias === void 0 ? {} : { alias: parsedAlias.replace(/\\\|/g, "|") }
  };
}
function attachmentExtension(target) {
  const clean = target.split(/[?#]/, 1)[0] ?? target;
  return clean.includes(".") ? (clean.split(".").pop() ?? "").toLowerCase() : "";
}
function isEligibleText(ancestors) {
  return !ancestors.some(
    (ancestor) => ancestor.type === "link" || ancestor.type === "linkReference" || ancestor.type === "wikiLink" || ancestor.type === "embed" || ancestor.type === "html" || ancestor.type.startsWith("mdx")
  );
}
function adjustedRange(range, contentBase) {
  return { start: range.start - contentBase, end: range.end - contentBase };
}
function bodyBoundary(source, bodyStart) {
  let contentBase = bodyStart;
  while (contentBase < source.length) {
    const lineEnd = source.indexOf("\n", contentBase);
    const end = lineEnd < 0 ? source.length : lineEnd;
    if (source.slice(contentBase, end).trim()) break;
    contentBase = lineEnd < 0 ? source.length : lineEnd + 1;
  }
  return { content: source.slice(contentBase).trimEnd(), contentBase };
}
function htmlTagEnd(raw, start, declaration) {
  let quote;
  let subsetDepth = 0;
  for (let index = start; index < raw.length; index += 1) {
    const character = raw[index];
    if (quote) {
      if (character === quote) quote = void 0;
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
function htmlTags(node, source) {
  const nodePosition = nodeRange(node);
  if (node.type !== "html" || !nodePosition) return [];
  const raw = source.slice(nodePosition.start, nodePosition.end);
  const tags = [];
  let cursor = 0;
  while (cursor < raw.length) {
    const start = raw.indexOf("<", cursor);
    if (start < 0) break;
    if (raw.startsWith("<!--", start)) {
      const end2 = raw.indexOf("-->", start + 4);
      cursor = end2 < 0 ? raw.length : end2 + 3;
      continue;
    }
    if (raw.startsWith("<![CDATA[", start)) {
      const end2 = raw.indexOf("]]>", start + 9);
      cursor = end2 < 0 ? raw.length : end2 + 3;
      continue;
    }
    if (raw[start + 1] === "!" || raw[start + 1] === "?") {
      const end2 = htmlTagEnd(raw, start + 2, raw[start + 1] === "!");
      cursor = end2 < 0 ? raw.length : end2 + 1;
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
      let end2 = nameEnd;
      while (/\s/.test(raw[end2] ?? "")) end2 += 1;
      if (raw[end2] !== ">") {
        cursor = start + 1;
        continue;
      }
      tags.push({
        tag: { kind, name },
        range: { start: nodePosition.start + start, end: nodePosition.start + end2 + 1 }
      });
      cursor = end2 + 1;
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
function htmlContentRanges(tree, source) {
  const tags = [];
  visit(tree, [], (node) => {
    tags.push(...htmlTags(node, source));
  });
  const open = [];
  const ranges = [];
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
    if (unclosed.start < source.length) ranges.push({ start: unclosed.start, end: source.length });
  }
  ranges.sort((first, second) => first.start - second.start || first.end - second.end);
  const merged = [];
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
function isInsideRange(node, ranges) {
  let low = 0;
  let high = ranges.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const range = ranges[middle];
    if (node.start < range.start) high = middle - 1;
    else if (node.start > range.end) low = middle + 1;
    else return node.end <= range.end;
  }
  return false;
}
function parseMarkdown(markdown, options = {}) {
  const source = markdown.startsWith("\uFEFF") ? markdown.slice(1) : markdown;
  const tree = (options.mdx ? mdxParser : markdownParser).parse(source);
  const htmlRanges = htmlContentRanges(tree, source);
  const definitions = /* @__PURE__ */ new Map();
  let properties;
  let invalidFrontmatterProperties = [];
  visit(tree, [], (node) => {
    const range = nodeRange(node);
    if (node.type === "yaml" && !properties) {
      const source2 = sourceProperties(node);
      properties = source2?.properties;
      invalidFrontmatterProperties = source2?.invalidProperties ?? [];
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
  const headings = [];
  const markdownLinks = [];
  const semanticLinks = [];
  const blockIds = [];
  const htmlAnchors = [];
  const inlineTags = [];
  visit(tree, [], (node, ancestors) => {
    const originalRange = nodeRange(node);
    if (!originalRange || originalRange.start < contentBase) return;
    const range = adjustedRange(originalRange, contentBase);
    if (node.type === "html") {
      const raw = source.slice(originalRange.start, originalRange.end);
      for (const match of raw.matchAll(/^<a\s+id=(["'])([A-Za-z0-9-]+)\1\s*>$/gi)) {
        const index = match.index ?? 0;
        htmlAnchors.push({
          id: match[2],
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
        (attribute) => attribute.type === "mdxJsxAttribute" && attribute.name === "id" && typeof attribute.value === "string" && /^[A-Za-z0-9-]+$/.test(attribute.value)
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
      const text = toString(node).trim();
      headings.push({ depth: node.depth, text, slug: slugger.slug(text), range });
      return;
    }
    if (node.type === "link" && node.url) {
      const text = toString(node);
      const linkDestinationRange = inlineDestinationRange(source, originalRange, node.url);
      markdownLinks.push({ href: node.url, text });
      semanticLinks.push({
        kind: "markdown",
        raw: source.slice(originalRange.start, originalRange.end),
        target: node.url,
        text,
        range,
        destinationRange: linkDestinationRange ? adjustedRange(linkDestinationRange, contentBase) : void 0
      });
      return;
    }
    if (node.type === "linkReference" && node.identifier) {
      const definition = definitions.get(node.identifier);
      if (!definition) return;
      const text = toString(node);
      markdownLinks.push({ href: definition.url, text });
      semanticLinks.push({
        kind: "markdown",
        raw: source.slice(originalRange.start, originalRange.end),
        target: definition.url,
        text,
        range,
        destinationRange: definition.destinationRange ? adjustedRange(definition.destinationRange, contentBase) : void 0
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
        kind: BINARY_ATTACHMENT_EXTENSIONS.has(attachmentExtension(parts.target)) ? "attachment_embed" : "note_embed",
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
        kind: BINARY_ATTACHMENT_EXTENSIONS.has(attachmentExtension(parts.target)) ? "attachment_embed" : "note_embed",
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

// src/graph.ts
function extractInternalLinks(concept) {
  const sourcePath = concept.resource?.split(/[?#]/, 1)[0] ?? "";
  return internalLinksFromSemantics(
    concept.path,
    parseMarkdown(concept.body, { mdx: /\.mdx$/i.test(sourcePath) }).semanticLinks
  );
}
function buildGraph(conceptsByAnyKey) {
  const concepts = /* @__PURE__ */ new Map();
  for (const concept of conceptsByAnyKey.values()) concepts.set(concept.id, concept);
  const outbound = /* @__PURE__ */ new Map();
  const backlinks = /* @__PURE__ */ new Map();
  for (const concept of concepts.values()) {
    const targets = extractInternalLinks(concept).filter((id) => concepts.has(id));
    outbound.set(concept.id, targets);
    for (const target of targets) {
      backlinks.set(target, [...backlinks.get(target) ?? [], concept.id].sort());
    }
  }
  for (const concept of concepts.values()) {
    if (!backlinks.has(concept.id)) backlinks.set(concept.id, []);
    if (!outbound.has(concept.id)) outbound.set(concept.id, []);
  }
  return { concepts, outbound, backlinks };
}

// src/reader.ts
import fs3 from "fs/promises";
import path6 from "path";

// src/okf.ts
import path4 from "path";
var RESERVED_FILENAMES = /* @__PURE__ */ new Set(["index.md", "log.md"]);
function toOkfPath(input) {
  return input.split(path4.sep).join("/");
}
function isReservedOkfPath(input) {
  return RESERVED_FILENAMES.has(path4.posix.basename(toOkfPath(input)).toLowerCase());
}
function isConceptMarkdownPath(input) {
  return input.toLowerCase().endsWith(".md") && !isReservedOkfPath(input);
}

// src/util/markdown-files.ts
import fs2 from "fs/promises";
import path5 from "path";
async function listMarkdownFiles(dir) {
  const result = [];
  async function walk(current) {
    for (const entry of await fs2.readdir(current, { withFileTypes: true })) {
      const absolute = path5.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && entry.name.endsWith(".md")) result.push(absolute);
    }
  }
  await walk(dir);
  return result.sort();
}

// src/reader.ts
function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string");
}
async function readConceptFile(bundleDir, absolutePath) {
  const raw = await fs3.readFile(absolutePath, "utf8");
  const parsed = parseFrontmatter(raw);
  const relPath = toPosixPath(path6.relative(bundleDir, absolutePath));
  if (isReservedOkfPath(relPath)) throw new Error(`Reserved OKF file is not a concept: ${relPath}`);
  const id = stripMdExtension(relPath);
  const frontmatter = parsed.data;
  const aliases = stringArray(frontmatter.aliases);
  return {
    id,
    path: relPath,
    frontmatter,
    type: typeof frontmatter.type === "string" ? frontmatter.type : "",
    title: typeof frontmatter.title === "string" ? frontmatter.title : void 0,
    description: typeof frontmatter.description === "string" ? frontmatter.description : void 0,
    resource: typeof frontmatter.resource === "string" ? frontmatter.resource : void 0,
    tags: stringArray(frontmatter.tags),
    ...aliases.length ? { aliases } : {},
    body: parsed.content.trim()
  };
}
async function readBundle(bundleDir) {
  const files = await listMarkdownFiles(bundleDir);
  const concepts = /* @__PURE__ */ new Map();
  for (const file of files) {
    const relPath = toPosixPath(path6.relative(bundleDir, file));
    if (!isConceptMarkdownPath(relPath)) continue;
    const concept = await readConceptFile(bundleDir, file);
    concepts.set(concept.id, concept);
    concepts.set(concept.path, concept);
  }
  return concepts;
}

// src/validate.ts
import fs4 from "fs/promises";
import path8 from "path";

// src/vault-index.ts
import path7 from "path";
import GithubSlugger2 from "github-slugger";
var VAULT_DIAGNOSTIC_CODES = /* @__PURE__ */ new Set([
  "unresolved_wikilink",
  "ambiguous_wikilink",
  "missing_wikilink_fragment"
]);
function compareText(first, second) {
  return first < second ? -1 : first > second ? 1 : 0;
}
function normalizeVaultPath(value) {
  const withSeparators = value.trim().replace(/\\/g, "/").normalize("NFC");
  const withoutRoot = withSeparators.replace(/^\/+/, "");
  const normalized = path7.posix.normalize(withoutRoot);
  return normalized === "." ? "" : normalized.replace(/^\.\//, "");
}
function stripMarkdownExtension(value) {
  return value.replace(/\.(?:md|mdx)$/i, "");
}
function decodeFragment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
function emptyPathIdentityIndex() {
  return {
    keys: /* @__PURE__ */ new Map(),
    stems: /* @__PURE__ */ new Map(),
    suffixes: /* @__PURE__ */ new Map(),
    basenames: /* @__PURE__ */ new Map()
  };
}
function addCandidate(candidates, key, entry) {
  const entries = candidates.get(key);
  if (entries) entries.push(entry);
  else candidates.set(key, [entry]);
}
function suffixesFor(stem) {
  const segments = stem.split("/");
  return segments.map((_, index) => segments.slice(index).join("/"));
}
function addIdentity(index, key, stem, entry) {
  addCandidate(index.keys, key, entry);
  addCandidate(index.stems, stem, entry);
  for (const suffix of suffixesFor(stem)) addCandidate(index.suffixes, suffix, entry);
  addCandidate(index.basenames, path7.posix.basename(stem), entry);
}
function buildVaultIndex(entries) {
  const index = {
    paths: { source: emptyPathIdentityIndex(), output: emptyPathIdentityIndex() },
    foldedPaths: { source: emptyPathIdentityIndex(), output: emptyPathIdentityIndex() },
    names: /* @__PURE__ */ new Map(),
    foldedNames: /* @__PURE__ */ new Map()
  };
  for (const entry of entries) {
    for (const identity of entry.identityPaths) {
      addIdentity(index.paths[identity.kind], identity.key, identity.stem, entry);
      addIdentity(
        index.foldedPaths[identity.kind],
        identity.key.toLocaleLowerCase("en-US"),
        identity.stem.toLocaleLowerCase("en-US"),
        entry
      );
    }
    for (const name of entry.names) {
      addCandidate(index.names, name, entry);
      addCandidate(index.foldedNames, name.toLocaleLowerCase("en-US"), entry);
    }
  }
  return index;
}
function uniqueEntries(entries) {
  return [...new Set(entries)].sort((a, b) => compareText(a.sourceKey, b.sourceKey));
}
function resultFor(entries) {
  const candidates = uniqueEntries(entries);
  if (candidates.length === 0) return void 0;
  if (candidates.length === 1) return { status: "resolved", entry: candidates[0] };
  return { status: "ambiguous", entries: candidates };
}
function candidatesFrom(...candidateSets) {
  return candidateSets.flatMap((candidates) => candidates ?? []);
}
function exactPath(index, target, kind) {
  const paths = index.paths[kind];
  const exactKeyCandidates = paths.keys.get(target);
  if (exactKeyCandidates?.length) return exactKeyCandidates;
  return paths.stems.get(stripMarkdownExtension(target)) ?? [];
}
function suffixOrBasename(index, target, kind) {
  const stem = stripMarkdownExtension(target);
  const paths = index.paths[kind];
  return candidatesFrom(
    paths.suffixes.get(stem),
    ...stem.includes("/") ? [] : [paths.basenames.get(stem)]
  );
}
function titleOrAlias(index, target) {
  return index.names.get(target) ?? [];
}
function caseFoldedCandidates(index, sourceRelative, vaultRelative, kind, includeNames) {
  const sourceFolded = sourceRelative.toLocaleLowerCase("en-US");
  const vaultFolded = vaultRelative.toLocaleLowerCase("en-US");
  const stemFolded = stripMarkdownExtension(vaultRelative).toLocaleLowerCase("en-US");
  const basenameFolded = path7.posix.basename(stemFolded);
  const paths = index.foldedPaths[kind];
  return candidatesFrom(
    paths.keys.get(sourceFolded),
    paths.stems.get(stripMarkdownExtension(sourceFolded)),
    paths.keys.get(vaultFolded),
    paths.stems.get(stemFolded),
    paths.suffixes.get(stemFolded),
    ...stemFolded.includes("/") ? [] : [paths.basenames.get(basenameFolded)],
    ...includeNames ? [index.foldedNames.get(vaultFolded)] : []
  );
}
function resolveTarget(index, sourceKey, rawTarget, options = {}) {
  const target = normalizeVaultPath(rawTarget);
  const sourceRelative = normalizeVaultPath(path7.posix.join(path7.posix.dirname(sourceKey), target));
  const pathKind = options.pathKind ?? "source";
  for (const candidates of [
    exactPath(index, sourceRelative, pathKind),
    exactPath(index, target, pathKind),
    suffixOrBasename(index, target, pathKind),
    ...options.includeNames === false ? [] : [titleOrAlias(index, target)]
  ]) {
    const result = resultFor(candidates);
    if (result) return result;
  }
  return resultFor(
    caseFoldedCandidates(index, sourceRelative, target, pathKind, options.includeNames !== false)
  ) ?? {
    status: "unresolved"
  };
}
function diagnosticTarget(link) {
  if (link.heading) return `${link.target}#${link.heading}`;
  if (link.blockId) return `${link.target}#^${link.blockId}`;
  return link.target;
}
function unresolvedDiagnostic(sourcePath, link) {
  const rawTarget = diagnosticTarget(link);
  return {
    severity: "warning",
    code: "unresolved_wikilink",
    message: `Unresolved Obsidian reference ${JSON.stringify(rawTarget)} in ${sourcePath}.`,
    sourcePath,
    rawTarget
  };
}
function ambiguousDiagnostic(sourcePath, link, entries) {
  const rawTarget = diagnosticTarget(link);
  const candidates = entries.map((entry) => entry.sourceKey);
  return {
    severity: "warning",
    code: "ambiguous_wikilink",
    message: `Ambiguous Obsidian reference ${JSON.stringify(rawTarget)} in ${sourcePath}: ${candidates.join(", ")}.`,
    sourcePath,
    rawTarget,
    candidates
  };
}
function fragmentDiagnostic(sourcePath, link, targetPath) {
  const rawTarget = diagnosticTarget(link);
  return {
    severity: "warning",
    code: "missing_wikilink_fragment",
    message: `Missing fragment in Obsidian reference ${JSON.stringify(rawTarget)} from ${sourcePath} to ${targetPath}.`,
    sourcePath,
    rawTarget,
    candidates: [targetPath]
  };
}
function hasHeading(entry, heading) {
  const normalized = heading.trim().normalize("NFC");
  const slug = new GithubSlugger2().slug(normalized);
  return entry.headings.has(normalized) || entry.headings.has(slug);
}
function indexedHeadings(document) {
  const headings = new Set(
    document.headings.flatMap((heading) => [
      heading.text.normalize("NFC"),
      heading.slug.normalize("NFC")
    ])
  );
  if (!document.markdown.trim().match(/^#\s+/)) {
    const generatedTitle = document.title.trim().normalize("NFC");
    if (generatedTitle) {
      headings.add(generatedTitle);
      headings.add(new GithubSlugger2().slug(generatedTitle));
    }
  }
  return headings;
}
function resolveLink(entry, link, index, includeMarkdownFragments) {
  if (link.kind === "markdown") {
    if (!includeMarkdownFragments) return void 0;
    const hash = link.target.indexOf("#");
    if (hash < 0) return void 0;
    const target = link.target.slice(0, hash);
    const fragment = link.target.slice(hash + 1);
    if (!target || !fragment || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(target)) return void 0;
    const outputSourceKey = normalizeVaultPath(entry.document.outputPath ?? entry.sourceKey);
    const resolution2 = resolveTarget(index, outputSourceKey, target, {
      pathKind: "output",
      includeNames: false
    });
    if (resolution2.status !== "resolved") return void 0;
    const decodedFragment = decodeFragment(fragment).normalize("NFC");
    if (resolution2.entry.headings.has(decodedFragment) || resolution2.entry.blockIds.has(decodedFragment.replace(/^\^/, ""))) {
      return void 0;
    }
    return {
      severity: "warning",
      code: "missing_wikilink_fragment",
      message: `Missing fragment in Obsidian reference ${JSON.stringify(link.target)} from ${entry.sourceKey} to ${resolution2.entry.sourceKey}.`,
      sourcePath: entry.sourceKey,
      rawTarget: link.target,
      candidates: [resolution2.entry.sourceKey]
    };
  }
  if (link.kind !== "wikilink" && link.kind !== "note_embed") return void 0;
  const resolution = resolveTarget(index, entry.sourceKey, link.target || entry.sourceKey);
  if (resolution.status === "unresolved") {
    link.resolution = "unresolved";
    delete link.resolvedSourceKey;
    return unresolvedDiagnostic(entry.sourceKey, link);
  }
  if (resolution.status === "ambiguous") {
    link.resolution = "ambiguous";
    delete link.resolvedSourceKey;
    return ambiguousDiagnostic(entry.sourceKey, link, resolution.entries);
  }
  link.resolution = "resolved";
  link.resolvedSourceKey = resolution.entry.sourceKey;
  if (link.heading && !hasHeading(resolution.entry, link.heading)) {
    return fragmentDiagnostic(entry.sourceKey, link, resolution.entry.sourceKey);
  }
  if (link.blockId && !resolution.entry.blockIds.has(link.blockId.normalize("NFC"))) {
    return fragmentDiagnostic(entry.sourceKey, link, resolution.entry.sourceKey);
  }
  return void 0;
}
function entryFor(document) {
  const sourceKey = normalizeVaultPath(document.sourcePath ?? document.sourceId);
  if (!/\.(?:md|mdx)$/i.test(sourceKey)) return void 0;
  const outputKey = normalizeVaultPath(document.outputPath ?? "");
  const names = [document.title, ...document.aliases ?? []].map((name) => name.trim().normalize("NFC")).filter(Boolean);
  return {
    document,
    sourceKey,
    identityPaths: [
      { key: sourceKey, kind: "source" },
      ...outputKey ? [{ key: outputKey, kind: "output" }] : []
    ].map(({ key, kind }) => {
      const stem = stripMarkdownExtension(key);
      return { key, stem, basename: path7.posix.basename(stem), kind };
    }),
    names: [...new Set(names)].sort(compareText),
    headings: indexedHeadings(document),
    blockIds: new Set((document.blockIds ?? []).map((block) => block.id.normalize("NFC")))
  };
}
function compareDiagnostics(first, second) {
  return compareText(first.sourcePath, second.sourcePath) || compareText(first.rawTarget, second.rawTarget) || compareText(first.code, second.code) || compareText((first.candidates ?? []).join("\0"), (second.candidates ?? []).join("\0"));
}
function resolveVaultDocuments(documents, options = {}) {
  const entries = documents.map(entryFor).filter((entry) => Boolean(entry)).sort((a, b) => compareText(a.sourceKey, b.sourceKey));
  const index = buildVaultIndex(entries);
  const diagnostics = [];
  for (const entry of entries) {
    const documentDiagnostics = (entry.document.diagnostics ?? []).filter(
      (diagnostic) => !VAULT_DIAGNOSTIC_CODES.has(diagnostic.code)
    );
    for (const link of entry.document.semanticLinks ?? []) {
      const diagnostic = resolveLink(entry, link, index, Boolean(options.includeMarkdownFragments));
      if (diagnostic) documentDiagnostics.push(diagnostic);
    }
    documentDiagnostics.sort(compareDiagnostics);
    entry.document.diagnostics = documentDiagnostics;
    diagnostics.push(...documentDiagnostics);
  }
  const indexedDocuments = new Set(entries.map((entry) => entry.document));
  for (const document of documents) {
    if (indexedDocuments.has(document)) continue;
    diagnostics.push(
      ...(document.diagnostics ?? []).filter(
        (diagnostic) => !VAULT_DIAGNOSTIC_CODES.has(diagnostic.code)
      )
    );
  }
  return diagnostics.sort(compareDiagnostics);
}

// src/validate.ts
function issue(severity, code, message, file) {
  return { severity, code, message, path: file };
}
function firstContentLine(content) {
  return content.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "";
}
function validateIndexFile(raw, rel, issues) {
  let body = raw;
  if (hasFrontmatter(raw)) {
    if (rel !== "index.md") {
      issues.push(
        issue(
          "error",
          "reserved_index_frontmatter",
          "Only bundle-root index.md may contain okf_version frontmatter.",
          rel
        )
      );
      return;
    }
    let parsed;
    try {
      parsed = parseFrontmatter(raw);
    } catch (error) {
      issues.push(
        issue(
          "error",
          "malformed_frontmatter",
          error?.message ?? "Malformed YAML frontmatter.",
          rel
        )
      );
      return;
    }
    const keys = Object.keys(parsed.data);
    if (keys.length !== 1 || keys[0] !== "okf_version" || typeof parsed.data.okf_version !== "string") {
      issues.push(
        issue(
          "error",
          "reserved_index_frontmatter",
          "Root index.md frontmatter may contain only string okf_version.",
          rel
        )
      );
    }
    body = parsed.content;
  }
  const firstLine = firstContentLine(body);
  if (!firstLine.startsWith("# ")) {
    issues.push(
      issue(
        "error",
        "invalid_index_structure",
        "index.md must be a markdown directory listing headed by a section title.",
        rel
      )
    );
  }
}
function validateLogFile(raw, rel, issues) {
  if (hasFrontmatter(raw)) {
    issues.push(
      issue("error", "reserved_log_frontmatter", "log.md must not contain YAML frontmatter.", rel)
    );
    return;
  }
  const firstLine = firstContentLine(raw);
  if (!firstLine.startsWith("# ")) {
    issues.push(
      issue(
        "error",
        "invalid_log_structure",
        "log.md must be a markdown update log headed by a title.",
        rel
      )
    );
  }
  for (const line of raw.split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading && !/^\d{4}-\d{2}-\d{2}\b/.test(heading[1] ?? "")) {
      issues.push(
        issue("error", "invalid_log_date", "log.md date headings must use YYYY-MM-DD.", rel)
      );
    }
  }
}
function validateReservedFile(raw, rel, issues) {
  const name = path8.posix.basename(rel).toLowerCase();
  if (name === "index.md") validateIndexFile(raw, rel, issues);
  if (name === "log.md") validateLogFile(raw, rel, issues);
}
function conceptSourcePath(concept) {
  const resourcePath = concept.resource?.split(/[?#]/, 1)[0] ?? "";
  if (resourcePath && !/^[a-z][a-z0-9+.-]*:/i.test(resourcePath)) return resourcePath;
  return concept.path;
}
function semanticDocument(concept) {
  const sourcePath = conceptSourcePath(concept);
  const parsed = parseMarkdown(concept.body, { mdx: /\.mdx$/i.test(sourcePath) });
  return {
    sourceId: sourcePath,
    sourcePath,
    outputPath: concept.path,
    title: concept.title ?? path8.posix.basename(concept.path, path8.posix.extname(concept.path)),
    markdown: parsed.content,
    resource: concept.resource,
    headings: parsed.headings.map(({ depth, text, slug }) => ({ depth, text, slug })),
    links: parsed.markdownLinks,
    tags: concept.tags,
    type: concept.type,
    aliases: concept.aliases,
    semanticLinks: parsed.semanticLinks,
    blockIds: [...parsed.blockIds, ...parsed.htmlAnchors]
  };
}
function semanticValidation(concepts) {
  const documents = concepts.map(semanticDocument);
  const diagnostics = resolveVaultDocuments(documents, {
    includeMarkdownFragments: true
  });
  return {
    documents,
    issues: diagnostics.map((diagnostic) => ({
      severity: diagnostic.severity,
      code: diagnostic.code,
      message: diagnostic.message,
      path: diagnostic.sourcePath,
      rawTarget: diagnostic.rawTarget,
      ...diagnostic.candidates ? { candidates: diagnostic.candidates } : {}
    }))
  };
}
async function validateBundle(bundleDir) {
  const issues = [];
  let files = [];
  try {
    files = await listMarkdownFiles(bundleDir);
  } catch (error) {
    return {
      valid: false,
      issues: [issue("error", "bundle_unreadable", error?.message ?? "Bundle cannot be read.")],
      conceptCount: 0,
      reservedFileCount: 0,
      warningCount: 0
    };
  }
  const conceptFiles = files.filter(
    (file) => isConceptMarkdownPath(toPosixPath(path8.relative(bundleDir, file)))
  );
  const reservedFiles = files.filter(
    (file) => isReservedOkfPath(toPosixPath(path8.relative(bundleDir, file)))
  );
  for (const file of reservedFiles) {
    const rel = toPosixPath(path8.relative(bundleDir, file));
    const raw = await fs4.readFile(file, "utf8");
    validateReservedFile(raw, rel, issues);
  }
  for (const file of files) {
    const rel = toPosixPath(path8.relative(bundleDir, file));
    if (!isConceptMarkdownPath(rel)) continue;
    if (rel.includes("..") || path8.isAbsolute(rel)) {
      issues.push(issue("error", "unsafe_path", "Concept path is unsafe.", rel));
    }
    const raw = await fs4.readFile(file, "utf8");
    if (!hasFrontmatter(raw)) {
      issues.push(
        issue("error", "missing_frontmatter", "Concept file must start with YAML frontmatter.", rel)
      );
      continue;
    }
    let parsed;
    try {
      parsed = parseFrontmatter(raw);
    } catch (error) {
      issues.push(
        issue(
          "error",
          "malformed_frontmatter",
          error?.message ?? "Malformed YAML frontmatter.",
          rel
        )
      );
      continue;
    }
    const data = parsed.data;
    if (typeof data.type !== "string" || data.type.trim() === "") {
      issues.push(
        issue("error", "missing_type", "Frontmatter type must be a non-empty string.", rel)
      );
    }
    for (const key of ["title", "description", "resource", "timestamp"]) {
      if (data[key] !== void 0 && typeof data[key] !== "string") {
        issues.push(
          issue("warning", "bad_field_shape", `${key} should be a string when present.`, rel)
        );
      }
    }
    if (data.tags !== void 0 && (!Array.isArray(data.tags) || data.tags.some((tag) => typeof tag !== "string"))) {
      issues.push(
        issue("warning", "bad_field_shape", "tags should be an array of strings when present.", rel)
      );
    }
  }
  const concepts = await readBundle(bundleDir).catch(() => /* @__PURE__ */ new Map());
  const canonicalConcepts = [
    ...new Map([...concepts.values()].map((concept) => [concept.id, concept])).values()
  ].sort((first, second) => first.id.localeCompare(second.id));
  const semantic = semanticValidation(canonicalConcepts);
  issues.push(...semantic.issues);
  const canonicalIds = new Set(canonicalConcepts.map((concept) => concept.id));
  for (const [index, concept] of canonicalConcepts.entries()) {
    for (const target of internalLinksFromSemantics(
      concept.path,
      semantic.documents[index]?.semanticLinks ?? []
    )) {
      if (!canonicalIds.has(target)) {
        issues.push(
          issue(
            "warning",
            "broken_internal_link",
            `Broken internal link to ${target}.`,
            concept.path
          )
        );
      }
    }
  }
  const dirs = new Set(conceptFiles.map((file) => path8.dirname(file)));
  for (const dir of dirs) {
    const index = path8.join(dir, "index.md");
    if (!files.includes(index)) {
      issues.push(
        issue(
          "warning",
          "missing_folder_index",
          "Folder has concepts but no index.md.",
          toPosixPath(path8.relative(bundleDir, dir)) || "."
        )
      );
    }
  }
  return {
    valid: !issues.some((item) => item.severity === "error"),
    issues,
    conceptCount: conceptFiles.length,
    reservedFileCount: reservedFiles.length,
    warningCount: issues.filter((item) => item.severity === "warning").length
  };
}
async function inspectBundle(bundleDir) {
  const conceptsByAnyKey = await readBundle(bundleDir);
  const graph = buildGraph(conceptsByAnyKey);
  const concepts = [...graph.concepts.values()];
  const typeDistribution = {};
  const tagDistribution = {};
  const sourceDomains = {};
  for (const concept of concepts) {
    typeDistribution[concept.type] = (typeDistribution[concept.type] ?? 0) + 1;
    for (const tag of concept.tags) tagDistribution[tag] = (tagDistribution[tag] ?? 0) + 1;
    if (concept.resource?.startsWith("http")) {
      const domain = new URL(concept.resource).hostname;
      sourceDomains[domain] = (sourceDomains[domain] ?? 0) + 1;
    }
  }
  const topLinkedConcepts = concepts.map((concept) => ({
    id: concept.id,
    title: concept.title,
    count: (graph.backlinks.get(concept.id) ?? []).length
  })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id)).slice(0, 10);
  const linkCount = [...graph.outbound.values()].reduce((sum, links) => sum + links.length, 0);
  const validation = await validateBundle(bundleDir);
  return {
    title: path8.basename(bundleDir),
    conceptCount: concepts.length,
    reservedFileCount: validation.reservedFileCount,
    warningCount: validation.warningCount,
    typeDistribution,
    tagDistribution,
    linkCount,
    brokenLinks: validation.issues.filter((item) => item.code === "broken_internal_link").length,
    orphanConcepts: concepts.filter((concept) => concept.id !== "index").filter((concept) => (graph.backlinks.get(concept.id) ?? []).length === 0).map((concept) => concept.id).sort(),
    topLinkedConcepts,
    sourceDomains
  };
}

// src/source-store.ts
import fs5 from "fs/promises";
import { randomUUID } from "crypto";
import path10 from "path";

// src/okfy-home.ts
import os from "os";
import path9 from "path";
function resolveOkfyHome(options = {}) {
  const configured = options.okfyHome ?? options.env?.OKFY_HOME ?? process.env.OKFY_HOME;
  if (configured && configured.trim() !== "") return path9.resolve(configured);
  return path9.join(os.homedir(), ".okfy");
}

// src/source-store.ts
var SOURCE_NAME_PATTERN = /^[a-z0-9._-]+$/;
var MANIFEST_KEYS = [
  "schemaVersion",
  "okfyVersion",
  "name",
  "kind",
  "createdAt",
  "updatedAt",
  "source",
  "crawl",
  "refresh",
  "bundle"
];
var CRAWL_KEYS = [
  "maxPages",
  "maxDepth",
  "include",
  "exclude",
  "sameOrigin",
  "respectRobots",
  "concurrency",
  "allowPrivateNetwork"
];
var REFRESH_KEYS = ["mode", "maxAgeSeconds", "minIntervalSeconds"];
var STATE_KEYS = [
  "schemaVersion",
  "status",
  "lastCheckedAt",
  "lastRefreshStartedAt",
  "lastRefreshCompletedAt",
  "lastSuccessfulRefreshAt",
  "nextRefreshAllowedAt",
  "refreshInProgress",
  "lastError",
  "bundle"
];
var STATE_BUNDLE_KEYS = ["conceptCount", "warningCount", "valid", "contentHash"];
function resolveOkfyHome2(options = {}) {
  return resolveOkfyHome(options);
}
function validateSourceName(name) {
  if (!name || name === "." || name === ".." || !SOURCE_NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid source name "${name}". Use lowercase letters, numbers, dash, underscore, or dot without path separators.`
    );
  }
  return name;
}
function resolveSourceDir(name, options = {}) {
  const safeName = validateSourceName(name);
  const sourcesRoot = resolveSourcesRoot(options);
  const sourceDir = path10.resolve(sourcesRoot, safeName);
  if (!isInsideOrEqual(sourcesRoot, sourceDir)) {
    throw new Error(`Invalid source name "${name}". Source directory escapes OKFY_HOME.`);
  }
  return sourceDir;
}
function resolveBundleDir(manifest, options = {}) {
  const sourceDir = resolveSourceDir(manifest.name, options);
  const bundleDir = manifest.bundle.dir;
  if (!bundleDir || bundleDir.trim() === "") {
    throw new Error(`Invalid bundle directory for source "${manifest.name}".`);
  }
  if (path10.isAbsolute(bundleDir)) return path10.normalize(bundleDir);
  const resolved = path10.resolve(sourceDir, bundleDir);
  if (resolved === sourceDir || !isInsideOrEqual(sourceDir, resolved)) {
    throw new Error(
      `Invalid bundle directory for source "${manifest.name}". Relative bundle paths must stay inside the source directory.`
    );
  }
  return resolved;
}
async function writeSourceManifest(manifest, options = {}) {
  const sourceDir = resolveSourceDir(manifest.name, options);
  await writeStableJson(path10.join(sourceDir, "source.json"), manifest);
}
async function readSourceManifest(name, options = {}) {
  const sourceDir = resolveSourceDir(name, options);
  const manifest = validateSourceManifest(
    await readJson(path10.join(sourceDir, "source.json")),
    name
  );
  if (manifest.name !== name) {
    throw new Error(`Source manifest name mismatch: expected "${name}", found "${manifest.name}".`);
  }
  return manifest;
}
async function writeRefreshState(name, state, options = {}) {
  const sourceDir = resolveSourceDir(name, options);
  await writeStableJson(path10.join(sourceDir, "state.json"), state);
}
async function readRefreshState(name, options = {}) {
  const sourceDir = resolveSourceDir(name, options);
  return validateRefreshState(await readJson(path10.join(sourceDir, "state.json")), name);
}
async function readSourceRecord(name, options = {}) {
  const manifest = await readSourceManifest(name, options);
  return sourceRecordFromManifest(manifest, options);
}
async function sourceRecordFromManifest(manifest, options = {}) {
  const dir = resolveSourceDir(manifest.name, options);
  let state;
  let loadError;
  try {
    state = await readRefreshStateIfExists(manifest.name, options);
  } catch (error) {
    loadError = errorDetails(error);
  }
  let bundleDir;
  try {
    bundleDir = resolveBundleDir(manifest, options);
  } catch (error) {
    bundleDir = path10.join(dir, "bundle");
    loadError ??= errorDetails(error);
  }
  return {
    name: manifest.name,
    dir,
    manifest,
    state,
    bundleDir,
    loadError
  };
}
async function listSources(options = {}) {
  const sourcesRoot = resolveSourcesRoot(options);
  let entries;
  try {
    entries = await fs5.readdir(sourcesRoot, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return [];
    throw error;
  }
  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    let manifest;
    try {
      manifest = await readSourceManifest(entry.name, options);
    } catch (error) {
      records.push(invalidSourceRecord(sourcesRoot, entry.name, error));
      continue;
    }
    records.push(await sourceRecordFromManifest(manifest, options));
  }
  return records.sort((first, second) => first.name.localeCompare(second.name));
}
async function removeSource(name, options = {}) {
  const sourceDir = resolveSourceDir(name, options);
  await fs5.rm(sourceDir, { recursive: true, force: true });
}
function resolveSourcesRoot(options) {
  return path10.join(resolveOkfyHome2(options), "sources");
}
function invalidSourceRecord(sourcesRoot, name, error) {
  const dir = path10.join(sourcesRoot, name);
  const sourceName = fallbackSourceName(name);
  return {
    name: sourceName,
    dir,
    manifest: fallbackSourceManifest(sourceName),
    bundleDir: path10.join(dir, "bundle"),
    loadError: errorDetails(error, name)
  };
}
function fallbackSourceManifest(name) {
  const timestamp = "1970-01-01T00:00:00.000Z";
  return {
    schemaVersion: 1,
    okfyVersion: "unknown",
    name,
    kind: "website",
    createdAt: timestamp,
    updatedAt: timestamp,
    source: {
      seedUrl: ""
    },
    crawl: {
      maxPages: 0,
      maxDepth: 0,
      include: [],
      exclude: [],
      sameOrigin: true,
      respectRobots: true,
      concurrency: 1,
      allowPrivateNetwork: false
    },
    refresh: {
      mode: "off",
      maxAgeSeconds: 0,
      minIntervalSeconds: 0
    },
    bundle: {
      dir: "bundle"
    }
  };
}
function fallbackSourceName(name) {
  try {
    return validateSourceName(name);
  } catch {
    const slug = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
    return `invalid-${shortHash(name)}${slug ? `-${slug}` : ""}`;
  }
}
function shortHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}
function errorDetails(error, sourceDirName) {
  const withSourceDir = (details) => ({
    ...details,
    ...sourceDirName && sourceDirName !== fallbackSourceName(sourceDirName) ? { sourceDirName } : {}
  });
  if (error instanceof Error) {
    const details = { message: error.message };
    if (isNodeError(error) && error.code) details.code = error.code;
    return withSourceDir(details);
  }
  return withSourceDir({ message: String(error) });
}
function validateSourceManifest(value, expectedName) {
  if (!isPlainObject(value))
    throw new Error(`Invalid source manifest for "${expectedName}": expected object.`);
  const name = requiredString(value, "name", expectedName);
  validateSourceName(name);
  if (value.schemaVersion !== 1) {
    throw new Error(`Invalid source manifest for "${expectedName}": schemaVersion must be 1.`);
  }
  if (value.kind !== "website") {
    throw new Error(`Invalid source manifest for "${expectedName}": kind must be "website".`);
  }
  const source = requiredObject(value, "source", expectedName);
  const crawl = requiredObject(value, "crawl", expectedName);
  const refresh = requiredObject(value, "refresh", expectedName);
  const bundle = requiredObject(value, "bundle", expectedName);
  const mode = requiredString(refresh, "mode", expectedName, "refresh");
  if (!["off", "stale-while-refresh", "blocking"].includes(mode)) {
    throw new Error(`Invalid source manifest for "${expectedName}": refresh.mode is invalid.`);
  }
  return {
    schemaVersion: 1,
    okfyVersion: requiredString(value, "okfyVersion", expectedName),
    name,
    kind: "website",
    createdAt: requiredString(value, "createdAt", expectedName),
    updatedAt: requiredString(value, "updatedAt", expectedName),
    source: {
      seedUrl: requiredString(source, "seedUrl", expectedName, "source")
    },
    crawl: {
      maxPages: requiredNumber(crawl, "maxPages", expectedName, "crawl"),
      maxDepth: requiredNumber(crawl, "maxDepth", expectedName, "crawl"),
      include: requiredStringArray(crawl, "include", expectedName, "crawl"),
      exclude: requiredStringArray(crawl, "exclude", expectedName, "crawl"),
      sameOrigin: requiredBoolean(crawl, "sameOrigin", expectedName, "crawl"),
      respectRobots: requiredBoolean(crawl, "respectRobots", expectedName, "crawl"),
      concurrency: requiredNumber(crawl, "concurrency", expectedName, "crawl"),
      allowPrivateNetwork: requiredBoolean(crawl, "allowPrivateNetwork", expectedName, "crawl")
    },
    refresh: {
      mode,
      maxAgeSeconds: requiredNumber(refresh, "maxAgeSeconds", expectedName, "refresh"),
      minIntervalSeconds: requiredNumber(refresh, "minIntervalSeconds", expectedName, "refresh")
    },
    bundle: {
      dir: requiredString(bundle, "dir", expectedName, "bundle")
    }
  };
}
function validateRefreshState(value, sourceName) {
  if (!isPlainObject(value))
    throw new Error(`Invalid refresh state for "${sourceName}": expected object.`);
  if (value.schemaVersion !== 1) {
    throw new Error(`Invalid refresh state for "${sourceName}": schemaVersion must be 1.`);
  }
  const status = stateString(value, "status", sourceName);
  if (!["missing", "fresh", "stale", "refreshing", "failed"].includes(status)) {
    throw new Error(`Invalid refresh state for "${sourceName}": status is invalid.`);
  }
  return {
    schemaVersion: 1,
    status,
    lastCheckedAt: stateNullableString(value, "lastCheckedAt", sourceName),
    lastRefreshStartedAt: stateNullableString(value, "lastRefreshStartedAt", sourceName),
    lastRefreshCompletedAt: stateNullableString(value, "lastRefreshCompletedAt", sourceName),
    lastSuccessfulRefreshAt: stateNullableString(value, "lastSuccessfulRefreshAt", sourceName),
    nextRefreshAllowedAt: stateNullableString(value, "nextRefreshAllowedAt", sourceName),
    refreshInProgress: stateBoolean(value, "refreshInProgress", sourceName),
    lastError: validateRefreshError(value.lastError, sourceName),
    bundle: validateRefreshBundle(value.bundle, sourceName)
  };
}
function validateRefreshError(value, sourceName) {
  if (value === null) return null;
  if (!isPlainObject(value))
    throw new Error(`Invalid refresh state for "${sourceName}": lastError must be object or null.`);
  const details = {
    ...value,
    message: stateString(value, "message", sourceName, "lastError")
  };
  for (const key of ["code", "sourceName", "seedUrl", "occurredAt"]) {
    const found = value[key];
    if (found !== void 0 && typeof found !== "string") {
      throw invalidStateField(sourceName, key, "string", "lastError");
    }
  }
  return details;
}
function validateRefreshBundle(value, sourceName) {
  if (value === null) return null;
  if (!isPlainObject(value))
    throw new Error(`Invalid refresh state for "${sourceName}": bundle must be object or null.`);
  return {
    conceptCount: stateNumber(value, "conceptCount", sourceName, "bundle"),
    warningCount: stateNumber(value, "warningCount", sourceName, "bundle"),
    valid: stateBoolean(value, "valid", sourceName, "bundle"),
    contentHash: stateString(value, "contentHash", sourceName, "bundle")
  };
}
function requiredObject(value, key, sourceName, prefix) {
  const found = value[key];
  if (!isPlainObject(found)) throw invalidManifestField(sourceName, key, "object", prefix);
  return found;
}
function requiredString(value, key, sourceName, prefix) {
  const found = value[key];
  if (typeof found !== "string" || found.trim() === "") {
    throw invalidManifestField(sourceName, key, "non-empty string", prefix);
  }
  return found;
}
function requiredNumber(value, key, sourceName, prefix) {
  const found = value[key];
  if (typeof found !== "number" || !Number.isFinite(found)) {
    throw invalidManifestField(sourceName, key, "number", prefix);
  }
  return found;
}
function requiredBoolean(value, key, sourceName, prefix) {
  const found = value[key];
  if (typeof found !== "boolean") throw invalidManifestField(sourceName, key, "boolean", prefix);
  return found;
}
function requiredStringArray(value, key, sourceName, prefix) {
  const found = value[key];
  if (!Array.isArray(found) || !found.every((item) => typeof item === "string")) {
    throw invalidManifestField(sourceName, key, "string array", prefix);
  }
  return found;
}
function invalidManifestField(sourceName, key, expected, prefix) {
  return new Error(
    `Invalid source manifest for "${sourceName}": ${prefix ? `${prefix}.` : ""}${key} must be ${expected}.`
  );
}
function stateString(value, key, sourceName, prefix) {
  const found = value[key];
  if (typeof found !== "string" || found.trim() === "") {
    throw invalidStateField(sourceName, key, "non-empty string", prefix);
  }
  return found;
}
function stateNullableString(value, key, sourceName) {
  const found = value[key];
  if (found === null) return null;
  if (typeof found !== "string" || found.trim() === "") {
    throw invalidStateField(sourceName, key, "string or null");
  }
  return found;
}
function stateNumber(value, key, sourceName, prefix) {
  const found = value[key];
  if (typeof found !== "number" || !Number.isFinite(found)) {
    throw invalidStateField(sourceName, key, "number", prefix);
  }
  return found;
}
function stateBoolean(value, key, sourceName, prefix) {
  const found = value[key];
  if (typeof found !== "boolean") throw invalidStateField(sourceName, key, "boolean", prefix);
  return found;
}
function invalidStateField(sourceName, key, expected, prefix) {
  return new Error(
    `Invalid refresh state for "${sourceName}": ${prefix ? `${prefix}.` : ""}${key} must be ${expected}.`
  );
}
async function readRefreshStateIfExists(name, options) {
  try {
    return await readRefreshState(name, options);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return void 0;
    throw error;
  }
}
async function readJson(filePath) {
  return JSON.parse(await fs5.readFile(filePath, "utf8"));
}
async function writeStableJson(filePath, value) {
  const dir = path10.dirname(filePath);
  const tempPath = path10.join(
    dir,
    `.${path10.basename(filePath)}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  );
  await fs5.mkdir(dir, { recursive: true });
  try {
    await fs5.writeFile(tempPath, `${JSON.stringify(orderJson(value), null, 2)}
`, "utf8");
    await fs5.rename(tempPath, filePath);
  } catch (error) {
    await fs5.rm(tempPath, { force: true });
    throw error;
  }
}
function orderJson(value) {
  if (Array.isArray(value)) return value.map(orderJson);
  if (!isPlainObject(value)) return value;
  const ordered = {};
  for (const key of orderKeys(value)) {
    ordered[key] = orderJson(value[key]);
  }
  return ordered;
}
function orderKeys(value) {
  const keys = Object.keys(value);
  if ("status" in value) return sortByPreferredOrder(keys, STATE_KEYS);
  if ("okfyVersion" in value) return sortByPreferredOrder(keys, MANIFEST_KEYS);
  if (hasKeys(value, CRAWL_KEYS)) return sortByPreferredOrder(keys, CRAWL_KEYS);
  if (hasKeys(value, REFRESH_KEYS)) return sortByPreferredOrder(keys, REFRESH_KEYS);
  if (hasKeys(value, STATE_BUNDLE_KEYS)) return sortByPreferredOrder(keys, STATE_BUNDLE_KEYS);
  if ("seedUrl" in value) return sortByPreferredOrder(keys, ["seedUrl"]);
  if ("dir" in value) return sortByPreferredOrder(keys, ["dir"]);
  return keys.sort((first, second) => first.localeCompare(second));
}
function hasKeys(value, keys) {
  return keys.some((key) => key in value);
}
function sortByPreferredOrder(keys, preferredOrder) {
  const preferredIndexes = new Map(preferredOrder.map((key, index) => [key, index]));
  return keys.sort((first, second) => {
    const firstIndex = preferredIndexes.get(first);
    const secondIndex = preferredIndexes.get(second);
    if (firstIndex === void 0 && secondIndex === void 0) return first.localeCompare(second);
    if (firstIndex === void 0) return 1;
    if (secondIndex === void 0) return -1;
    return firstIndex - secondIndex;
  });
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isInsideOrEqual(parent, child) {
  const relative = path10.relative(parent, child);
  return relative === "" || !relative.startsWith("..") && !path10.isAbsolute(relative);
}
function isNodeError(error) {
  return error instanceof Error && "code" in error;
}

// src/mcp-contract.ts
import { z } from "zod";
var MCP_TOOL_NAMES = [
  "search_concepts",
  "read_concept",
  "get_neighbors",
  "list_types",
  "list_tags",
  "bundle_summary"
];
var [
  SEARCH_CONCEPTS_TOOL,
  READ_CONCEPT_TOOL,
  GET_NEIGHBORS_TOOL,
  LIST_TYPES_TOOL,
  LIST_TAGS_TOOL,
  BUNDLE_SUMMARY_TOOL
] = MCP_TOOL_NAMES;
var REFRESHABLE_TOOL_NAMES = new Set(
  MCP_TOOL_NAMES.filter((tool) => tool !== BUNDLE_SUMMARY_TOOL)
);
function refreshableTool(name) {
  return REFRESHABLE_TOOL_NAMES.has(name);
}
var searchSchema = z.object({
  query: z.string(),
  type: z.string().optional(),
  tags: z.array(z.string()).optional(),
  limit: z.number().int().positive().max(50).optional()
});
var readSchema = z.object({
  id: z.string(),
  max_chars: z.number().int().positive().optional()
});
var neighborsSchema = z.object({
  id: z.string(),
  depth: z.number().int().min(1).max(2).optional()
});
var sourceFilterSchema = z.object({ source: z.string().optional() });
var workspaceSearchSchema = searchSchema.extend({ source: z.string().optional() });
var workspaceReadSchema = readSchema.extend({ source: z.string().optional() });
var workspaceNeighborsSchema = neighborsSchema.extend({ source: z.string().optional() });
var stringInputProperty = { type: "string" };
var sourceInputProperty = { type: "string" };
var tagsInputProperty = { type: "array", items: { type: "string" } };
var limitInputProperty = { type: "integer", minimum: 1, maximum: 50, default: 10 };
var maxCharsInputProperty = { type: "integer", minimum: 1 };
var depthInputProperty = { type: "integer", minimum: 1, maximum: 2, default: 1 };
function withOptionalSourceInputSchema(schema, sourcePosition = "first") {
  if (sourcePosition === "afterQuery" && "query" in schema.properties) {
    const { query, ...properties } = schema.properties;
    return { ...schema, properties: { query, source: sourceInputProperty, ...properties } };
  }
  return { ...schema, properties: { source: sourceInputProperty, ...schema.properties } };
}
var searchInputSchema = {
  type: "object",
  properties: {
    query: stringInputProperty,
    type: stringInputProperty,
    tags: tagsInputProperty,
    limit: limitInputProperty
  },
  required: ["query"]
};
var readInputSchema = {
  type: "object",
  properties: { id: stringInputProperty, max_chars: maxCharsInputProperty },
  required: ["id"]
};
var neighborsInputSchema = {
  type: "object",
  properties: {
    id: stringInputProperty,
    depth: depthInputProperty
  },
  required: ["id"]
};
var sourceFilterInputSchema = {
  type: "object",
  properties: { source: sourceInputProperty }
};
var workspaceSearchInputSchema = withOptionalSourceInputSchema(searchInputSchema, "afterQuery");
var workspaceReadInputSchema = withOptionalSourceInputSchema(readInputSchema);
var workspaceNeighborsInputSchema = withOptionalSourceInputSchema(neighborsInputSchema);
function mcpToolDefinitions(mode) {
  if (mode === "bundle") {
    return [
      {
        name: SEARCH_CONCEPTS_TOOL,
        description: "Search OKF concepts by query, type, and tags.",
        inputSchema: searchInputSchema
      },
      {
        name: READ_CONCEPT_TOOL,
        description: "Read one OKF concept by id or path.",
        inputSchema: readInputSchema
      },
      {
        name: GET_NEIGHBORS_TOOL,
        description: "Return outbound links and backlinks for a concept.",
        inputSchema: neighborsInputSchema
      },
      {
        name: LIST_TYPES_TOOL,
        description: "List concept types and counts.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: LIST_TAGS_TOOL,
        description: "List concept tags and counts.",
        inputSchema: { type: "object", properties: {} }
      },
      {
        name: BUNDLE_SUMMARY_TOOL,
        description: "Return bundle stats and validation status.",
        inputSchema: { type: "object", properties: {} }
      }
    ];
  }
  return [
    {
      name: SEARCH_CONCEPTS_TOOL,
      description: "Search workspace OKF concepts by query, source, type, and tags.",
      inputSchema: workspaceSearchInputSchema
    },
    {
      name: READ_CONCEPT_TOOL,
      description: "Read one workspace OKF concept by source and id. Id-only reads work when the id is unique.",
      inputSchema: workspaceReadInputSchema
    },
    {
      name: GET_NEIGHBORS_TOOL,
      description: "Return outbound links and backlinks for a workspace concept.",
      inputSchema: workspaceNeighborsInputSchema
    },
    {
      name: LIST_TYPES_TOOL,
      description: "List workspace concept types and counts.",
      inputSchema: sourceFilterInputSchema
    },
    {
      name: LIST_TAGS_TOOL,
      description: "List workspace concept tags and counts.",
      inputSchema: sourceFilterInputSchema
    },
    {
      name: BUNDLE_SUMMARY_TOOL,
      description: "Return workspace stats, per-source validation, and freshness status.",
      inputSchema: sourceFilterInputSchema
    }
  ];
}

// src/search.ts
import MiniSearch from "minisearch";
function snippet(concept, query, max = 240) {
  const text = `${concept.description ?? ""} ${concept.body}`.replace(/\s+/g, " ").trim();
  const lower = text.toLowerCase();
  const term = query.toLowerCase().split(/\s+/).find(Boolean) ?? "";
  const index = term ? lower.indexOf(term) : -1;
  const start = Math.max(0, index - 80);
  return text.slice(start, start + max);
}
var STOPWORDS = /* @__PURE__ */ new Set([
  "about",
  "after",
  "and",
  "are",
  "can",
  "could",
  "does",
  "for",
  "from",
  "had",
  "has",
  "have",
  "how",
  "into",
  "onto",
  "should",
  "that",
  "the",
  "their",
  "there",
  "this",
  "what",
  "when",
  "where",
  "who",
  "why",
  "with",
  "would",
  "you",
  "your"
]);
function meaningfulQueryTerms(query) {
  const terms = /* @__PURE__ */ new Set();
  for (const token of query.match(/[A-Za-z0-9]+/g) ?? []) {
    const normalized = token.toLowerCase();
    const isAcronym = normalized.length >= 2 && ["api", "cli", "mcp", "okf", "sdk"].includes(normalized);
    if ((normalized.length >= 4 || isAcronym) && !STOPWORDS.has(normalized)) {
      terms.add(normalized);
    }
  }
  return terms;
}
function matchesMeaningfulQueryTerm(hit, terms) {
  if (terms.size === 0) return false;
  return (hit.queryTerms ?? []).some((term) => terms.has(term.toLowerCase()));
}
var BundleSearch = class _BundleSearch {
  graph;
  index;
  constructor(conceptsByAnyKey) {
    this.graph = buildGraph(conceptsByAnyKey);
    this.index = new MiniSearch({
      fields: ["title", "description", "tags", "type", "body"],
      storeFields: ["id"],
      searchOptions: {
        boost: { title: 4, tags: 3, type: 2, description: 2 },
        fuzzy: 0.2,
        prefix: true
      }
    });
    this.index.addAll(
      [...this.graph.concepts.values()].map((concept) => ({
        id: concept.id,
        title: concept.title ?? concept.id,
        type: concept.type,
        description: concept.description ?? "",
        tags: concept.tags.join(" "),
        body: concept.body
      }))
    );
  }
  static async fromBundle(bundleDir) {
    return new _BundleSearch(await readBundle(bundleDir));
  }
  search(query, options = {}) {
    const limit = options.limit ?? 10;
    const trimmedQuery = query.trim();
    const strict = this.resultsForHits(
      this.index.search(trimmedQuery || MiniSearch.wildcard, { combineWith: "AND" }).slice(0, 100),
      query,
      options
    );
    if (!trimmedQuery || strict.length > 0 || trimmedQuery.split(/\s+/).length < 2)
      return strict.slice(0, limit);
    const fallbackTerms = meaningfulQueryTerms(trimmedQuery);
    const fallback = this.resultsForHits(
      this.index.search(trimmedQuery, { combineWith: "OR" }).filter((hit) => matchesMeaningfulQueryTerm(hit, fallbackTerms)).slice(0, 100),
      query,
      options
    );
    return fallback.slice(0, limit);
  }
  resultsForHits(hits, query, options) {
    const tagFilter = new Set(options.tags ?? []);
    return hits.map((hit) => ({ hit, concept: this.graph.concepts.get(hit.id) })).filter(
      (row) => Boolean(row.concept)
    ).filter(({ concept }) => !options.type || concept.type === options.type).filter(
      ({ concept }) => tagFilter.size === 0 || concept.tags.some((tag) => tagFilter.has(tag))
    ).map(({ hit, concept }) => ({
      id: concept.id,
      title: concept.title,
      type: concept.type,
      description: concept.description,
      tags: concept.tags,
      resource: concept.resource,
      snippet: snippet(concept, query),
      score: hit.score
    }));
  }
  getConcept(idOrPath) {
    const id = idOrPath.replace(/\.md$/i, "");
    return this.graph.concepts.get(id) ?? [...this.graph.concepts.values()].find((concept) => concept.path === idOrPath);
  }
};

// src/workspace.ts
import fs6 from "fs/promises";
import path11 from "path";
import { pathToFileURL } from "url";
function bundleSourceName(bundleDir) {
  const baseName = path11.basename(path11.resolve(bundleDir));
  const candidate = baseName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "");
  return validateSourceName(candidate || "bundle");
}
function localBundleRecord(bundleDir) {
  const resolved = path11.resolve(bundleDir);
  const name = bundleSourceName(resolved);
  const timestamp = "1970-01-01T00:00:00.000Z";
  return {
    name,
    dir: resolved,
    bundleDir: resolved,
    manifest: {
      schemaVersion: 1,
      okfyVersion: packageVersion(),
      name,
      kind: "local",
      createdAt: timestamp,
      updatedAt: timestamp,
      source: {
        seedUrl: pathToFileURL(resolved).href
      },
      crawl: {
        maxPages: 0,
        maxDepth: 0,
        include: [],
        exclude: [],
        sameOrigin: true,
        respectRobots: true,
        concurrency: 1,
        allowPrivateNetwork: false
      },
      refresh: {
        mode: "off",
        maxAgeSeconds: 0,
        minIntervalSeconds: 0
      },
      bundle: {
        dir: resolved
      }
    }
  };
}
function assertUniqueWorkspaceRecordNames(records) {
  const seen = /* @__PURE__ */ new Set();
  for (const record of records) {
    if (seen.has(record.name))
      throw new Error(
        `Duplicate workspace source "${record.name}". Rename one bundle directory or source.`
      );
    seen.add(record.name);
  }
}
function isRegisteredWorkspaceRecord(record) {
  return record.manifest.kind === "website";
}
var WorkspaceError = class extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
  code;
  details;
  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...this.details
    };
  }
};
function workspaceProfilePath(name, options = {}) {
  return path11.join(resolveOkfyHome2(options), "workspaces", `${validateSourceName(name)}.json`);
}
async function readWorkspaceProfile(name, options = {}) {
  const profile = JSON.parse(
    await fs6.readFile(workspaceProfilePath(name, options), "utf8")
  );
  validateWorkspaceProfile(profile, name);
  return profile;
}
async function writeWorkspaceProfile(profile, options = {}) {
  validateWorkspaceProfile(profile);
  const filePath = workspaceProfilePath(profile.name, options);
  await fs6.mkdir(path11.dirname(filePath), { recursive: true });
  await fs6.writeFile(filePath, `${JSON.stringify(profile, null, 2)}
`, "utf8");
}
async function resolveWorkspaceSources(selection, options = {}) {
  const hasNames = Boolean(selection.names?.length);
  const modeCount = Number(hasNames) + Number(Boolean(selection.all)) + Number(Boolean(selection.profile)) + Number(Boolean(selection.profileName));
  if (modeCount > 1) {
    throw new Error(
      "Choose one workspace source selection: explicit source names, --all, or one workspace profile."
    );
  }
  let names = selection.names ?? [];
  let workspaceName;
  if (selection.profileName) {
    const profile = await readWorkspaceProfile(selection.profileName, options);
    names = profile.sources;
    workspaceName = profile.name;
  } else if (selection.profile) {
    validateWorkspaceProfile(selection.profile);
    names = selection.profile.sources;
    workspaceName = selection.profile.name;
  }
  if (selection.all) {
    const records2 = await listSources(options);
    if (!records2.length)
      throw new WorkspaceError("no_sources", "No registered sources found for --all.");
    return { records: records2, sourceNames: records2.map((record) => record.name) };
  }
  if (!names.length)
    throw new WorkspaceError("no_sources", "Select at least one registered source.");
  assertUniqueSourceNames(names);
  const records = await Promise.all(names.map((name) => readSourceRecord(name, options)));
  return { records, sourceNames: records.map((record) => record.name), workspaceName };
}
var WorkspaceSearch = class _WorkspaceSearch {
  sources;
  selectedNames;
  availableNames;
  constructor(sources, options = {}) {
    if (!sources.length) throw new WorkspaceError("no_sources", "Workspace contains no sources.");
    assertUniqueSourceNames(sources.map((source) => source.record.name));
    this.sources = [...sources];
    this.selectedNames = new Set(sources.map((source) => source.record.name));
    this.availableNames = /* @__PURE__ */ new Set([...options.availableSourceNames ?? [], ...this.selectedNames]);
  }
  static async fromSourceRecords(records, options = {}) {
    const sources = await Promise.all(
      records.map(async (record) => ({
        record,
        bundleDir: record.bundleDir,
        search: await BundleSearch.fromBundle(record.bundleDir)
      }))
    );
    return new _WorkspaceSearch(sources, options);
  }
  search(query, options = {}) {
    const limit = options.limit ?? 10;
    const sources = this.usableSources(options.source);
    return sources.flatMap(
      (source) => source.search.search(query, { type: options.type, tags: options.tags, limit: Math.max(limit, 50) }).map((result) => this.withSourceResult(source, result))
    ).sort(
      (first, second) => second.score - first.score || first.sourceName.localeCompare(second.sourceName) || first.id.localeCompare(second.id)
    ).slice(0, limit);
  }
  getConcept(input) {
    const sources = input.source ? this.usableSources(input.source) : this.sourcesWithSearch();
    const matches = sources.map((source) => ({ source, concept: source.search.getConcept(input.id) })).filter(
      (row) => Boolean(row.concept)
    );
    if (matches.length === 0) {
      throw new WorkspaceError("unknown_concept", `No concept found for ${input.id}`, {
        id: input.id,
        source: input.source
      });
    }
    if (!input.source && matches.length > 1) {
      throw new WorkspaceError(
        "ambiguous_concept",
        `Concept id "${input.id}" exists in multiple workspace sources.`,
        {
          id: input.id,
          candidates: matches.map(({ source, concept }) => this.conceptCandidate(source, concept))
        }
      );
    }
    return matches[0];
  }
  listTypes(source) {
    return this.distribution(source, (concept) => [concept.type]);
  }
  listTags(source) {
    return this.distribution(source, (concept) => concept.tags);
  }
  sourceNames() {
    return this.sources.map((source) => source.record.name);
  }
  usableSourceNames() {
    return this.sourcesWithSearch().map((source) => source.record.name);
  }
  distribution(sourceName, values) {
    const distribution = {};
    for (const source of this.usableSources(sourceName)) {
      for (const concept of source.search.graph.concepts.values()) {
        for (const value of values(concept)) distribution[value] = (distribution[value] ?? 0) + 1;
      }
    }
    return Object.fromEntries(
      Object.entries(distribution).sort(([first], [second]) => first.localeCompare(second))
    );
  }
  usableSources(sourceName) {
    const sources = sourceName ? [this.sourceByName(sourceName)] : this.sources;
    const usable = sources.filter(
      (source) => Boolean(source.search)
    );
    if (!usable.length) {
      throw new WorkspaceError(
        "no_usable_sources",
        "No usable OKF bundle is available in this workspace.",
        {
          source: sourceName,
          sources: sources.map((source) => source.record.name)
        }
      );
    }
    return usable;
  }
  sourcesWithSearch() {
    return this.sources.filter((source) => Boolean(source.search));
  }
  sourceByName(sourceName) {
    if (this.selectedNames.has(sourceName)) {
      return this.sources.find((source) => source.record.name === sourceName);
    }
    if (this.availableNames.has(sourceName)) {
      throw new WorkspaceError(
        "source_not_in_workspace",
        `Source "${sourceName}" is not selected in this workspace.`,
        {
          source: sourceName,
          workspaceSources: [...this.selectedNames]
        }
      );
    }
    throw new WorkspaceError("unknown_source", `Unknown source "${sourceName}".`, {
      source: sourceName
    });
  }
  withSourceResult(source, result) {
    return {
      ...result,
      sourceName: source.record.name,
      sourceKind: source.record.manifest.kind,
      seedUrl: source.record.manifest.source.seedUrl,
      ref: `${source.record.name}:${result.id}`
    };
  }
  conceptCandidate(source, concept) {
    return {
      sourceName: source.record.name,
      sourceKind: source.record.manifest.kind,
      seedUrl: source.record.manifest.source.seedUrl,
      id: concept.id,
      ref: `${source.record.name}:${concept.id}`,
      title: concept.title,
      type: concept.type,
      resource: concept.resource
    };
  }
};
function validateWorkspaceProfile(profile, expectedName) {
  if (profile.schemaVersion !== 1) throw new Error("Workspace profile schemaVersion must be 1.");
  validateSourceName(profile.name);
  if (expectedName && profile.name !== expectedName) {
    throw new Error(
      `Workspace profile name mismatch: expected "${expectedName}", found "${profile.name}".`
    );
  }
  if (!Array.isArray(profile.sources) || profile.sources.length === 0) {
    throw new Error(`Workspace profile "${profile.name}" must list at least one source.`);
  }
  for (const source of profile.sources) validateSourceName(source);
  assertUniqueSourceNames(profile.sources);
}
function assertUniqueSourceNames(names) {
  const seen = /* @__PURE__ */ new Set();
  for (const name of names) {
    validateSourceName(name);
    if (seen.has(name))
      throw new WorkspaceError("duplicate_source", `Duplicate workspace source "${name}".`, {
        source: name
      });
    seen.add(name);
  }
}

// src/mcp.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { z as z2 } from "zod";

// src/mcp-results.ts
function json(value, maxChars = 12e3) {
  return toolResult(value, structuredContentFor(value), maxChars);
}
function toolResult(textPayload, structuredContent, maxChars, isError = false) {
  const serialized = JSON.stringify(textPayload, null, 2);
  const boundedStructuredContent = serialized.length <= maxChars ? structuredContent : void 0;
  let text = serialized;
  if (text.length > maxChars) text = `${text.slice(0, maxChars)}
...truncated`;
  return {
    content: [{ type: "text", text }],
    structuredContent: boundedStructuredContent,
    isError
  };
}
function toolError(error, maxChars = 12e3) {
  return toolResult({ error }, { error }, maxChars, true);
}
function structuredContentFor(value) {
  if (Array.isArray(value)) return { results: value };
  if (value && typeof value === "object") return value;
  if (value === void 0) return void 0;
  return { value };
}
function argumentError(error) {
  return {
    code: "invalid_arguments",
    message: "Invalid tool arguments.",
    issues: error.issues
  };
}

// src/mcp-source-runtime.ts
function errorDetails2(error) {
  if (error instanceof Error) return { message: error.message };
  if (typeof error === "string") return { message: error };
  if (error && typeof error === "object") {
    const record = error;
    return {
      ...record,
      message: typeof record.message === "string" ? record.message : "Refresh failed."
    };
  }
  return { message: "Refresh failed." };
}
function nullableErrorDetails(error) {
  if (error === void 0 || error === null) return null;
  return errorDetails2(error);
}
function normalizeFreshness(state) {
  return {
    freshnessStatus: state?.freshnessStatus ?? state?.status,
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    refreshInProgress: Boolean(state?.refreshInProgress),
    lastRefreshError: nullableErrorDetails(state?.lastRefreshError ?? state?.lastError),
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null
  };
}
function shouldRefresh(status, hasSearch) {
  if (!hasSearch) return status !== "fresh";
  return status === "stale" || status === "missing" || status === "failed";
}

// src/mcp.ts
function collectNeighbors(search, rootId, depth) {
  const seen = /* @__PURE__ */ new Set([rootId]);
  let frontier = [rootId];
  const edges = [];
  for (let level = 0; level < depth; level += 1) {
    const next = [];
    for (const id of frontier) {
      for (const to of search.graph.outbound.get(id) ?? []) {
        edges.push({
          from: id,
          to,
          direction: "outbound",
          relationship_text: "Markdown link"
        });
        if (!seen.has(to)) next.push(to);
        seen.add(to);
      }
      for (const from of search.graph.backlinks.get(id) ?? []) {
        edges.push({ from, to: id, direction: "backlink", relationship_text: "Backlink" });
        if (!seen.has(from)) next.push(from);
        seen.add(from);
      }
    }
    frontier = next;
  }
  return { conceptIds: [...seen], edges };
}
async function createMcpServer(options) {
  let activeBundleDir = options.bundleDir;
  let search = options.search;
  let observedFreshness;
  let lastRefreshError = null;
  let inFlightRefresh;
  if (!search) {
    try {
      search = await BundleSearch.fromBundle(activeBundleDir);
    } catch (error) {
      if (!options.source) throw error;
      lastRefreshError = errorDetails2(error);
    }
  }
  const server = new Server(
    { name: options.name ?? "okfy", version: packageVersion() },
    { capabilities: { tools: {} } }
  );
  const maxResultChars = options.maxResultChars ?? 12e3;
  const refreshMode = () => options.refresh?.mode ?? (options.source ? "stale-while-refresh" : "off");
  async function getFreshness() {
    if (options.refresh?.getFreshness) {
      observedFreshness = await options.refresh.getFreshness();
      return observedFreshness;
    }
    observedFreshness ??= {
      freshnessStatus: search ? "fresh" : "missing",
      refreshInProgress: false,
      lastRefreshError: null
    };
    return observedFreshness;
  }
  function sourceSummaryFields() {
    if (!options.source) return {};
    const normalized = normalizeFreshness(observedFreshness);
    const lastError = lastRefreshError ?? normalized.lastRefreshError;
    const status = lastError ? "failed" : normalized.freshnessStatus ?? (search ? "fresh" : "missing");
    return {
      sourceName: options.source.name,
      sourceKind: options.source.kind,
      seedUrl: options.source.seedUrl,
      freshnessStatus: status,
      lastSuccessfulRefreshAt: normalized.lastSuccessfulRefreshAt,
      refreshInProgress: Boolean(inFlightRefresh) || normalized.refreshInProgress,
      lastRefreshError: lastError,
      nextRefreshAllowedAt: normalized.nextRefreshAllowedAt
    };
  }
  function bundleUnavailable() {
    const details = lastRefreshError ?? errorDetails2("No OKF bundle is available.");
    return toolError(
      {
        code: "bundle_unavailable",
        message: details.message,
        sourceName: options.source?.name,
        seedUrl: options.source?.seedUrl,
        lastRefreshError: details
      },
      maxResultChars
    );
  }
  function startRefresh(mode, freshness) {
    if (!options.refresh?.refreshIfNeeded) return void 0;
    if (inFlightRefresh) return inFlightRefresh;
    inFlightRefresh = (async () => {
      try {
        const result = await options.refresh?.refreshIfNeeded?.({
          mode,
          bundleDir: activeBundleDir,
          source: options.source,
          freshness
        });
        if (result?.freshness) observedFreshness = result.freshness;
        const nextBundleDir = result?.bundleDir ?? activeBundleDir;
        const nextSearch = await BundleSearch.fromBundle(nextBundleDir);
        activeBundleDir = nextBundleDir;
        search = nextSearch;
        lastRefreshError = null;
      } catch (error) {
        lastRefreshError = errorDetails2(error);
      } finally {
        inFlightRefresh = void 0;
      }
    })();
    return inFlightRefresh;
  }
  async function prepareBundleForTool(toolName) {
    const mode = refreshMode();
    if (mode === "off" || !refreshableTool(toolName)) return;
    const freshness = await getFreshness();
    const normalized = normalizeFreshness(freshness);
    if (!shouldRefresh(normalized.freshnessStatus, Boolean(search))) return;
    const refresh = startRefresh(mode, freshness);
    if (!refresh) return;
    if (mode === "blocking" || !search) await refresh;
  }
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: mcpToolDefinitions("bundle")
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    try {
      if (request.params.name === BUNDLE_SUMMARY_TOOL && options.source) await getFreshness();
      await prepareBundleForTool(request.params.name);
      if (request.params.name === SEARCH_CONCEPTS_TOOL) {
        if (!search) return bundleUnavailable();
        const parsed = searchSchema.parse(args);
        return json(search.search(parsed.query, parsed), maxResultChars);
      }
      if (request.params.name === READ_CONCEPT_TOOL) {
        if (!search) return bundleUnavailable();
        const parsed = readSchema.parse(args);
        const concept = search.getConcept(parsed.id);
        if (!concept)
          return toolError(
            { code: "unknown_concept", message: `No concept found for ${parsed.id}` },
            maxResultChars
          );
        const max = parsed.max_chars ?? maxResultChars;
        return json(
          {
            frontmatter: concept.frontmatter,
            markdown_body: concept.body.slice(0, max),
            outbound_links: search.graph.outbound.get(concept.id) ?? [],
            backlinks: search.graph.backlinks.get(concept.id) ?? [],
            source_resource: concept.resource
          },
          maxResultChars
        );
      }
      if (request.params.name === GET_NEIGHBORS_TOOL) {
        if (!search) return bundleUnavailable();
        const currentSearch = search;
        const parsed = neighborsSchema.parse(args);
        const root = currentSearch.getConcept(parsed.id);
        if (!root)
          return toolError(
            { code: "unknown_concept", message: `No concept found for ${parsed.id}` },
            maxResultChars
          );
        const neighbors = collectNeighbors(currentSearch, root.id, parsed.depth ?? 1);
        return json(
          {
            root: root.id,
            concepts: neighbors.conceptIds.map((id) => {
              const concept = currentSearch.graph.concepts.get(id);
              return {
                id,
                title: concept?.title,
                type: concept?.type,
                resource: concept?.resource
              };
            }),
            edges: neighbors.edges
          },
          maxResultChars
        );
      }
      if (request.params.name === LIST_TYPES_TOOL) {
        if (!search) return bundleUnavailable();
        const stats = await inspectBundle(activeBundleDir);
        return json(stats.typeDistribution, maxResultChars);
      }
      if (request.params.name === LIST_TAGS_TOOL) {
        if (!search) return bundleUnavailable();
        const stats = await inspectBundle(activeBundleDir);
        return json(stats.tagDistribution, maxResultChars);
      }
      if (request.params.name === BUNDLE_SUMMARY_TOOL) {
        if (!search) return bundleUnavailable();
        const [stats, validation] = await Promise.all([
          inspectBundle(activeBundleDir),
          validateBundle(activeBundleDir)
        ]);
        return json(
          {
            ...stats,
            reservedFileCount: validation.reservedFileCount,
            warningCount: validation.warningCount,
            validationStatus: validation.valid ? "valid" : "invalid",
            validationIssues: validation.issues,
            ...sourceSummaryFields()
          },
          maxResultChars
        );
      }
      return toolError(
        { code: "unknown_tool", message: `Unknown tool: ${request.params.name}` },
        maxResultChars
      );
    } catch (error) {
      if (error instanceof z2.ZodError) return toolError(argumentError(error), maxResultChars);
      return toolError(
        { code: "tool_error", message: error?.message ?? "Tool failed." },
        maxResultChars
      );
    }
  });
  return server;
}
async function createWorkspaceMcpServer(options) {
  const maxResultChars = options.maxResultChars ?? 12e3;
  const runtimes = await Promise.all(
    options.sources.map(async (source) => {
      const runtime = {
        record: source.record,
        activeBundleDir: source.record.bundleDir,
        search: source.search,
        lastRefreshError: source.record.loadError ? errorDetails2(source.record.loadError) : null,
        refresh: source.refresh
      };
      if (!runtime.search) {
        try {
          runtime.search = await BundleSearch.fromBundle(runtime.activeBundleDir);
        } catch (error) {
          runtime.lastRefreshError ??= errorDetails2(error);
        }
      }
      return runtime;
    })
  );
  const selectedNames = new Set(runtimes.map((runtime) => runtime.record.name));
  const availableNames = /* @__PURE__ */ new Set([...options.availableSourceNames ?? [], ...selectedNames]);
  const server = new Server(
    { name: options.name ?? "okfy", version: packageVersion() },
    { capabilities: { tools: {} } }
  );
  function runtimeForSource(sourceName) {
    if (selectedNames.has(sourceName))
      return runtimes.find((runtime) => runtime.record.name === sourceName);
    if (availableNames.has(sourceName)) {
      throw new WorkspaceError(
        "source_not_in_workspace",
        `Source "${sourceName}" is not selected in this workspace.`,
        {
          source: sourceName,
          workspaceSources: [...selectedNames]
        }
      );
    }
    throw new WorkspaceError("unknown_source", `Unknown source "${sourceName}".`, {
      source: sourceName
    });
  }
  function workspaceSearch() {
    return new WorkspaceSearch(
      runtimes.map(
        (runtime) => ({
          record: runtime.record,
          bundleDir: runtime.activeBundleDir,
          search: runtime.search,
          loadError: runtime.lastRefreshError
        })
      ),
      { availableSourceNames: [...availableNames] }
    );
  }
  async function getRuntimeFreshness(runtime) {
    if (runtime.record.loadError) {
      const freshness = runtime.observedFreshness ?? {
        freshnessStatus: "failed",
        refreshInProgress: false,
        lastRefreshError: errorDetails2(runtime.record.loadError)
      };
      runtime.observedFreshness = freshness;
      return freshness;
    }
    if (runtime.refresh?.getFreshness) {
      runtime.observedFreshness = await runtime.refresh.getFreshness();
      return runtime.observedFreshness;
    }
    runtime.observedFreshness ??= {
      freshnessStatus: runtime.search ? "fresh" : "missing",
      refreshInProgress: false,
      lastRefreshError: null
    };
    return runtime.observedFreshness;
  }
  function runtimeRefreshMode(runtime) {
    return runtime.refresh?.mode ?? "stale-while-refresh";
  }
  function sourceSummaryFields(runtime) {
    const normalized = normalizeFreshness(runtime.observedFreshness);
    const lastError = runtime.lastRefreshError ?? normalized.lastRefreshError;
    const refreshing = Boolean(runtime.inFlightRefresh) || normalized.refreshInProgress;
    const status = refreshing ? "refreshing" : lastError ? "failed" : normalized.freshnessStatus ?? (runtime.search ? "fresh" : "missing");
    return {
      sourceName: runtime.record.name,
      sourceKind: runtime.record.manifest.kind,
      seedUrl: runtime.record.manifest.source.seedUrl,
      freshnessStatus: status,
      lastSuccessfulRefreshAt: normalized.lastSuccessfulRefreshAt,
      refreshInProgress: refreshing,
      lastRefreshError: lastError,
      nextRefreshAllowedAt: normalized.nextRefreshAllowedAt
    };
  }
  function startRuntimeRefresh(runtime, mode, freshness) {
    if (!runtime.refresh?.refreshIfNeeded) return void 0;
    if (runtime.inFlightRefresh) return runtime.inFlightRefresh;
    runtime.inFlightRefresh = (async () => {
      try {
        const result = await runtime.refresh?.refreshIfNeeded?.({
          mode,
          bundleDir: runtime.activeBundleDir,
          source: {
            name: runtime.record.name,
            kind: runtime.record.manifest.kind,
            seedUrl: runtime.record.manifest.source.seedUrl
          },
          freshness
        });
        if (result?.freshness) runtime.observedFreshness = result.freshness;
        const nextBundleDir = result?.bundleDir ?? runtime.activeBundleDir;
        runtime.search = await BundleSearch.fromBundle(nextBundleDir);
        runtime.activeBundleDir = nextBundleDir;
        runtime.lastRefreshError = null;
      } catch (error) {
        runtime.lastRefreshError = errorDetails2(error);
      } finally {
        runtime.inFlightRefresh = void 0;
      }
    })();
    return runtime.inFlightRefresh;
  }
  async function prepareRuntime(runtime, toolName, sourceFiltered, workspaceHadUsableSource) {
    try {
      const mode = runtimeRefreshMode(runtime);
      if (mode === "off" || !refreshableTool(toolName)) return;
      const freshness = await getRuntimeFreshness(runtime);
      const normalized = normalizeFreshness(freshness);
      if (!shouldRefresh(normalized.freshnessStatus, Boolean(runtime.search))) return;
      const refresh = startRuntimeRefresh(runtime, mode, freshness);
      if (!refresh) return;
      const shouldAwait = sourceFiltered ? mode === "blocking" || !runtime.search : !workspaceHadUsableSource && !runtime.search;
      if (shouldAwait) await refresh;
    } catch (error) {
      runtime.lastRefreshError = errorDetails2(error);
    }
  }
  async function prepareWorkspaceForTool(toolName, sourceName) {
    if (!refreshableTool(toolName)) return;
    const selected = sourceName ? [runtimeForSource(sourceName)] : runtimes;
    const workspaceHadUsableSource = selected.some((runtime) => runtime.search);
    await Promise.all(
      selected.map(
        (runtime) => prepareRuntime(runtime, toolName, Boolean(sourceName), workspaceHadUsableSource)
      )
    );
  }
  function workspaceUnavailable() {
    return toolError(
      {
        code: "bundle_unavailable",
        message: "No usable OKF bundle is available in this workspace.",
        sources: runtimes.map((runtime) => ({
          sourceName: runtime.record.name,
          seedUrl: runtime.record.manifest.source.seedUrl,
          lastRefreshError: runtime.lastRefreshError
        }))
      },
      maxResultChars
    );
  }
  function sourceUnavailable(runtime) {
    const details = runtime.lastRefreshError ?? errorDetails2("No OKF bundle is available for this source.");
    return toolError(
      {
        code: "bundle_unavailable",
        message: details.message,
        sourceName: runtime.record.name,
        seedUrl: runtime.record.manifest.source.seedUrl,
        lastRefreshError: details
      },
      maxResultChars
    );
  }
  async function sourceSummary(runtime) {
    try {
      await getRuntimeFreshness(runtime);
    } catch (error) {
      runtime.lastRefreshError = errorDetails2(error);
    }
    const freshness = sourceSummaryFields(runtime);
    if (!runtime.search) {
      return unavailableSourceSummary(runtime);
    }
    let stats;
    let validation;
    try {
      [stats, validation] = await Promise.all([
        inspectBundle(runtime.activeBundleDir),
        validateBundle(runtime.activeBundleDir)
      ]);
    } catch (error) {
      runtime.lastRefreshError = errorDetails2(error);
      return unavailableSourceSummary(runtime);
    }
    return {
      ...freshness,
      bundleDir: runtime.activeBundleDir,
      conceptCount: stats.conceptCount,
      reservedFileCount: validation.reservedFileCount,
      warningCount: validation.warningCount,
      validationStatus: validation.valid ? "valid" : "invalid",
      validationIssues: validation.issues,
      typeDistribution: stats.typeDistribution,
      tagDistribution: stats.tagDistribution,
      linkCount: stats.linkCount,
      brokenLinks: stats.brokenLinks,
      orphanConcepts: stats.orphanConcepts,
      sourceDomains: stats.sourceDomains
    };
  }
  function unavailableSourceSummary(runtime) {
    return {
      ...sourceSummaryFields(runtime),
      bundleDir: runtime.activeBundleDir,
      conceptCount: runtime.search?.graph.concepts.size ?? runtime.record.state?.bundle?.conceptCount ?? 0,
      reservedFileCount: 0,
      warningCount: runtime.record.state?.bundle?.warningCount ?? 0,
      validationStatus: "unavailable",
      validationIssues: []
    };
  }
  async function workspaceSummary(sourceName) {
    const selected = sourceName ? [runtimeForSource(sourceName)] : runtimes;
    const sources = await Promise.all(selected.map(sourceSummary));
    const usableSourceCount = selected.filter((runtime) => runtime.search).length;
    const conceptCount = sources.reduce((sum, source) => sum + numberField(source.conceptCount), 0);
    const reservedFileCount = sources.reduce(
      (sum, source) => sum + numberField(source.reservedFileCount),
      0
    );
    const warningCount = sources.reduce((sum, source) => sum + numberField(source.warningCount), 0);
    let typeDistribution = {};
    let tagDistribution = {};
    try {
      const workspace = workspaceSearch();
      typeDistribution = workspace.listTypes(sourceName);
      tagDistribution = workspace.listTags(sourceName);
    } catch (error) {
      if (!(error instanceof WorkspaceError) || error.code !== "no_usable_sources") throw error;
    }
    return {
      workspace: true,
      sourceCount: selected.length,
      usableSourceCount,
      conceptCount,
      reservedFileCount,
      warningCount,
      validationStatus: sources.some((source) => source.validationStatus !== "valid") ? "invalid" : "valid",
      typeDistribution,
      tagDistribution,
      sources
    };
  }
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: mcpToolDefinitions("workspace")
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const args = request.params.arguments ?? {};
    try {
      const sourceName = sourceFilterSchema.partial().parse(args).source;
      if (request.params.name === BUNDLE_SUMMARY_TOOL) {
        return json(await workspaceSummary(sourceName), maxResultChars);
      }
      await prepareWorkspaceForTool(request.params.name, sourceName);
      if (sourceName) {
        const runtime = runtimeForSource(sourceName);
        if (!runtime.search) return sourceUnavailable(runtime);
      }
      const workspace = workspaceSearch();
      if (workspace.usableSourceNames().length === 0) return workspaceUnavailable();
      if (request.params.name === SEARCH_CONCEPTS_TOOL) {
        const parsed = workspaceSearchSchema.parse(args);
        return json(workspace.search(parsed.query, parsed), maxResultChars);
      }
      if (request.params.name === READ_CONCEPT_TOOL) {
        const parsed = workspaceReadSchema.parse(args);
        const { source, concept } = workspace.getConcept(parsed);
        const max = parsed.max_chars ?? maxResultChars;
        return json(
          {
            sourceName: source.record.name,
            sourceKind: source.record.manifest.kind,
            seedUrl: source.record.manifest.source.seedUrl,
            ref: `${source.record.name}:${concept.id}`,
            frontmatter: concept.frontmatter,
            markdown_body: concept.body.slice(0, max),
            outbound_links: source.search.graph.outbound.get(concept.id) ?? [],
            backlinks: source.search.graph.backlinks.get(concept.id) ?? [],
            source_resource: concept.resource
          },
          maxResultChars
        );
      }
      if (request.params.name === GET_NEIGHBORS_TOOL) {
        const parsed = workspaceNeighborsSchema.parse(args);
        const { source, concept: root } = workspace.getConcept(parsed);
        const currentSearch = source.search;
        const neighbors = collectNeighbors(currentSearch, root.id, parsed.depth ?? 1);
        return json({
          sourceName: source.record.name,
          sourceKind: source.record.manifest.kind,
          seedUrl: source.record.manifest.source.seedUrl,
          root: root.id,
          ref: `${source.record.name}:${root.id}`,
          concepts: neighbors.conceptIds.map((id) => {
            const concept = currentSearch.graph.concepts.get(id);
            return {
              sourceName: source.record.name,
              id,
              ref: `${source.record.name}:${id}`,
              title: concept?.title,
              type: concept?.type,
              resource: concept?.resource
            };
          }),
          edges: neighbors.edges.map((edge) => ({ ...edge, sourceName: source.record.name }))
        });
      }
      if (request.params.name === LIST_TYPES_TOOL) {
        const parsed = sourceFilterSchema.parse(args);
        return json(workspace.listTypes(parsed.source), maxResultChars);
      }
      if (request.params.name === LIST_TAGS_TOOL) {
        const parsed = sourceFilterSchema.parse(args);
        return json(workspace.listTags(parsed.source), maxResultChars);
      }
      return toolError(
        { code: "unknown_tool", message: `Unknown tool: ${request.params.name}` },
        maxResultChars
      );
    } catch (error) {
      if (error instanceof WorkspaceError) return toolError(error.toJSON(), maxResultChars);
      if (error instanceof z2.ZodError) return toolError(argumentError(error), maxResultChars);
      return toolError(
        { code: "tool_error", message: error?.message ?? "Tool failed." },
        maxResultChars
      );
    }
  });
  return server;
}
function numberField(value) {
  return typeof value === "number" ? value : 0;
}
async function serveMcpStdio(options) {
  const server = await createMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
async function serveWorkspaceMcpStdio(options) {
  const server = await createWorkspaceMcpServer(options);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// src/setup.ts
import fs7 from "fs/promises";
import path12 from "path";
import { spawn } from "child_process";
var EXPECTED_MCP_TOOLS = [...MCP_TOOL_NAMES];
var MAX_CAPTURE_CHARS = 64e3;
var MAX_DIAGNOSTIC_CHARS = 1e3;
var MAX_MESSAGES = 100;
function parseSetupClient(value) {
  const normalized = value.trim().toLowerCase();
  if (normalized === "claude-code" || normalized === "claude") return "claude-code";
  if (normalized === "claude-desktop" || normalized === "cursor" || normalized === "mcp-json" || normalized === "desktop") {
    return "mcp-json";
  }
  if (normalized === "codex") return "codex";
  if (normalized === "generic" || normalized === "json") return "generic";
  throw new Error(
    `Invalid setup client "${value}". Use claude-code, claude-desktop, cursor, codex, or generic.`
  );
}
function expectedMcpTools() {
  return [...EXPECTED_MCP_TOOLS];
}
function defaultOkfyHome() {
  return resolveOkfyHome2({ env: { OKFY_HOME: "" } });
}
function setupStatus(checks) {
  if (checks.some((check) => check.severity === "fail")) return "failed";
  if (checks.some((check) => check.severity === "warn")) return "warning";
  return "ready";
}
function createSetupReport(input) {
  const okfyHome = path12.resolve(input.okfyHome ?? resolveOkfyHome2());
  const defaultHome = defaultOkfyHome();
  const sourceNames = setupSourceNames(input);
  const workspace = Boolean(input.workspaceAll) || sourceNames.length > 1;
  const serverIdentity = input.workspaceAll ? ["all"] : sourceNames;
  const commandTarget = input.workspaceAll ? { all: true } : sourceNames;
  const serverName = mcpServerName(serverIdentity);
  const codexServerName = codexMcpServerName(serverIdentity);
  const command = serveCommand(commandTarget, okfyHome, defaultHome);
  return {
    sourceName: input.workspaceAll && sourceNames.length === 0 ? "--all" : sourceNames.join(", "),
    sourceNames,
    workspace,
    workspaceAll: Boolean(input.workspaceAll),
    client: input.client,
    serverName,
    codexServerName,
    okfyHome,
    defaultOkfyHome: defaultHome,
    command,
    artifacts: renderClientArtifacts({
      client: input.client,
      sourceNames,
      workspaceAll: input.workspaceAll,
      okfyHome,
      defaultOkfyHome: defaultHome
    }),
    firstPrompt: firstAgentPrompt(input.client === "codex" ? codexServerName : serverName, {
      workspace
    }),
    checks: input.checks,
    status: setupStatus(input.checks)
  };
}
function renderClientArtifacts(input) {
  const okfyHome = path12.resolve(input.okfyHome ?? resolveOkfyHome2());
  const defaultHome = input.defaultOkfyHome ?? defaultOkfyHome();
  const sourceNames = setupSourceNames(input);
  const serverIdentity = input.workspaceAll ? ["all"] : sourceNames;
  const commandTarget = input.workspaceAll ? { all: true } : sourceNames;
  const serverName = mcpServerName(serverIdentity);
  const codexName = codexMcpServerName(serverIdentity);
  const command = serveCommand(commandTarget, okfyHome, defaultHome);
  return renderMcpClientArtifacts({
    client: input.client,
    serverName,
    codexServerName: codexName,
    command
  });
}
function renderMcpClientArtifacts(input) {
  const env = Object.keys(input.command.env).length ? input.command.env : void 0;
  if (input.client === "claude-code") {
    return [
      {
        client: input.client,
        label: "Claude Code",
        format: "shell",
        body: `claude mcp add --transport stdio${shellEnvArgs(input.command.env, "-e")} ${input.serverName} -- ${input.command.display}`
      }
    ];
  }
  if (input.client === "codex") {
    return [
      {
        client: input.client,
        label: "Codex config.toml",
        format: "toml",
        body: codexToml(input.codexServerName, input.command, env)
      },
      {
        client: input.client,
        label: "Codex CLI",
        format: "shell",
        body: `codex mcp add${shellEnvArgs(input.command.env, "--env")} ${input.codexServerName} -- ${input.command.display}`
      }
    ];
  }
  const label = input.client === "mcp-json" ? "Claude Desktop / Cursor mcpServers JSON" : "Generic mcpServers JSON";
  return [
    {
      client: input.client,
      label,
      format: "json",
      body: JSON.stringify(
        {
          mcpServers: {
            [input.serverName]: {
              command: input.command.command,
              args: input.command.args,
              ...env ? { env } : {}
            }
          }
        },
        null,
        2
      )
    }
  ];
}
function firstAgentPrompt(serverName, options = {}) {
  if (options.workspace) {
    return `Use the ${serverName} MCP server. Start with bundle_summary to understand the workspace sources and freshness. Filter by source when you know which docs apply, search before reading concepts, read only the most relevant concepts, inspect neighbors when relationships matter, and cite source_resource URLs in the final answer.`;
  }
  return `Use the ${serverName} MCP server. Start with bundle_summary to understand the bundle and freshness. Search before reading concepts, read only the most relevant concepts, inspect neighbors when relationships matter, and cite source_resource URLs in the final answer.`;
}
function serveCommand(sourceNameOrNames, okfyHome, defaultHome = defaultOkfyHome(), options = {}) {
  const args = ["-y", "okfy-ai", ...serveCommandArgs(sourceNameOrNames, options)];
  const env = needsOkfyHomeEnv(okfyHome, defaultHome) ? { OKFY_HOME: path12.resolve(okfyHome) } : {};
  return {
    command: "npx",
    args,
    env,
    display: ["npx", ...args].map(shellQuote).join(" ")
  };
}
function serveCommandArgs(sourceNameOrNames, options = {}) {
  const autoRefresh = options.autoRefresh ?? true;
  if (isAllCommandTarget(sourceNameOrNames)) {
    return autoRefresh ? ["serve", "--all", "--mcp", "--auto-refresh"] : ["serve", "--all", "--mcp"];
  }
  const sourceNames = Array.isArray(sourceNameOrNames) ? sourceNameOrNames : [sourceNameOrNames];
  if (sourceNames.some((sourceName) => sourceName.startsWith("-"))) {
    return autoRefresh ? ["serve", "--mcp", "--auto-refresh", "--", ...sourceNames] : ["serve", "--mcp", "--", ...sourceNames];
  }
  return autoRefresh ? ["serve", ...sourceNames, "--mcp", "--auto-refresh"] : ["serve", ...sourceNames, "--mcp"];
}
function isAllCommandTarget(sourceNameOrNames) {
  return typeof sourceNameOrNames === "object" && !Array.isArray(sourceNameOrNames) && sourceNameOrNames.all;
}
function setupCheck(id, label, severity, message, fix) {
  return { id, label, severity, message, ...fix ? { fix } : {} };
}
async function executableOnPath(command, env = process.env) {
  const searchPath = env.PATH ?? "";
  const extensions = process.platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""];
  for (const directory of searchPath.split(path12.delimiter)) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = path12.join(directory, `${command}${extension}`);
      try {
        await fs7.access(candidate, fs7.constants.X_OK);
        return true;
      } catch {
      }
    }
  }
  return false;
}
function evaluateMcpProbeMessages(messages) {
  const toolsResponse = messages.find((message) => message.id === 2);
  const tools = toolsResponse?.result?.tools?.map((tool) => tool.name).filter((name) => Boolean(name)) ?? [];
  const missingTools = EXPECTED_MCP_TOOLS.filter((tool) => !tools.includes(tool));
  return { ok: missingTools.length === 0, tools, missingTools };
}
async function probeMcpStdio(options) {
  const child = spawn(options.command, options.args, {
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  return probeChildProcess(child, options.timeoutMs ?? 5e3);
}
async function probeChildProcess(child, timeoutMs) {
  const messages = [];
  let stdoutBuffer = "";
  let stderr = "";
  let contamination;
  let spawnError;
  let exit;
  const closed = new Promise((resolve) => {
    child.once("close", (code, signal) => {
      exit = { code, signal };
      resolve(exit);
    });
  });
  child.on("error", (error) => {
    spawnError = error;
  });
  child.stdin.on("error", (error) => {
    spawnError ??= error;
  });
  child.stdout.on("data", (chunk) => {
    stdoutBuffer = appendBounded(stdoutBuffer, chunk.toString("utf8"));
    let newlineIndex = stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex).trim();
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      if (line) {
        try {
          if (messages.length >= MAX_MESSAGES)
            contamination = `MCP stdout exceeded ${MAX_MESSAGES} JSON-RPC messages.`;
          else messages.push(JSON.parse(line));
        } catch {
          contamination = line;
        }
      }
      newlineIndex = stdoutBuffer.indexOf("\n");
    }
    if (stdoutBuffer.length >= MAX_CAPTURE_CHARS)
      contamination = `MCP stdout line exceeded ${MAX_CAPTURE_CHARS} characters.`;
  });
  child.stderr.on("data", (chunk) => {
    stderr = appendBounded(stderr, chunk.toString("utf8"));
  });
  const send = (id, method, params = {}) => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}
`);
  };
  try {
    send(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "okfy-doctor", version: packageVersion() }
    });
    await waitForMessage(
      1,
      messages,
      () => contamination,
      () => spawnError,
      () => exit,
      () => stderr,
      timeoutMs
    );
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}
`
    );
    send(2, "tools/list");
    await waitForMessage(
      2,
      messages,
      () => contamination,
      () => spawnError,
      () => exit,
      () => stderr,
      timeoutMs
    );
    const result = evaluateMcpProbeMessages(messages);
    if (!result.ok) {
      return {
        ok: false,
        tools: result.tools,
        stderr,
        error: {
          code: "missing_tools",
          message: `MCP server did not expose expected tools: ${result.missingTools.join(", ")}.`
        }
      };
    }
    return { ok: true, tools: result.tools, stderr };
  } catch (error) {
    if (error instanceof ProbeFailure) {
      return { ok: false, tools: [], stderr, error: { code: error.code, message: error.message } };
    }
    return {
      ok: false,
      tools: [],
      stderr,
      error: {
        code: "protocol_error",
        message: error instanceof Error ? error.message : String(error)
      }
    };
  } finally {
    await stopChild(child, closed, () => exit);
  }
}
var ProbeFailure = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
async function waitForMessage(id, messages, contamination, spawnError, childExit, capturedStderr, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const badLine = contamination();
    if (badLine)
      throw new ProbeFailure(
        "stdout_contamination",
        `MCP stdout contained non-JSON output: ${badLine}`
      );
    const error = spawnError();
    if (error) throw new ProbeFailure("startup_failed", error.message);
    const message = messages.find((candidate) => candidate.id === id);
    if (message) return message;
    const exit = childExit();
    if (exit) {
      const details = capturedStderr() ? ` stderr: ${truncate(capturedStderr())}` : "";
      throw new ProbeFailure(
        "startup_failed",
        `MCP subprocess exited before response ${id} (${formatExit(exit)}).${details}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new ProbeFailure("timeout", `Timed out waiting for MCP response ${id}.`);
}
async function stopChild(child, closed, childExit) {
  try {
    if (!child.stdin.destroyed) child.stdin.end();
  } catch {
  }
  if (childExit()) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    closed.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 500))
  ]);
  if (!exited && !childExit()) child.kill("SIGKILL");
}
function appendBounded(current, addition) {
  const next = current + addition;
  if (next.length <= MAX_CAPTURE_CHARS) return next;
  return next.slice(next.length - MAX_CAPTURE_CHARS);
}
function truncate(value) {
  const normalized = value.trim();
  if (normalized.length <= MAX_DIAGNOSTIC_CHARS) return normalized;
  return `${normalized.slice(0, MAX_DIAGNOSTIC_CHARS)}...truncated`;
}
function formatExit(exit) {
  if (exit.signal) return `signal ${exit.signal}`;
  return `exit code ${exit.code ?? "unknown"}`;
}
function needsOkfyHomeEnv(okfyHome, defaultHome) {
  return path12.resolve(okfyHome) !== path12.resolve(defaultHome);
}
function mcpServerName(sourceNameOrNames) {
  const sourceNames = Array.isArray(sourceNameOrNames) ? sourceNameOrNames : [sourceNameOrNames];
  const safeName = sourceNames.map((sourceName) => sourceName.replace(/[._]+/g, "-").replace(/^-+/, "")).filter(Boolean).join("-");
  return `${safeName || "source"}-okf`;
}
function codexMcpServerName(sourceNameOrNames) {
  const sourceNames = Array.isArray(sourceNameOrNames) ? sourceNameOrNames : [sourceNameOrNames];
  const safeName = sourceNames.map((sourceName) => sourceName.replace(/[^a-z0-9]+/g, "_").replace(/^_+/, "")).filter(Boolean).join("_");
  return `${safeName || "source"}_okf`;
}
function setupSourceNames(input) {
  const names = input.sourceNames ?? (input.sourceName ? [input.sourceName] : []);
  if (input.workspaceAll) return [...names];
  if (!names.length) throw new Error("Setup report requires at least one source name.");
  return [...names];
}
function shellEnvArgs(env, flag) {
  const entries = Object.entries(env);
  if (!entries.length) return "";
  return entries.map(([key, value]) => ` ${flag} ${shellQuote(`${key}=${value}`)}`).join("");
}
function shellQuote(value) {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
function codexToml(serverName, command, env) {
  const lines = [
    `[mcp_servers.${serverName}]`,
    `command = ${JSON.stringify(command.command)}`,
    `args = [${command.args.map((arg) => JSON.stringify(arg)).join(", ")}]`
  ];
  if (env?.OKFY_HOME) lines.push(`env = { OKFY_HOME = ${JSON.stringify(env.OKFY_HOME)} }`);
  lines.push("startup_timeout_sec = 20", "tool_timeout_sec = 60", "enabled = true");
  return lines.join("\n");
}

export {
  runtimePackageRoot,
  packageMetadata,
  packageVersion,
  okfyUserAgent,
  isRecord,
  parseMarkdown,
  isReservedOkfPath,
  toPosixPath,
  ensureMarkdownPath,
  urlToOutputPath,
  relativeMarkdownLink,
  resolveOkfyHome,
  normalizeVaultPath,
  resolveVaultDocuments,
  extractInternalLinks,
  buildGraph,
  readConceptFile,
  readBundle,
  validateBundle,
  inspectBundle,
  resolveOkfyHome2,
  validateSourceName,
  resolveSourceDir,
  resolveBundleDir,
  writeSourceManifest,
  readSourceManifest,
  writeRefreshState,
  readRefreshState,
  readSourceRecord,
  listSources,
  removeSource,
  MCP_TOOL_NAMES,
  BundleSearch,
  bundleSourceName,
  localBundleRecord,
  assertUniqueWorkspaceRecordNames,
  isRegisteredWorkspaceRecord,
  WorkspaceError,
  workspaceProfilePath,
  readWorkspaceProfile,
  writeWorkspaceProfile,
  resolveWorkspaceSources,
  WorkspaceSearch,
  createMcpServer,
  createWorkspaceMcpServer,
  serveMcpStdio,
  serveWorkspaceMcpStdio,
  parseSetupClient,
  expectedMcpTools,
  defaultOkfyHome,
  createSetupReport,
  renderClientArtifacts,
  renderMcpClientArtifacts,
  firstAgentPrompt,
  serveCommand,
  serveCommandArgs,
  setupCheck,
  executableOnPath,
  probeMcpStdio,
  mcpServerName,
  codexMcpServerName
};
