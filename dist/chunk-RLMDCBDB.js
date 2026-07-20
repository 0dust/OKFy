import {
  BundleSearch,
  codexMcpServerName,
  defaultOkfyHome,
  ensureMarkdownPath,
  firstAgentPrompt,
  inspectBundle,
  isRecord,
  isRegisteredWorkspaceRecord,
  isReservedOkfPath,
  localBundleRecord,
  mcpServerName,
  normalizeVaultPath,
  okfyUserAgent,
  parseMarkdown,
  relativeMarkdownLink,
  renderMcpClientArtifacts,
  resolveOkfyHome,
  resolveVaultDocuments,
  serveCommand,
  toPosixPath,
  urlToOutputPath,
  validateBundle
} from "./chunk-GLEYSDOS.js";

// src/normalize.ts
import * as cheerio from "cheerio";
import TurndownService from "turndown";
var turndown = new TurndownService({
  codeBlockStyle: "fenced",
  headingStyle: "atx",
  bulletListMarker: "-"
});
turndown.keep(["table"]);
function extractHeadings(markdown) {
  return parseMarkdown(markdown).headings.map(({ depth, text, slug }) => ({ depth, text, slug }));
}
function extractMarkdownLinks(markdown) {
  return parseMarkdown(markdown).markdownLinks;
}
function inferType(title, sourceId, markdown) {
  const haystack = `${title} ${sourceId} ${markdown.slice(0, 2e3)}`.toLowerCase();
  if (/\breadme\b/.test(haystack)) return "README";
  if (/\b(api|reference|sdk|endpoint|parameter|request|response)\b/.test(haystack))
    return "API Reference";
  if (/\b(quickstart|guide|tutorial|walkthrough|get started)\b/.test(haystack)) return "Guide";
  if (/\bdocs?\b/.test(haystack)) return "Documentation Page";
  return "Concept";
}
function inferTags(title, sourceId, headings) {
  const raw = `${sourceId} ${title} ${headings.slice(0, 3).map((h) => h.text).join(" ")}`;
  const words = raw.toLowerCase().replace(/https?:\/\/[^/]+/g, "").split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && word.length <= 24).filter((word) => !["html", "markdown", "index", "docs", "page", "guide"].includes(word));
  return [...new Set(words)].slice(0, 6);
}
function titleFromMarkdown(headings, fallback) {
  const heading = headings.find((candidate) => candidate.depth === 1)?.text;
  if (heading) return plainTitle(heading);
  return fallback;
}
function plainTitle(title) {
  return title.replace(/\[([^\]]+)]\([^)]+\)/g, "$1").replace(/[`*_#]/g, "").replace(/\s+/g, " ").trim();
}
function fallbackTitle(sourceId) {
  const leaf = sourceId.split(/[/?#]/).filter(Boolean).pop() ?? "Index";
  return leaf.replace(/\.[a-z0-9]+$/i, "").split(/[-_\s]+/).filter(Boolean).map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join(" ");
}
function deduplicateTags(tags) {
  const seen = /* @__PURE__ */ new Set();
  return tags.filter((tag) => {
    const key = tag.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function invalidFrontmatterDiagnostic(sourcePath, property) {
  const expected = ["aliases", "tags"].includes(property) ? "a non-empty string or an array of non-empty strings" : "a non-empty string";
  return {
    severity: "warning",
    code: "invalid_frontmatter_property",
    message: `Invalid frontmatter property ${JSON.stringify(property)} in ${sourcePath}; expected ${expected}.`,
    sourcePath,
    rawTarget: property,
    property
  };
}
function normalizeDocument(raw) {
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
    markdown = `# ${title}

\`\`\`text
${raw.raw.trim()}
\`\`\``;
  }
  markdown = markdown.replace(/\r\n/g, "\n");
  const sourceId = raw.url ?? raw.filePath ?? raw.sourceId;
  const parsed = parseMarkdown(markdown, { mdx: raw.contentType === "mdx" });
  markdown = parsed.content;
  title = (parsed.properties?.title ?? titleFromMarkdown(parsed.headings, plainTitle(title))).replace(/\s+/g, " ").trim();
  const headings = parsed.headings.map(({ depth, text, slug }) => ({ depth, text, slug }));
  const links = parsed.markdownLinks;
  const inferredTags = inferTags(title, sourceId, headings);
  const tags = deduplicateTags([
    ...parsed.properties?.tags ?? [],
    ...parsed.inlineTags.map((inlineTag) => inlineTag.tag),
    ...inferredTags
  ]);
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
    ...parsed.properties ? { properties: parsed.properties } : {},
    ...parsed.properties?.aliases.length ? { aliases: parsed.properties.aliases } : {},
    ...parsed.invalidFrontmatterProperties.length ? {
      diagnostics: [...parsed.invalidFrontmatterProperties].sort().map((property) => invalidFrontmatterDiagnostic(raw.filePath ?? sourceId, property))
    } : {},
    ...parsed.semanticLinks.length ? { semanticLinks: parsed.semanticLinks } : {},
    ...parsed.blockIds.length ? { blockIds: parsed.blockIds } : {},
    ...parsed.inlineTags.length ? { inlineTags: parsed.inlineTags } : {}
  };
}
function descriptionFromMarkdown(markdown) {
  const text = markdown.replace(/^---[\s\S]*?---\s*/m, "").replace(/^#{1,6}\s+.+$/gm, "").replace(/```[\s\S]*?```/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[`*_>#-]/g, "").replace(/\s+/g, " ").trim();
  return text.slice(0, 180) || "Generated OKF concept.";
}

// src/writer.ts
import fs from "fs/promises";
import os from "os";
import path from "path";
import GithubSlugger from "github-slugger";
import { dump } from "js-yaml";

// src/util/url.ts
import dns from "dns/promises";
import net from "net";
var TRACKING_PARAMS = [/^utm_/i, /^fbclid$/i, /^gclid$/i, /^mc_/i];
function canonicalizeUrl(input, base) {
  const url = new URL(input, base);
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.some((pattern) => pattern.test(key))) url.searchParams.delete(key);
  }
  url.pathname = url.pathname.replace(/\/{2,}/g, "/");
  if (url.pathname !== "/" && url.pathname.endsWith("/") && !input.endsWith("/")) {
    url.pathname = url.pathname.replace(/\/+$/, "");
  }
  url.hostname = url.hostname.toLowerCase();
  return url.toString();
}
function sameOrigin(a, b) {
  const left = new URL(a);
  const right = new URL(b);
  return left.origin === right.origin;
}
function isHttpUrl(input) {
  try {
    const url = new URL(input);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}
function isPrivateIpv4Parts(parts) {
  const [a = 0, b = 0] = parts;
  return a === 0 || a === 10 || a === 127 || a === 100 && b >= 64 && b <= 127 || a === 172 && b >= 16 && b <= 31 || a === 192 && b === 168 || a === 169 && b === 254 || a >= 224;
}
function mappedIpv4PartsFromIpv6(host) {
  const dotted = host.match(/^(?:::|0:0:0:0:0:)ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
  if (dotted) {
    const parts = dotted.split(".").map(Number);
    if (parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)) return parts;
  }
  const hex = host.match(/^(?:::|0:0:0:0:0:)ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i);
  if (!hex) return void 0;
  const high = Number.parseInt(hex[1] ?? "", 16);
  const low = Number.parseInt(hex[2] ?? "", 16);
  if (!Number.isInteger(high) || !Number.isInteger(low) || high < 0 || high > 65535 || low < 0 || low > 65535) {
    return void 0;
  }
  return [high >> 8, high & 255, low >> 8, low & 255];
}
function isPrivateNetworkUrl(input) {
  const url = new URL(input);
  const host = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "::" || host === "::1" || host.startsWith("fe80:")) return true;
  const ipKind = net.isIP(host);
  if (ipKind === 4) {
    const parts = host.split(".").map(Number);
    return isPrivateIpv4Parts(parts);
  }
  if (ipKind === 6) {
    const mappedIpv4Parts = mappedIpv4PartsFromIpv6(host);
    if (mappedIpv4Parts) return isPrivateIpv4Parts(mappedIpv4Parts);
    return host === "::" || host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:");
  }
  return false;
}
async function resolvesToPrivateNetwork(input) {
  if (isPrivateNetworkUrl(input)) return true;
  const url = new URL(input);
  const host = url.hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
  if (net.isIP(host)) return false;
  let records;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    return false;
  }
  return records.some((record) => {
    const host2 = record.address.includes(":") ? `[${record.address}]` : record.address;
    return isPrivateNetworkUrl(`${url.protocol}//${host2}`);
  });
}
async function assertPublicNetworkUrl(input) {
  if (await resolvesToPrivateNetwork(input)) {
    throw new Error("Private network crawl target rejected. Use --allow-private-network for trusted local fixtures.");
  }
}

// src/writer.ts
function yamlScalar(value) {
  return JSON.stringify(value);
}
var OWNED_FRONTMATTER_KEYS = /* @__PURE__ */ new Set([
  "type",
  "title",
  "description",
  "resource",
  "tags",
  "aliases",
  "timestamp"
]);
var UNSAFE_PROPERTY_KEYS = /* @__PURE__ */ new Set(["__proto__", "constructor", "prototype"]);
var MAX_FRONTMATTER_VALUE_DEPTH = 100;
function stableYamlValue(value, propertyKey, path7 = propertyKey, ancestors = /* @__PURE__ */ new WeakSet(), depth = 0) {
  if (value instanceof Date) return new Date(value.getTime());
  const isArray = Array.isArray(value);
  if (!isArray && !isRecord(value)) return value;
  if (depth >= MAX_FRONTMATTER_VALUE_DEPTH) {
    throw new Error(
      `Cannot serialize frontmatter property ${JSON.stringify(propertyKey)}: nesting exceeds ${MAX_FRONTMATTER_VALUE_DEPTH} levels.`
    );
  }
  if (ancestors.has(value)) {
    throw new Error(
      `Cannot serialize frontmatter property ${JSON.stringify(propertyKey)}: cyclic value at ${path7}.`
    );
  }
  ancestors.add(value);
  try {
    if (isArray) {
      return value.map(
        (item, index) => stableYamlValue(item, propertyKey, `${path7}[${index}]`, ancestors, depth + 1)
      );
    }
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      if (UNSAFE_PROPERTY_KEYS.has(key)) continue;
      sorted[key] = stableYamlValue(
        value[key],
        propertyKey,
        `${path7}.${key}`,
        ancestors,
        depth + 1
      );
    }
    return sorted;
  } finally {
    ancestors.delete(value);
  }
}
function yamlProperty(key, value) {
  return dump(
    { [key]: stableYamlValue(value, key) },
    {
      forceQuotes: true,
      lineWidth: -1,
      noRefs: true,
      quotingType: '"',
      sortKeys: false
    }
  ).trimEnd();
}
function frontmatter(doc, timestamp) {
  const description = doc.properties?.description ?? descriptionFromMarkdown(doc.markdown);
  const lines = [
    "---",
    `type: ${yamlScalar(doc.type)}`,
    `title: ${yamlScalar(doc.title)}`,
    `description: ${yamlScalar(description)}`,
    `resource: ${yamlScalar(doc.resource ?? doc.sourcePath ?? doc.sourceId)}`,
    "tags:",
    ...doc.tags.length ? doc.tags.map((tag) => `  - ${yamlScalar(tag)}`) : ["  []"],
    ...doc.aliases?.length ? ["aliases:", ...doc.aliases.map((alias) => `  - ${yamlScalar(alias)}`)] : [],
    `timestamp: ${yamlScalar(timestamp)}`
  ];
  for (const key of Object.keys(doc.properties?.data ?? {}).sort()) {
    if (OWNED_FRONTMATTER_KEYS.has(key) || UNSAFE_PROPERTY_KEYS.has(key)) continue;
    lines.push(yamlProperty(key, doc.properties.data[key]));
  }
  lines.push("---", "");
  return lines.join("\n");
}
function withTitle(title, markdown) {
  const trimmed = markdown.trim();
  if (trimmed.match(/^#\s+/)) return trimmed;
  return `# ${title}

${trimmed}`;
}
function sourceKey(doc) {
  if (doc.resource) return canonicalizeUrl(doc.resource);
  return toPosixPath(doc.sourcePath ?? doc.sourceId);
}
function assignOutputPaths(docs) {
  const used = /* @__PURE__ */ new Set();
  const result = /* @__PURE__ */ new Map();
  for (const doc of docs) {
    const base = safeConceptOutputPath(
      doc.resource ? urlToOutputPath(doc.resource) : ensureMarkdownPath(doc.sourcePath ?? doc.sourceId)
    );
    let candidate = base;
    let index = 2;
    while (used.has(candidate)) {
      const parsed = path.posix.parse(base);
      candidate = path.posix.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`);
      index += 1;
    }
    used.add(candidate);
    result.set(sourceKey(doc), candidate);
    doc.outputPath = candidate;
  }
  return result;
}
function safeConceptOutputPath(candidate) {
  if (!isReservedOkfPath(candidate)) return candidate;
  const parsed = path.posix.parse(candidate);
  const safeName = parsed.name.toLowerCase() === "log" ? "change-log" : parsed.dir ? "overview" : "home";
  return path.posix.join(parsed.dir, `${safeName}.md`);
}
function addEdit(edits, edit) {
  const key = `${edit.start}:${edit.end}`;
  const existing = edits.get(key);
  if (existing && existing.replacement !== edit.replacement) {
    throw new Error(`Conflicting Markdown edits at ${key}.`);
  }
  edits.set(key, edit);
}
function applyEdits(markdown, editMap) {
  const edits = [...editMap.values()].sort(
    (first, second) => first.start - second.start || first.end - second.end
  );
  for (let index = 1; index < edits.length; index += 1) {
    const previous = edits[index - 1];
    const current = edits[index];
    if (current.start < previous.end) {
      throw new Error(
        `Overlapping Markdown edits at ${previous.start}:${previous.end} and ${current.start}:${current.end}.`
      );
    }
  }
  const rendered = [];
  let cursor = 0;
  for (const edit of edits) {
    rendered.push(markdown.slice(cursor, edit.start), edit.replacement);
    cursor = edit.end;
  }
  rendered.push(markdown.slice(cursor));
  return rendered.join("");
}
function rewriteMarkdownDestination(doc, href, sourceToOutput) {
  if (/^(https?:)?\/\//.test(href)) {
    try {
      const target = sourceToOutput.get(canonicalizeUrl(href));
      if (target && doc.outputPath) return relativeMarkdownLink(doc.outputPath, target);
    } catch {
      return void 0;
    }
    return void 0;
  }
  if (!href.startsWith("#") && doc.resource) {
    try {
      const key = canonicalizeUrl(href, doc.resource);
      const target = sourceToOutput.get(key);
      if (target && doc.outputPath) return relativeMarkdownLink(doc.outputPath, target);
      return key;
    } catch {
      return void 0;
    }
  }
  if (!href.startsWith("#") && doc.sourcePath) {
    const absolute = toPosixPath(
      path.posix.normalize(path.posix.join(path.posix.dirname(doc.sourcePath), href))
    );
    const target = sourceToOutput.get(absolute.split("#")[0] ?? absolute);
    if (target && doc.outputPath) return relativeMarkdownLink(doc.outputPath, target);
  }
  return void 0;
}
function headingFragment(link, target) {
  if (link.blockId) return link.blockId.normalize("NFC");
  const requested = link.heading?.trim().normalize("NFC");
  if (!requested) return "";
  const heading = target?.headings.find(
    (candidate) => candidate.text.normalize("NFC") === requested || candidate.slug.normalize("NFC") === requested
  );
  return heading?.slug ?? new GithubSlugger().slug(requested);
}
function markdownLinkText(value) {
  return value.replace(/\\/g, "\\\\").replace(/\[/g, "\\[").replace(/\]/g, "\\]");
}
function rewriteLinks(doc, sourceToOutput, sourceToDocument) {
  const edits = /* @__PURE__ */ new Map();
  for (const block of doc.blockIds ?? []) {
    addEdit(edits, {
      ...block.range,
      replacement: `<a id="${block.id}"></a>`
    });
  }
  for (const link of doc.semanticLinks ?? []) {
    if (link.kind === "markdown") {
      if (!link.destinationRange) continue;
      const replacement = rewriteMarkdownDestination(doc, link.target, sourceToOutput);
      if (replacement === void 0 || replacement === link.target) continue;
      addEdit(edits, { ...link.destinationRange, replacement });
      continue;
    }
    if (link.kind !== "wikilink" && link.kind !== "note_embed" || link.resolution !== "resolved" || !link.resolvedSourceKey || !doc.outputPath) {
      continue;
    }
    const targetOutput = sourceToOutput.get(link.resolvedSourceKey);
    if (!targetOutput) continue;
    const fragment = headingFragment(link, sourceToDocument.get(link.resolvedSourceKey));
    const destination = `${relativeMarkdownLink(doc.outputPath, targetOutput)}${fragment ? `#${fragment}` : ""}`;
    addEdit(edits, {
      ...link.range,
      replacement: `[${markdownLinkText(link.text)}](${destination})`
    });
  }
  return applyEdits(doc.markdown, edits);
}
async function pathExists(target) {
  try {
    await fs.lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
async function resolveForSafety(target) {
  const resolved = path.resolve(target);
  if (await pathExists(resolved)) return fs.realpath(resolved);
  const missingSegments = [path.basename(resolved)];
  let ancestor = path.dirname(resolved);
  while (!await pathExists(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor)
      throw new Error(`Unable to resolve output path ancestor for ${target}.`);
    missingSegments.unshift(path.basename(ancestor));
    ancestor = parent;
  }
  const realAncestor = await fs.realpath(ancestor);
  return path.join(realAncestor, ...missingSegments);
}
async function assertNoCwdSymlinkAncestor(target) {
  const cwd = path.resolve(process.cwd());
  const resolved = path.resolve(target);
  const relative = path.relative(cwd, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return;
  let current = cwd;
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`Unsafe output directory for --force: refusing symlink ancestor ${current}.`);
    }
  }
}
async function findRepoRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (await pathExists(path.join(current, ".git"))) return fs.realpath(current);
    const parent = path.dirname(current);
    if (parent === current) return void 0;
    current = parent;
  }
}
function containsOrEquals(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || !relative.startsWith("..") && !path.isAbsolute(relative);
}
async function okfyHomeForSafety() {
  return resolveForSafety(resolveOkfyHome());
}
async function assertSafeForceOutDir(outDir, options) {
  if (options.dangerouslyAllowUnsafeOutput) return;
  if (outDir.trim() === "") throw new Error("Unsafe output directory for --force: empty path.");
  const rawResolved = path.resolve(outDir);
  const existing = await pathExists(rawResolved);
  if (existing) {
    const stat = await fs.lstat(rawResolved);
    if (stat.isSymbolicLink()) {
      throw new Error(`Unsafe output directory for --force: refusing symlink ${outDir}.`);
    }
  }
  await assertNoCwdSymlinkAncestor(outDir);
  const realOutDir = await resolveForSafety(outDir);
  const forbidden = /* @__PURE__ */ new Map([
    [path.parse(realOutDir).root, "filesystem root"],
    [await fs.realpath(os.homedir()), "home directory"],
    [await fs.realpath(process.cwd()), "current working directory"],
    [await okfyHomeForSafety(), "OKFY_HOME"]
  ]);
  const addForbidden = (filePath, reason) => {
    if (!forbidden.has(filePath)) forbidden.set(filePath, reason);
  };
  const repoRoot = await findRepoRoot(process.cwd());
  if (repoRoot) addForbidden(repoRoot, "repository root");
  if (options.inputPath) {
    const inputReal = await resolveForSafety(options.inputPath);
    addForbidden(inputReal, "input path");
    addForbidden(path.dirname(inputReal), "parent of input path");
  }
  for (const [protectedPath, reason] of forbidden.entries()) {
    if (!containsOrEquals(realOutDir, protectedPath)) continue;
    const relation = realOutDir === protectedPath ? "delete" : "delete ancestor of";
    throw new Error(
      `Unsafe output directory for --force: refusing to ${relation} ${reason} (${protectedPath}) from ${realOutDir}.`
    );
  }
}
async function ensureCleanOutDir(outDir, options) {
  if (options.force) await assertSafeForceOutDir(outDir, options);
  try {
    const entries = await fs.readdir(outDir);
    if (entries.length > 0) {
      if (!options.force)
        throw new Error(`Output directory is not empty: ${outDir}. Use --force to overwrite.`);
      await fs.rm(outDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fs.mkdir(outDir, { recursive: true });
}
function titleForPath(relPath, fallback) {
  const basename = path.posix.basename(relPath, ".md");
  return fallback || basename;
}
function markdownLink(fromDir, toPath) {
  if (fromDir === ".") return toPath;
  return path.posix.relative(fromDir, toPath);
}
function indexTitle(dir, options) {
  if (dir === ".") return options.title ?? options.sourceName ?? "OKF Bundle";
  const leaf = path.posix.basename(dir);
  return leaf.split(/[-_\s]+/).filter(Boolean).map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join(" ");
}
async function writePlainIndex(outDir, dir, concepts, options) {
  const indexPath = dir === "." ? "index.md" : path.posix.join(dir, "index.md");
  const entries = (dir === "." ? concepts : concepts.filter((concept) => path.posix.dirname(concept.relPath) === dir)).slice().sort((a, b) => a.relPath.localeCompare(b.relPath));
  const lines = [
    `# ${indexTitle(dir, options)}`,
    "",
    ...entries.map(
      (concept) => `* [${concept.title}](${markdownLink(dir, concept.relPath)}) - ${concept.description}`
    )
  ];
  await fs.mkdir(path.dirname(path.join(outDir, indexPath)), { recursive: true });
  await fs.writeFile(path.join(outDir, indexPath), `${lines.join("\n").trimEnd()}
`, "utf8");
  return indexPath;
}
async function writeOkfBundle(docs, options) {
  if (docs.length === 0) throw new Error("No documents to write.");
  await ensureCleanOutDir(options.outDir, options);
  const timestamp = options.timestamp ?? (/* @__PURE__ */ new Date()).toISOString();
  const orderedDocs = docs.slice().sort((first, second) => sourceKey(first).localeCompare(sourceKey(second)));
  const sourceToOutput = assignOutputPaths(orderedDocs);
  const sourceToDocument = new Map(orderedDocs.map((doc) => [sourceKey(doc), doc]));
  const written = [];
  const concepts = [];
  for (const doc of orderedDocs) {
    const relPath = doc.outputPath ?? "index.md";
    const absolute = path.join(options.outDir, relPath);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    const body = withTitle(doc.title, rewriteLinks(doc, sourceToOutput, sourceToDocument));
    await fs.writeFile(absolute, `${frontmatter(doc, timestamp)}${body}
`, "utf8");
    written.push(relPath);
    concepts.push({
      relPath,
      title: titleForPath(relPath, doc.title),
      description: descriptionFromMarkdown(doc.markdown)
    });
  }
  written.push(await writePlainIndex(options.outDir, ".", concepts, options));
  const dirs = [
    ...new Set(
      concepts.map((concept) => path.posix.dirname(concept.relPath)).filter((dir) => dir !== ".")
    )
  ].sort();
  for (const dir of dirs) {
    written.push(await writePlainIndex(options.outDir, dir, concepts, options));
  }
  return written.sort();
}

// src/crawler.ts
import pLimit from "p-limit";

// src/crawl/discovery.ts
import robotsParser from "robots-parser";

// src/crawl/fetch-policy.ts
var USER_AGENT = okfyUserAgent();
var MAX_RESPONSE_BYTES = 5 * 1024 * 1024;
function isRedirect(status) {
  return status >= 300 && status < 400;
}
function isSecurityRejection(error) {
  const message = error instanceof Error ? error.message : "";
  return message.includes("Private network crawl target rejected") || message.includes("Cross-origin redirect rejected");
}
async function fetchWithRedirects(url, options, signal) {
  let current = url;
  for (let redirectCount = 0; redirectCount <= 10; redirectCount += 1) {
    if (!options.allowPrivateNetwork) await assertPublicNetworkUrl(current);
    if (options.sameOriginSeed && !sameOrigin(current, options.sameOriginSeed)) {
      throw new Error(`Cross-origin redirect rejected: ${current}`);
    }
    const response = await fetch(current, {
      signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,text/markdown,text/plain,*/*" },
      redirect: "manual"
    });
    if (!isRedirect(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) throw new Error(`Redirect missing location for ${current}`);
    current = canonicalizeUrl(location, current);
  }
  throw new Error(`Too many redirects for ${url}`);
}
async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15e3);
  try {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetchWithRedirects(url, options, controller.signal);
        if (!response.ok) {
          if ((response.status >= 500 || response.status === 429) && attempt < 2) {
            await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
            continue;
          }
          throw new Error(`Fetch failed ${response.status} for ${url}`);
        }
        const length = Number(response.headers.get("content-length") ?? "0");
        if (length > MAX_RESPONSE_BYTES) throw new Error(`Response too large for ${url}`);
        const text = await response.text();
        if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES)
          throw new Error(`Response too large for ${url}`);
        return { text, contentType: response.headers.get("content-type") ?? "" };
      } catch (error) {
        lastError = error;
        if (isSecurityRejection(error)) throw error;
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
    throw lastError ?? new Error(`Fetch failed for ${url}`);
  } finally {
    clearTimeout(timeout);
  }
}

// src/util/match.ts
import { minimatch } from "minimatch";
function matchesPattern(value, pattern) {
  if (pattern.startsWith("/") && pattern.endsWith("/") && pattern.length > 2) {
    try {
      return new RegExp(pattern.slice(1, -1)).test(value);
    } catch {
      return false;
    }
  }
  try {
    return minimatch(value, pattern, { dot: true });
  } catch {
    return false;
  }
}
function matchesAnyPattern(value, patterns) {
  return Boolean(patterns?.some((pattern) => matchesPattern(value, pattern)));
}

// src/crawl/discovery.ts
async function loadRobots(seedUrl, enabled) {
  if (!enabled) return void 0;
  const origin = new URL(seedUrl).origin;
  try {
    const fetched = await fetchText(`${origin}/robots.txt`, { sameOriginSeed: seedUrl });
    const text = fetched.text;
    return robotsParser(`${origin}/robots.txt`, text);
  } catch {
    return robotsParser(`${origin}/robots.txt`, "");
  }
}
function shouldVisit(url, seed, options, robots) {
  if (!isHttpUrl(url)) return false;
  if ((options.sameOrigin ?? true) && !sameOrigin(url, seed)) return false;
  if (!options.allowPrivateNetwork && isPrivateNetworkUrl(url)) return false;
  if (options.include?.length && !matchesAnyPattern(url, options.include)) return false;
  if (matchesAnyPattern(url, options.exclude)) return false;
  if (robots && !robots.isAllowed(url, USER_AGENT)) return false;
  return true;
}

// src/crawl/extraction.ts
import * as cheerio2 from "cheerio";
function contentTypeFromHeader(header) {
  const lower = header.toLowerCase();
  if (lower.includes("text/html")) return "html";
  if (lower.includes("markdown")) return "markdown";
  if (lower.includes("text/plain")) return "text";
  if (!lower) return "html";
  return void 0;
}
function extractRawHtmlLinks(raw) {
  const $ = cheerio2.load(raw);
  return $("a[href]").map((_, element) => ({
    href: String($(element).attr("href") ?? ""),
    text: $(element).text().trim()
  })).get().filter((link) => link.href.length > 0);
}
function normalizeFetchedDocument(options) {
  const raw = {
    sourceId: options.url,
    url: options.url,
    contentType: options.contentType,
    raw: options.text,
    discoveredAt: options.discoveredAt
  };
  return normalizeDocument(raw);
}

// src/crawl/write.ts
async function writeCrawlBundle(documents, options) {
  if (documents.length === 0) throw new Error("Crawl generated zero concepts.");
  options.onProgress?.({
    type: "writing",
    concepts: documents.length,
    outDir: options.outDir
  });
  return writeOkfBundle(documents, {
    outDir: options.outDir,
    title: options.title,
    sourceName: options.seedUrl,
    force: options.force,
    dangerouslyAllowUnsafeOutput: options.dangerouslyAllowUnsafeOutput,
    timestamp: options.timestamp
  });
}

// src/crawler.ts
async function crawlWebsite(options) {
  const seed = canonicalizeUrl(options.seedUrl);
  if (!options.allowPrivateNetwork && isPrivateNetworkUrl(seed)) {
    throw new Error(
      "Private network crawl target rejected. Use --allow-private-network for trusted local fixtures."
    );
  }
  if (!options.allowPrivateNetwork) await assertPublicNetworkUrl(seed);
  const maxPages = options.maxPages ?? 100;
  const maxDepth = options.maxDepth ?? 4;
  const robots = await loadRobots(seed, options.respectRobots ?? true);
  const queue = [{ url: seed, depth: 0 }];
  const queued = /* @__PURE__ */ new Set([seed]);
  const visited = /* @__PURE__ */ new Set();
  const planned = [];
  const documents = [];
  let skipped = 0;
  let failed = 0;
  const limit = pLimit(options.concurrency ?? 4);
  options.onProgress?.({ type: "start", seed, maxPages, maxDepth });
  while (queue.length > 0 && visited.size < maxPages) {
    const batch = queue.splice(0, Math.min(queue.length, maxPages - visited.size));
    await Promise.all(
      batch.map(
        (item) => limit(async () => {
          if (visited.has(item.url)) return;
          visited.add(item.url);
          if (!shouldVisit(item.url, seed, options, robots)) {
            skipped += 1;
            options.onProgress?.({
              type: "skipped",
              url: item.url,
              fetched: documents.length,
              queued: queue.length,
              maxPages
            });
            return;
          }
          planned.push(item.url);
          options.onProgress?.({
            type: "fetch",
            url: item.url,
            fetched: documents.length,
            queued: queue.length,
            maxPages
          });
          try {
            const fetched = await fetchText(item.url, {
              allowPrivateNetwork: options.allowPrivateNetwork,
              sameOriginSeed: options.sameOrigin ?? true ? seed : void 0
            });
            const contentType = contentTypeFromHeader(fetched.contentType);
            if (!contentType) {
              skipped += 1;
              return;
            }
            const doc = normalizeFetchedDocument({
              url: item.url,
              contentType,
              text: fetched.text,
              discoveredAt: options.timestamp ?? (/* @__PURE__ */ new Date()).toISOString()
            });
            if (!options.dryRun) documents.push(doc);
            let discovered = 0;
            if (item.depth < maxDepth) {
              const links = options.dryRun && contentType === "html" ? extractRawHtmlLinks(fetched.text) : doc.links;
              for (const link of links) {
                try {
                  const next = canonicalizeUrl(link.href, item.url);
                  if (!queued.has(next) && shouldVisit(next, seed, options, robots) && (options.allowPrivateNetwork || !await resolvesToPrivateNetwork(next)) && queued.size < maxPages * 4) {
                    queued.add(next);
                    queue.push({ url: next, depth: item.depth + 1 });
                    discovered += 1;
                  }
                } catch {
                  skipped += 1;
                }
              }
            }
            options.onProgress?.({
              type: "fetched",
              url: item.url,
              fetched: options.dryRun ? planned.length : documents.length,
              queued: queue.length,
              discovered,
              maxPages
            });
          } catch (error) {
            if (isSecurityRejection(error)) throw error;
            failed += 1;
            options.onProgress?.({
              type: "failed",
              url: item.url,
              fetched: documents.length,
              queued: queue.length,
              maxPages
            });
          }
        })
      )
    );
  }
  if (options.dryRun) {
    return {
      pagesFetched: planned.length,
      skipped,
      failed,
      written: [],
      documents: [],
      dryRunPages: planned.slice(0, maxPages)
    };
  }
  const written = await writeCrawlBundle(documents, { ...options, seedUrl: seed });
  return { pagesFetched: documents.length, skipped, failed, written, documents };
}

// src/importer.ts
import fs2 from "fs/promises";
import path2 from "path";
function contentTypeFor(file) {
  const ext = path2.extname(file).toLowerCase();
  if (ext === ".md") return "markdown";
  if (ext === ".mdx") return "mdx";
  if (ext === ".html" || ext === ".htm") return "html";
  if (ext === ".txt") return "text";
  return void 0;
}
async function listFiles(root) {
  const stat = await fs2.stat(root);
  if (stat.isFile()) return { files: [root], rootIsFile: true };
  const files = [];
  async function walk(dir) {
    for (const entry of await fs2.readdir(dir, { withFileTypes: true })) {
      const absolute = path2.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (![".git", "node_modules", "dist"].includes(entry.name)) await walk(absolute);
      } else if (entry.isFile()) {
        files.push(absolute);
      }
    }
  }
  await walk(root);
  return { files: files.sort(), rootIsFile: false };
}
async function importLocal(options) {
  const root = path2.resolve(options.inputPath);
  const { files, rootIsFile } = await listFiles(root);
  const docs = [];
  for (const file of files) {
    const rel = normalizeVaultPath(rootIsFile ? path2.basename(file) : path2.relative(root, file));
    if (options.include?.length && !matchesAnyPattern(rel, options.include)) continue;
    if (matchesAnyPattern(rel, options.exclude)) continue;
    const contentType = contentTypeFor(file);
    if (!contentType) continue;
    const raw = {
      sourceId: rel,
      filePath: rel,
      contentType,
      raw: await fs2.readFile(file, "utf8"),
      discoveredAt: options.timestamp ?? (/* @__PURE__ */ new Date()).toISOString()
    };
    docs.push(normalizeDocument(raw));
  }
  if (docs.length === 0) throw new Error("No supported Markdown, MDX, HTML, or text files found.");
  docs.sort(
    (first, second) => first.sourceId < second.sourceId ? -1 : first.sourceId > second.sourceId ? 1 : 0
  );
  const diagnostics = resolveVaultDocuments(docs);
  const written = await writeOkfBundle(docs, {
    outDir: options.outDir,
    title: options.sourceName,
    sourceName: options.sourceName ?? options.inputPath,
    force: options.force,
    inputPath: root,
    dangerouslyAllowUnsafeOutput: options.dangerouslyAllowUnsafeOutput,
    timestamp: options.timestamp
  });
  return { written, documents: docs, diagnostics };
}

// src/hash.ts
import crypto from "crypto";
import fs3 from "fs/promises";
import path3 from "path";
async function listBundleFiles(bundleDir) {
  const files = [];
  async function walk(current) {
    for (const entry of await fs3.readdir(current, { withFileTypes: true })) {
      const absolutePath = path3.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
      } else if (entry.isFile()) {
        files.push({
          absolutePath,
          relativePath: toPosixPath(path3.relative(bundleDir, absolutePath))
        });
      }
    }
  }
  await walk(bundleDir);
  return files.sort((first, second) => first.relativePath.localeCompare(second.relativePath));
}
async function hashBundleContents(bundleDir) {
  const hash = crypto.createHash("sha256");
  const files = await listBundleFiles(bundleDir);
  for (const file of files) {
    const contents = await fs3.readFile(file.absolutePath);
    hash.update(`${file.relativePath.length}:${file.relativePath}\0${contents.byteLength}:`);
    hash.update(contents);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

// src/refresh.ts
import fs4 from "fs/promises";
import path4 from "path";
import { randomUUID } from "crypto";
var DEFAULT_STALE_LOCK_TIMEOUT_MS = 30 * 60 * 1e3;
async function pathExists2(target) {
  try {
    await fs4.access(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
function secondsBetween(startIso, end) {
  return (end.getTime() - new Date(startIso).getTime()) / 1e3;
}
function iso(date) {
  return date.toISOString();
}
function addSeconds(date, seconds) {
  return new Date(date.getTime() + seconds * 1e3).toISOString();
}
function isBeforeNextRefreshAllowed(state, now) {
  if (!state?.nextRefreshAllowedAt) return false;
  return new Date(state.nextRefreshAllowedAt).getTime() > now.getTime();
}
function tempBundleDir(sourceDir) {
  return path4.join(sourceDir, `bundle.tmp-${process.pid}-${randomUUID()}`);
}
function lockfilePath(sourceDir) {
  return path4.join(sourceDir, ".refresh.lock");
}
async function isLockStale(lockPath, now, staleLockTimeoutMs) {
  try {
    const raw = await fs4.readFile(lockPath, "utf8");
    const parsed = JSON.parse(raw);
    const createdAt = parsed.createdAt ? Date.parse(parsed.createdAt) : Number.NaN;
    if (Number.isFinite(createdAt)) return now.getTime() - createdAt > staleLockTimeoutMs;
  } catch {
  }
  const stat = await fs4.stat(lockPath);
  return now.getTime() - stat.mtimeMs > staleLockTimeoutMs;
}
async function acquireRefreshLock(sourceDir, now, staleLockTimeoutMs) {
  const lockPath = lockfilePath(sourceDir);
  await fs4.mkdir(sourceDir, { recursive: true });
  try {
    const handle = await fs4.open(lockPath, "wx");
    await handle.writeFile(JSON.stringify({ pid: process.pid, createdAt: iso(now) }, null, 2));
    await handle.close();
    return {
      acquired: true,
      release: async () => {
        await fs4.rm(lockPath, { force: true });
      }
    };
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
  }
  if (await isLockStale(lockPath, now, staleLockTimeoutMs)) {
    await fs4.rm(lockPath, { force: true });
    return acquireRefreshLock(sourceDir, now, staleLockTimeoutMs);
  }
  return { acquired: false };
}
function stateForRefreshStart(state, freshness, startedAt) {
  return {
    schemaVersion: 1,
    status: "refreshing",
    lastCheckedAt: iso(startedAt),
    lastRefreshStartedAt: iso(startedAt),
    lastRefreshCompletedAt: state?.lastRefreshCompletedAt ?? null,
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null,
    refreshInProgress: true,
    lastError: state?.lastError ?? null,
    bundle: state?.bundle ?? (freshness.validation ? bundleStateFromValidation(freshness.validation, state?.bundle?.contentHash ?? "") : null)
  };
}
function stateForLockedRefresh(state, checkedAt) {
  return {
    schemaVersion: 1,
    status: "refreshing",
    lastCheckedAt: iso(checkedAt),
    lastRefreshStartedAt: state?.lastRefreshStartedAt ?? null,
    lastRefreshCompletedAt: state?.lastRefreshCompletedAt ?? null,
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null,
    refreshInProgress: true,
    lastError: state?.lastError ?? null,
    bundle: state?.bundle ?? null
  };
}
function stateForCheckedRefresh(state, status, checkedAt) {
  return {
    schemaVersion: 1,
    status,
    lastCheckedAt: iso(checkedAt),
    lastRefreshStartedAt: state?.lastRefreshStartedAt ?? null,
    lastRefreshCompletedAt: state?.lastRefreshCompletedAt ?? null,
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null,
    refreshInProgress: false,
    lastError: state?.lastError ?? null,
    bundle: state?.bundle ?? null
  };
}
function messageFromError(error) {
  return error instanceof Error ? error.message : String(error);
}
function errorState(manifest, error, occurredAt) {
  return {
    message: messageFromError(error),
    sourceName: manifest.name,
    seedUrl: manifest.source.seedUrl,
    occurredAt: iso(occurredAt)
  };
}
function stateForRefreshFailure(state, manifest, error, startedAt) {
  return {
    schemaVersion: 1,
    status: "failed",
    lastCheckedAt: iso(startedAt),
    lastRefreshStartedAt: iso(startedAt),
    lastRefreshCompletedAt: iso(startedAt),
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: addSeconds(startedAt, manifest.refresh.minIntervalSeconds),
    refreshInProgress: false,
    lastError: errorState(manifest, error, startedAt),
    bundle: state?.bundle ?? null
  };
}
function bundleStateFromValidation(validation, contentHash) {
  return {
    conceptCount: validation.conceptCount,
    warningCount: validation.warningCount,
    valid: validation.valid,
    contentHash
  };
}
async function replaceActiveBundle(tempDir, bundleDir) {
  await assertSafeForceOutDir(bundleDir, { outDir: bundleDir, force: true });
  const backupDir = `${bundleDir}.backup-${process.pid}-${randomUUID()}`;
  let movedActiveToBackup = false;
  try {
    await fs4.mkdir(path4.dirname(bundleDir), { recursive: true });
    if (await pathExists2(bundleDir)) {
      await fs4.rename(bundleDir, backupDir);
      movedActiveToBackup = true;
    }
    await fs4.rename(tempDir, bundleDir);
    if (movedActiveToBackup) await fs4.rm(backupDir, { recursive: true, force: true });
  } catch (error) {
    if (movedActiveToBackup && !await pathExists2(bundleDir) && await pathExists2(backupDir)) {
      await fs4.rename(backupDir, bundleDir);
    }
    throw error;
  }
}
async function evaluateFreshness(options) {
  const now = options.now ?? /* @__PURE__ */ new Date();
  const validateBundle2 = options.validateBundle ?? validateBundle;
  if (!await pathExists2(options.bundleDir)) {
    return { status: "missing", reason: "bundle_missing" };
  }
  if (options.state?.refreshInProgress) {
    return { status: "refreshing", reason: "refresh_in_progress" };
  }
  if ((options.state?.status === "failed" || options.state?.lastError) && isBeforeNextRefreshAllowed(options.state, now)) {
    return { status: "failed", reason: "latest_refresh_failed" };
  }
  const validation = await validateBundle2(options.bundleDir);
  if (!validation.valid) {
    return { status: "failed", reason: "bundle_invalid", validation };
  }
  if (options.state?.status === "failed" || options.state?.lastError) {
    return {
      status: isBeforeNextRefreshAllowed(options.state, now) ? "failed" : "stale",
      reason: "latest_refresh_failed",
      validation
    };
  }
  const lastSuccessfulRefreshAt = options.state?.lastSuccessfulRefreshAt;
  if (!lastSuccessfulRefreshAt) {
    return { status: "stale", reason: "never_refreshed", validation };
  }
  const maxAgeSeconds = options.maxAgeSeconds ?? options.manifest.refresh.maxAgeSeconds;
  if (secondsBetween(lastSuccessfulRefreshAt, now) > maxAgeSeconds) {
    return { status: "stale", reason: "exceeded_max_age", validation };
  }
  return { status: "fresh", reason: "within_max_age", validation };
}
async function refreshSource(options) {
  const now = options.now ?? /* @__PURE__ */ new Date();
  const crawlRunner = options.crawlRunner ?? crawlWebsite;
  const inspectBundle2 = options.inspectBundle ?? inspectBundle;
  const hashBundleContent = options.hashBundleContent ?? hashBundleContents;
  const freshness = await evaluateFreshness({
    manifest: options.manifest,
    state: options.state,
    bundleDir: options.bundleDir,
    now,
    validateBundle: options.validateBundle
  });
  if (!options.force && freshness.status === "fresh") {
    const nextState = stateForCheckedRefresh(options.state, "fresh", now);
    await options.writeState(nextState);
    return { status: "fresh", reason: "fresh", skipped: true, state: nextState };
  }
  if (!options.force && isBeforeNextRefreshAllowed(options.state, now)) {
    const nextState = stateForCheckedRefresh(options.state, freshness.status, now);
    await options.writeState(nextState);
    return { status: freshness.status, reason: "min_interval", skipped: true, state: nextState };
  }
  const tempDir = tempBundleDir(options.sourceDir);
  if (options.dryRun) {
    try {
      const crawlResult = await crawlRunner({
        ...options.manifest.crawl,
        seedUrl: options.manifest.source.seedUrl,
        outDir: tempDir,
        dryRun: true,
        timestamp: iso(now)
      });
      return { status: freshness.status, skipped: false, dryRun: true, crawlResult };
    } finally {
      await fs4.rm(tempDir, { recursive: true, force: true });
    }
  }
  const lock = await acquireRefreshLock(
    options.sourceDir,
    now,
    options.staleLockTimeoutMs ?? DEFAULT_STALE_LOCK_TIMEOUT_MS
  );
  if (!lock.acquired) {
    const lockedState = stateForLockedRefresh(options.state, now);
    await options.writeState(lockedState);
    return { status: "refreshing", reason: "locked", skipped: true, state: lockedState };
  }
  const startedState = stateForRefreshStart(options.state, freshness, now);
  try {
    await options.writeState(startedState);
    const crawlResult = await crawlRunner({
      ...options.manifest.crawl,
      seedUrl: options.manifest.source.seedUrl,
      outDir: tempDir,
      force: true,
      dryRun: false,
      timestamp: iso(now)
    });
    const validation = await (options.validateBundle ?? validateBundle)(tempDir);
    if (!validation.valid) {
      throw new Error(`Refresh generated invalid bundle for ${options.manifest.name}.`);
    }
    const inspection = await inspectBundle2(tempDir);
    const contentHash = await hashBundleContent(tempDir);
    await replaceActiveBundle(tempDir, options.bundleDir);
    const nextState = {
      schemaVersion: 1,
      status: "fresh",
      lastCheckedAt: iso(now),
      lastRefreshStartedAt: iso(now),
      lastRefreshCompletedAt: iso(now),
      lastSuccessfulRefreshAt: iso(now),
      nextRefreshAllowedAt: addSeconds(now, options.manifest.refresh.minIntervalSeconds),
      refreshInProgress: false,
      lastError: null,
      bundle: {
        conceptCount: inspection.conceptCount,
        warningCount: inspection.warningCount,
        valid: validation.valid,
        contentHash
      }
    };
    await options.writeState(nextState);
    return { status: "fresh", skipped: false, state: nextState, crawlResult };
  } catch (error) {
    await fs4.rm(tempDir, { recursive: true, force: true });
    const failedState = stateForRefreshFailure(options.state, options.manifest, error, now);
    await options.writeState(failedState);
    return {
      status: "failed",
      skipped: false,
      state: failedState,
      error: failedState.lastError ?? void 0
    };
  } finally {
    await lock.release();
  }
}

// src/duration.ts
var DURATION_UNITS = {
  s: 1,
  m: 60,
  h: 60 * 60,
  d: 24 * 60 * 60
};
function parseDurationSeconds(input) {
  const value = input.trim();
  const match = /^(\d+)([smhd])$/.exec(value);
  if (!match) {
    throw new Error(`Invalid duration "${input}". Use a number followed by s, m, h, or d.`);
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? "";
  const multiplier = DURATION_UNITS[unit];
  const seconds = amount * multiplier;
  if (!Number.isSafeInteger(seconds)) {
    throw new Error(`Invalid duration "${input}". Duration is too large.`);
  }
  return seconds;
}

// src/activation.ts
import fs5 from "fs/promises";
import path5 from "path";
var PACKET_FILES = [
  { label: "Inspector HTML", fileName: "okfy-inspector.html" },
  { label: "Setup Markdown", fileName: "okfy-setup.md" },
  { label: "Proof JSON", fileName: "okfy-proof.json" }
];
async function buildActivationPacket(options) {
  const outDir = path5.resolve(options.outDir);
  const protectedInputPaths = uniqueResolvedPaths(
    options.protectedInputPaths ?? protectedActivationInputPaths(options.records)
  );
  const files = PACKET_FILES.map((file) => ({ ...file, path: path5.join(outDir, file.fileName) }));
  const usesRegistered = options.records.some(isRegisteredWorkspaceRecord) || isAllTarget(options.commandTarget);
  const okfyHome = usesRegistered ? options.okfyHome ?? process.env.OKFY_HOME ?? defaultOkfyHome() : defaultOkfyHome();
  const serverIdentity = options.serverIdentity ?? options.records.map((record) => record.name);
  const serverName = mcpServerName(serverIdentity);
  const codexServerName = codexMcpServerName(serverIdentity);
  const command = serveCommand(options.commandTarget, okfyHome, defaultOkfyHome(), {
    autoRefresh: options.autoRefresh ?? usesRegistered
  });
  const artifacts = renderMcpClientArtifacts({
    client: options.client,
    serverName,
    codexServerName,
    command
  });
  const workspace = options.report.target.kind !== "bundle";
  const firstPrompt = firstAgentPrompt(options.client === "codex" ? codexServerName : serverName, {
    workspace
  });
  const setup = {
    client: options.client,
    serverName,
    codexServerName,
    command,
    artifacts,
    firstPrompt
  };
  const proof = await buildActivationProof({
    records: options.records,
    report: options.report,
    proofTask: options.proofTask,
    generatedAt: options.generatedAt ?? (/* @__PURE__ */ new Date()).toISOString()
  });
  return {
    schemaVersion: 1,
    generatedBy: "okfy",
    outDir,
    protectedInputPaths,
    setup,
    proof,
    files
  };
}
function withActivationMetadata(report, packet) {
  return {
    ...report,
    activation: {
      client: packet.setup.client,
      serverName: packet.setup.serverName,
      codexServerName: packet.setup.codexServerName,
      command: {
        display: packet.setup.command.display,
        env: packet.setup.command.env
      },
      firstPrompt: packet.setup.firstPrompt,
      artifacts: packet.setup.artifacts.map((artifact) => ({
        label: artifact.label,
        format: artifact.format,
        body: artifact.body
      })),
      files: packet.files.map((file) => ({ label: file.label, path: file.path }))
    }
  };
}
function renderActivationSetupMarkdown(packet) {
  const lines = [
    "# OKFY Activation Packet",
    "",
    `Status: ${packet.proof.summary.result.readiness.validationStatus}`,
    `Client: ${packet.setup.client}`,
    `Server: ${packet.setup.serverName}`,
    "",
    "## MCP Launch Command",
    "",
    "```bash",
    packet.setup.command.display,
    "```",
    ""
  ];
  if (Object.keys(packet.setup.command.env).length) {
    lines.push("Environment:", "");
    lines.push("```json", JSON.stringify(packet.setup.command.env, null, 2), "```", "");
  }
  lines.push("## Client Setup", "");
  for (const artifact of packet.setup.artifacts) {
    lines.push(`### ${artifact.label}`, "", codeFence(artifact.format), artifact.body, "```", "");
  }
  lines.push(
    "## First Prompt",
    "",
    "```text",
    packet.setup.firstPrompt,
    "```",
    "",
    "## Proof",
    "",
    `Query: ${packet.proof.search.input.query}`,
    `Search results: ${packet.proof.search.results.length}`,
    `Read concept: ${packet.proof.read?.result.ref ?? "none"}`,
    `Citation: ${packet.proof.read?.result.citation.sourceResource ?? "none"}`,
    "",
    "## Packet Files",
    ""
  );
  for (const file of packet.files) lines.push(`- ${file.label}: \`${file.path}\``);
  return `${lines.join("\n").trimEnd()}
`;
}
async function writeActivationPacketFiles(packet, contents, options = {}) {
  await ensureActivationOutDir(packet.outDir, {
    force: Boolean(options.force),
    protectedInputPaths: options.protectedInputPaths ?? packet.protectedInputPaths
  });
  await Promise.all([
    writeFileAtomically(packet.files[0].path, contents.inspectorHtml),
    writeFileAtomically(packet.files[1].path, contents.setupMarkdown),
    writeFileAtomically(packet.files[2].path, `${JSON.stringify(packet.proof, null, 2)}
`)
  ]);
}
async function buildActivationProof(options) {
  const loaded = await loadSources(options.records);
  const primary = firstReadableConcept(loaded, options.report);
  const taskQuery = normalizeProofTask(options.proofTask);
  const query = taskQuery ?? (primary ? queryForConcept(primary.concept) : "documentation");
  const searchSource = sourceScopedProofSearch(loaded, options.report);
  const searchResults = loaded.length ? searchProofResults(loaded, query, options.report, searchSource) : [];
  const searchedTarget = conceptForSearchResult(loaded, searchResults[0], options.report);
  const readTarget = searchedTarget ?? (taskQuery ? void 0 : primary);
  return {
    schemaVersion: 1,
    generatedBy: "okfy",
    generatedAt: options.generatedAt,
    target: options.report.target,
    summary: {
      tool: "bundle_summary",
      result: {
        title: options.report.title,
        readiness: options.report.readiness,
        sources: options.report.sources
      }
    },
    search: {
      tool: "search_concepts",
      input: {
        query,
        limit: 5,
        ...searchSource ? { source: searchSource } : {}
      },
      results: searchResults
    },
    read: readTarget ? readProof(readTarget, options.report) : null,
    neighbors: readTarget ? neighborProof(readTarget, options.report) : null
  };
}
async function loadSources(records) {
  const loaded = [];
  for (const record of records) {
    if (record.loadError) continue;
    try {
      loaded.push({ record, search: await BundleSearch.fromBundle(record.bundleDir) });
    } catch {
    }
  }
  return loaded;
}
function firstReadableConcept(loaded, report) {
  for (const source of loaded) {
    const concept = [...source.search.graph.concepts.values()].sort(
      (first, second) => first.id.localeCompare(second.id)
    )[0];
    if (concept) return proofConcept(source, concept, report);
  }
  return void 0;
}
function searchProofResults(loaded, query, report, sourceName) {
  const searchable = sourceName ? loaded.filter((source) => source.record.name === sourceName) : loaded;
  return searchable.flatMap(
    (source) => source.search.search(query, { limit: 5 }).map((result) => proofSearchResult(source, result, report))
  ).sort(
    (first, second) => second.score - first.score || (first.sourceName ?? "").localeCompare(second.sourceName ?? "") || first.id.localeCompare(second.id)
  ).slice(0, 5);
}
function sourceScopedProofSearch(loaded, report) {
  if (report.target.kind === "bundle") return void 0;
  return loaded.length === 1 ? loaded[0].record.name : void 0;
}
function conceptForSearchResult(loaded, result, report) {
  if (!result) return void 0;
  const source = result.sourceName ? loaded.find((candidate) => candidate.record.name === result.sourceName) : loaded[0];
  const concept = source?.search.getConcept(result.id);
  return source && concept ? proofConcept(source, concept, report) : void 0;
}
function readProof(target, report) {
  return {
    tool: "read_concept",
    input: {
      id: target.concept.id,
      ...report.target.kind !== "bundle" ? { source: target.record.name } : {},
      max_chars: 4e3
    },
    result: {
      id: target.concept.id,
      ref: target.ref,
      title: target.concept.title,
      type: target.concept.type,
      resource: target.concept.resource,
      bodyPreview: target.concept.body.replace(/\s+/g, " ").trim().slice(0, 500),
      citation: {
        ref: target.ref,
        sourceResource: target.concept.resource,
        ...report.target.kind !== "bundle" ? { sourceName: target.record.name } : {}
      }
    }
  };
}
function neighborProof(target, report) {
  return {
    tool: "get_neighbors",
    input: {
      id: target.concept.id,
      ...report.target.kind !== "bundle" ? { source: target.record.name } : {},
      depth: 1
    },
    result: {
      outbound: (target.search.graph.outbound.get(target.concept.id) ?? []).map((id) => refFor(target.record, id, report)).sort(),
      backlinks: (target.search.graph.backlinks.get(target.concept.id) ?? []).map((id) => refFor(target.record, id, report)).sort()
    }
  };
}
function proofSearchResult(source, result, report) {
  return {
    ...report.target.kind !== "bundle" ? { sourceName: source.record.name } : {},
    id: result.id,
    ref: refFor(source.record, result.id, report),
    title: result.title,
    type: result.type,
    resource: result.resource,
    snippet: result.snippet,
    score: result.score
  };
}
function proofConcept(source, concept, report) {
  return {
    record: source.record,
    search: source.search,
    concept,
    ref: refFor(source.record, concept.id, report)
  };
}
function refFor(record, id, report) {
  return report.concepts.find((concept) => concept.sourceName === record.name && concept.id === id)?.ref ?? report.concepts.find((concept) => concept.id === id)?.ref ?? (report.target.kind === "bundle" ? id : `${record.name}:${id}`);
}
function queryForConcept(concept) {
  const candidate = concept.title ?? concept.description ?? concept.id;
  return candidate.replace(/[^A-Za-z0-9\s._-]+/g, " ").replace(/\s+/g, " ").trim() || concept.id;
}
function normalizeProofTask(task) {
  const normalized = task?.replace(/\s+/g, " ").trim();
  return normalized || void 0;
}
async function ensureActivationOutDir(outDir, options) {
  const protectedInputPaths = uniqueResolvedPaths(options.protectedInputPaths ?? []);
  assertActivationOutDirDoesNotTargetProtectedPaths(outDir, protectedInputPaths);
  if (options.force) {
    if (protectedInputPaths.length) {
      for (const inputPath of protectedInputPaths) {
        await assertSafeForceOutDir(outDir, { outDir, force: true, inputPath });
      }
    } else {
      await assertSafeForceOutDir(outDir, { outDir, force: true });
    }
  }
  try {
    const entries = await fs5.readdir(outDir);
    if (entries.length > 0) {
      if (!options.force)
        throw new Error(
          `Activation output directory is not empty: ${outDir}. Use --force to overwrite.`
        );
      await fs5.rm(outDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await fs5.mkdir(outDir, { recursive: true });
}
function assertActivationOutDirDoesNotTargetProtectedPaths(outDir, protectedInputPaths) {
  const resolvedOut = path5.resolve(outDir);
  let nestedConflict;
  for (const inputPath of protectedInputPaths) {
    const protectedPath = path5.resolve(inputPath);
    if (resolvedOut === protectedPath) {
      throw new Error(
        `Activation output directory cannot target a selected source path: ${resolvedOut}. Choose a separate --out directory.`
      );
    }
    if (isPathInside(protectedPath, resolvedOut))
      nestedConflict ??= { relation: "descendant", protectedPath };
    if (isPathInside(resolvedOut, protectedPath))
      nestedConflict ??= { relation: "ancestor", protectedPath };
  }
  if (nestedConflict?.relation === "descendant") {
    throw new Error(
      `Activation output directory cannot be inside a selected source path: ${resolvedOut} is inside ${nestedConflict.protectedPath}. Choose a separate --out directory.`
    );
  }
  if (nestedConflict?.relation === "ancestor") {
    throw new Error(
      `Activation output directory cannot contain a selected source path: ${resolvedOut} contains ${nestedConflict.protectedPath}. Choose a separate --out directory.`
    );
  }
}
function protectedActivationInputPaths(records) {
  return records.flatMap(
    (record) => isRegisteredWorkspaceRecord(record) ? [record.bundleDir, record.dir] : [record.bundleDir]
  );
}
function isPathInside(parentPath, childPath) {
  const relative = path5.relative(parentPath, childPath);
  return relative !== "" && !relative.startsWith("..") && !path5.isAbsolute(relative);
}
function uniqueResolvedPaths(paths) {
  return Array.from(new Set(paths.map((filePath) => path5.resolve(filePath))));
}
async function writeFileAtomically(filePath, contents) {
  const resolved = path5.resolve(filePath);
  const tempPath = `${resolved}.tmp-${process.pid}-${Date.now()}`;
  await fs5.mkdir(path5.dirname(resolved), { recursive: true });
  try {
    await fs5.writeFile(tempPath, contents, "utf8");
    await fs5.rename(tempPath, resolved);
  } catch (error) {
    await fs5.rm(tempPath, { force: true });
    throw error;
  }
}
function codeFence(format) {
  if (format === "toml") return "```toml";
  if (format === "json") return "```json";
  return "```bash";
}
function isAllTarget(target) {
  return typeof target === "object" && !Array.isArray(target) && target.all;
}

// src/inspector.ts
import path6 from "path";
async function buildBundleInspectorReport(bundleDir, options = {}) {
  const resolved = path6.resolve(bundleDir);
  const record = localBundleRecord(resolved);
  return buildInspectorReport([record], {
    target: { kind: "bundle", bundleDir: resolved },
    title: options.title ?? `${path6.basename(resolved)} OKFY Inspector`,
    prefixSingleSourceRefs: false
  });
}
async function buildWorkspaceInspectorReport(records, options = {}) {
  return buildInspectorReport(records, {
    target: {
      kind: "workspace",
      workspaceName: options.workspaceName,
      sourceNames: records.map((record) => record.name)
    },
    title: options.title ?? `${options.workspaceName ?? "Workspace"} OKFY Inspector`,
    prefixSingleSourceRefs: true
  });
}
async function buildInspectorReport(records, options) {
  const sourceReports = await Promise.all(
    records.map(
      (record) => sourceReport(record, {
        prefixRefs: options.prefixSingleSourceRefs || records.length > 1
      })
    )
  );
  const sources = sourceReports.map((report) => report.source);
  const concepts = sourceReports.flatMap((report) => report.concepts);
  const edges = sourceReports.flatMap((report) => report.edges);
  const readiness = summarizeReadiness(sources);
  return {
    schemaVersion: 1,
    title: options.title,
    generatedBy: "okfy",
    target: options.target,
    readiness,
    sources,
    concepts,
    edges,
    agentPreview: agentPreview(sources, concepts)
  };
}
async function sourceReport(record, options) {
  const baseSource = sourceBase(record);
  if (record.loadError) {
    return {
      source: unavailableSource(baseSource, record.loadError, record.state),
      concepts: [],
      edges: []
    };
  }
  let search;
  try {
    search = await BundleSearch.fromBundle(record.bundleDir);
  } catch (error) {
    return {
      source: unavailableSource(baseSource, error, record.state),
      concepts: [],
      edges: []
    };
  }
  const [validation, stats] = await Promise.all([
    validateBundle(record.bundleDir),
    inspectBundle(record.bundleDir)
  ]);
  const refFor2 = (id) => options.prefixRefs ? `${record.name}:${id}` : id;
  const concepts = [...search.graph.concepts.values()].sort((first, second) => first.id.localeCompare(second.id)).map((concept) => inspectorConcept(concept, search, record, refFor2, options.prefixRefs));
  return {
    source: {
      ...baseSource,
      availabilityStatus: "available",
      validationStatus: validation.valid ? "valid" : "invalid",
      conceptCount: stats.conceptCount,
      warningCount: validation.warningCount,
      brokenLinkCount: brokenLinkCount(validation.issues),
      validationIssues: validation.issues,
      orphanConcepts: stats.orphanConcepts.map(refFor2),
      freshnessStatus: record.state?.status ?? "fresh",
      refreshInProgress: Boolean(record.state?.refreshInProgress),
      lastSuccessfulRefreshAt: record.state?.lastSuccessfulRefreshAt ?? null,
      nextRefreshAllowedAt: record.state?.nextRefreshAllowedAt ?? null,
      lastRefreshError: normalizeError(record.state?.lastError ?? null)
    },
    concepts,
    edges: collapsedEdges(search, record.name, refFor2, options.prefixRefs)
  };
}
function inspectorConcept(concept, search, record, refFor2, includeSource) {
  const ref = refFor2(concept.id);
  const outbound = (search.graph.outbound.get(concept.id) ?? []).map(refFor2).sort();
  const backlinks = (search.graph.backlinks.get(concept.id) ?? []).map(refFor2).sort();
  return {
    id: concept.id,
    ref,
    path: concept.path,
    title: concept.title,
    type: concept.type,
    tags: [...concept.tags],
    description: concept.description,
    resource: concept.resource,
    resourceUrl: concept.resource,
    ...includeSource ? {
      sourceName: record.name,
      sourceKind: record.manifest.kind,
      seedUrl: record.manifest.source.seedUrl
    } : {},
    outbound,
    outboundLinks: [...outbound],
    backlinks,
    citation: {
      ref,
      conceptPath: concept.path,
      sourceResource: concept.resource,
      ...includeSource ? { sourceName: record.name } : {}
    }
  };
}
function collapsedEdges(search, sourceName, refFor2, includeSource) {
  const seen = /* @__PURE__ */ new Set();
  const edges = [];
  for (const concept of [...search.graph.concepts.values()].sort(
    (a, b) => a.id.localeCompare(b.id)
  )) {
    for (const target of search.graph.outbound.get(concept.id) ?? []) {
      const from = refFor2(concept.id);
      const to = refFor2(target);
      const key = [from, to].sort().join("\0");
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        from,
        to,
        kind: "internal_link",
        label: "Markdown link",
        ...includeSource ? { sourceName } : {}
      });
    }
  }
  return edges.sort(
    (first, second) => (first.sourceName ?? "").localeCompare(second.sourceName ?? "") || first.from.localeCompare(second.from) || first.to.localeCompare(second.to)
  );
}
function sourceBase(record) {
  return {
    sourceName: record.name,
    name: record.name,
    label: record.name,
    kind: record.manifest.kind,
    seedUrl: record.manifest.source.seedUrl,
    bundleDir: record.bundleDir
  };
}
function unavailableSource(baseSource, error, state) {
  return {
    ...baseSource,
    availabilityStatus: "unavailable",
    validationStatus: "unavailable",
    conceptCount: state?.bundle?.conceptCount ?? 0,
    warningCount: state?.bundle?.warningCount ?? 0,
    brokenLinkCount: 0,
    validationIssues: [],
    orphanConcepts: [],
    freshnessStatus: state?.status ?? "failed",
    refreshInProgress: Boolean(state?.refreshInProgress),
    lastSuccessfulRefreshAt: state?.lastSuccessfulRefreshAt ?? null,
    nextRefreshAllowedAt: state?.nextRefreshAllowedAt ?? null,
    lastRefreshError: normalizeError(error)
  };
}
function summarizeReadiness(sources) {
  const sourceCount = sources.length;
  const usableSourceCount = sources.filter(
    (source) => source.availabilityStatus === "available"
  ).length;
  const conceptCount = sum(sources, "conceptCount");
  const warningCount = sum(sources, "warningCount");
  const brokenLinkCount2 = sum(sources, "brokenLinkCount");
  const orphanConcepts = sources.flatMap((source) => source.orphanConcepts).sort();
  const freshnessStatuses = {};
  for (const source of sources) {
    if (source.freshnessStatus) {
      freshnessStatuses[source.freshnessStatus] = (freshnessStatuses[source.freshnessStatus] ?? 0) + 1;
    }
  }
  const failedSource = sources.find((source) => source.lastRefreshError);
  return {
    availabilityStatus: usableSourceCount > 0 ? "available" : "unavailable",
    validationStatus: sources.some((source) => source.validationStatus !== "valid") ? "invalid" : "valid",
    sourceCount,
    usableSourceCount,
    conceptCount,
    warningCount,
    brokenLinkCount: brokenLinkCount2,
    brokenLinks: brokenLinkCount2,
    orphanConcepts,
    refreshInProgress: sources.some((source) => source.refreshInProgress),
    freshnessStatus: aggregateFreshnessStatus(sources),
    freshnessStatuses: Object.fromEntries(
      Object.entries(freshnessStatuses).sort(([first], [second]) => first.localeCompare(second))
    ),
    lastSuccessfulRefreshAt: latest(
      sources.map((source) => source.lastSuccessfulRefreshAt).filter(isString)
    ),
    nextRefreshAllowedAt: earliest(
      sources.map((source) => source.nextRefreshAllowedAt).filter(isString)
    ),
    lastRefreshError: failedSource?.lastRefreshError ?? null,
    sources
  };
}
function aggregateFreshnessStatus(sources) {
  const statuses = new Set(sources.map((source) => source.freshnessStatus).filter(isString));
  for (const status of ["failed", "missing", "refreshing", "stale", "fresh"]) {
    if (statuses.has(status)) return status;
  }
  return void 0;
}
function agentPreview(sources, concepts) {
  const firstConcept = concepts[0];
  const firstSource = sources.find((source) => source.availabilityStatus === "available");
  const sourceHint = sources.length > 1 && firstSource ? `, "source": "${firstSource.name}"` : "";
  const readId = firstConcept?.id ?? "concept-id";
  const sequence = [
    {
      tool: "bundle_summary",
      name: "bundle_summary",
      purpose: "Start with validation, source freshness, and available concept counts.",
      example: "bundle_summary({})"
    },
    {
      tool: "search_concepts",
      name: "search_concepts",
      purpose: "Search for the docs concept that matches the task before reading.",
      example: `search_concepts({ "query": "setup"${sourceHint}, "limit": 5 })`
    },
    {
      tool: "read_concept",
      name: "read_concept",
      purpose: "Read only the selected concept and cite its source resource.",
      example: `read_concept({ "id": "${readId}"${sourceHint} })`
    },
    {
      tool: "get_neighbors",
      name: "get_neighbors",
      purpose: "Traverse outbound links and backlinks when adjacent docs matter.",
      example: `get_neighbors({ "id": "${readId}"${sourceHint}, "depth": 1 })`
    }
  ];
  return {
    sequence,
    tools: sequence.map((step) => ({ name: step.tool, purpose: step.purpose })),
    citationGuidance: sources.length > 1 ? "Use source filters when the library is known, then cite source_resource URLs from read_concept results." : "Cite source_resource URLs from read_concept results when available.",
    suggestedQuestions: suggestedQuestions(sources, concepts)
  };
}
function suggestedQuestions(sources, concepts) {
  const firstSource = sources.find((source) => source.availabilityStatus === "available");
  const firstConcept = concepts[0];
  const questions = [
    firstSource ? `In ${firstSource.name}, what should I read first to get started?` : "What concepts are available in this OKF bundle?",
    firstConcept ? `Read ${firstConcept.ref} and cite the source URL.` : "Search the OKF bundle and cite the most relevant source URL.",
    "What related concepts should I inspect next with get_neighbors?"
  ];
  return [...new Set(questions)];
}
function brokenLinkCount(issues) {
  return issues.filter((issue) => issue.code === "broken_internal_link").length;
}
function normalizeError(error) {
  if (!error) return null;
  if (error instanceof Error) {
    const details = { message: error.message };
    if ("code" in error && typeof error.code === "string") details.code = error.code;
    return details;
  }
  if (typeof error === "object") {
    const record = error;
    return {
      ...record,
      message: typeof record.message === "string" ? record.message : "Inspector source failed."
    };
  }
  return { message: String(error) };
}
function sum(sources, key) {
  return sources.reduce((total, source) => total + source[key], 0);
}
function latest(values) {
  return values.sort().at(-1) ?? null;
}
function earliest(values) {
  return values.sort()[0] ?? null;
}
function isString(value) {
  return typeof value === "string" && value.length > 0;
}

export {
  extractHeadings,
  extractMarkdownLinks,
  inferType,
  inferTags,
  normalizeDocument,
  descriptionFromMarkdown,
  assertSafeForceOutDir,
  writeOkfBundle,
  crawlWebsite,
  importLocal,
  hashBundleContents,
  evaluateFreshness,
  refreshSource,
  parseDurationSeconds,
  buildActivationPacket,
  withActivationMetadata,
  renderActivationSetupMarkdown,
  writeActivationPacketFiles,
  protectedActivationInputPaths,
  buildBundleInspectorReport,
  buildWorkspaceInspectorReport
};
